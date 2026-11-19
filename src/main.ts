import './style.css';
import { HlnApiError, OwnedName, fetchOwnedNames } from './api';
import { mip } from './art/core';
import { DECO_NAMES } from './art/nature';
import { RealBuilding, Renderer, buildingSprite, prepareArt } from './render/renderer';
import { newSeed } from './rng';
import {
  Placement, SavedWorld, clearAllPlacements, clearPlacementsOn, getLastWallet, loadPlacements, loadWorld, prunePlacements, savePlacements, saveWorld, setLastWallet,
} from './storage';
import { WalletOption, findWallet, getAuthorizedAccount, getWalletOptions, requestAccount, revoke, shortAddress, startDiscovery } from './wallet';
import { addLandmass, generateWorld, regenLandmass } from './world/gen';
import { FAMILIES, Landmass, T, THEMES, World, bldFamily, pack, unpackX, unpackY } from './world/world';

const PRESETS = [0, 100, 1000, 10000];
const $ = <E extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as E;
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const fmt = (n: number) => n.toLocaleString('en-US');

/** Building design for a real name: fixed by its namehash (stable identity). */
function designFor(namehash: string) {
  return { family: parseInt(namehash.slice(-8), 16) % 4, variant: parseInt(namehash.slice(-16, -8), 16) % 6 };
}

const state = {
  world: null as unknown as World,
  saved: null as unknown as SavedWorld,
  wallet: null as WalletOption | null,
  address: null as string | null,
  status: 'disconnected' as 'disconnected' | 'connecting' | 'connected',
  connectError: '',
  names: [] as OwnedName[],
  namesStatus: 'idle' as 'idle' | 'loading' | 'ready' | 'error',
  namesError: '',
  placements: [] as Placement[],
  placing: null as OwnedName | null,
  filter: 'all' as 'all' | 'unplaced' | 'placed',
  search: '',
};

const renderer = new Renderer($<HTMLCanvasElement>('map'), $<HTMLCanvasElement>('minimap'));

// ================================================================ world lifecycle

function busy<T>(text: string, fn: () => T): Promise<T> {
  $('busy-text').textContent = text;
  $('busy').hidden = false;
  return new Promise((resolve, reject) => {
    // let the overlay paint before the heavy synchronous work
    requestAnimationFrame(() => setTimeout(() => {
      try {
        resolve(fn());
      } catch (e) {
        reject(e);
      } finally {
        $('busy').hidden = true;
      }
    }, 16));
  });
}

function rebuild(saved: SavedWorld): World {
  const w = generateWorld(saved.seed, saved.preset);
  for (const op of saved.ops) {
    if (op.t === 'add') addLandmass(w, op.s);
    else regenLandmass(w, op.u, op.s);
  }
  return w;
}

function persistWorld() {
  if (!saveWorld(state.saved)) toast('Could not save to this browser (storage full or blocked).', 'warn');
}

async function newWorld(preset: number, reason: string) {
  const hadPlacements = state.placements.length;
  const label = preset ? `Generating ${fmt(preset)} demo buildings…` : 'Generating a new island…';
  await busy(label, () => {
    const seed = newSeed();
    state.saved = { v: 2, worldId: `${Date.now().toString(36)}-${seed.toString(36)}`, seed, preset, ops: [] };
    clearAllPlacements();
    state.world = generateWorld(seed, preset);
    persistWorld();
    state.placements = [];
    state.placing = null;
    renderer.setWorld(state.world);
    renderer.setReal(new Map());
    renderer.fitWorld(false);
  });
  syncAll();
  const s = state.world.stats();
  toast(`${reason}: ${fmt(s.landmasses)} landmass${s.landmasses > 1 ? 'es' : ''}, ${fmt(s.demo)} demo buildings, ${fmt(s.plots - s.demo)} open plots.${hadPlacements ? ` ${hadPlacements} placement${hadPlacements > 1 ? 's' : ''} cleared.` : ''}`, 'ok');
}

function placementValid(p: Placement): boolean {
  const w = state.world;
  const i = w.idx(p.x, p.y);
  return i >= 0 && w.terr[i] === T.PLOT && w.land[i] === p.land && w.bld[i] === 0;
}

/** After an add/regen: drop placements whose plot vanished (any wallet), then reload this wallet's. */
function afterWorldEdit() {
  prunePlacements(state.saved.worldId, placementValid);
  if (state.address) {
    const before = state.placements.length;
    state.placements = loadPlacements(state.address, state.saved.worldId);
    const lost = before - state.placements.length;
    if (lost > 0) toast(`${lost} placement${lost > 1 ? 's were' : ' was'} removed — the plot changed.`, 'warn');
  }
  refreshReal();
}

async function addLand() {
  const seed = newSeed();
  const l = await busy('Adding a landmass…', () => {
    const l = addLandmass(state.world, seed);
    state.saved.ops.push({ t: 'add', s: seed });
    persistWorld();
    const box = dirtyBox(l);
    renderer.invalidateRect(box.minX - 16, box.minY - 16, box.maxX + 16, box.maxY + 16);
    return l;
  });
  afterWorldEdit();
  selectLand(l.uid);
  renderer.fitBounds(l.minX - 6, l.minY - 6, l.maxX + 6, l.maxY + 6, true, 0.9);
  syncAll();
  toast(`Added ${l.name} (${THEMES[l.theme].label}) with ${l.plots.length} open plots.`, 'ok');
}

function dirtyBox(l: Landmass) {
  const b = { minX: l.minX, minY: l.minY, maxX: l.maxX, maxY: l.maxY };
  for (const br of state.world.bridges) {
    if (br.a !== l.uid && br.b !== l.uid) continue;
    for (const k of br.tiles) {
      b.minX = Math.min(b.minX, unpackX(k));
      b.minY = Math.min(b.minY, unpackY(k));
      b.maxX = Math.max(b.maxX, unpackX(k));
      b.maxY = Math.max(b.maxY, unpackY(k));
    }
  }
  return b;
}

async function regenLand(uid: number) {
  const seed = newSeed();
  const old = state.world.getLandmass(uid);
  if (!old) return;
  const mine = state.placements.filter((p) => p.land === uid).length;
  const r = await busy(`Regenerating ${old.name}…`, () => {
    const r = regenLandmass(state.world, uid, seed);
    if (!r) return null;
    state.saved.ops.push({ t: 'regen', u: uid, s: seed });
    persistWorld();
    clearPlacementsOn(state.saved.worldId, new Set([uid]));
    renderer.invalidateRect(r.dirty.minX - 16, r.dirty.minY - 16, r.dirty.maxX + 16, r.dirty.maxY + 16);
    return r;
  });
  if (!r) return;
  afterWorldEdit();
  selectLand(r.l.uid);
  syncAll();
  toast(`${old.name} → ${r.l.name}: new outline, streets and buildings.${mine ? ` ${mine === 1 ? 'Your building there was' : `${mine} of your buildings there were`} cleared — back to Unplaced.` : ''}`, 'ok');
}

// ================================================================ real-name placements

function activeNameSet() {
  return new Map(state.names.map((n) => [n.namehash, n]));
}

/** Render only this wallet's placements for names it currently owns, on valid free plots. */
function refreshReal() {
  const out = new Map<number, RealBuilding>();
  if (state.address && state.namesStatus === 'ready') {
    const owned = activeNameSet();
    for (const p of state.placements) {
      const n = owned.get(p.namehash);
      if (!n || !placementValid(p)) continue;
      const k = pack(p.x, p.y);
      if (out.has(k)) continue;
      out.set(k, { name: n.name, namehash: n.namehash, ...designFor(n.namehash) });
    }
  }
  renderer.setReal(out);
  renderer.canPlace = (x, y) => canPlace(x, y) === null;
}

function placedOf(namehash: string): Placement | undefined {
  const k = state.placements.find((p) => p.namehash === namehash);
  return k && renderer.real.get(pack(k.x, k.y))?.namehash === namehash ? k : undefined;
}

/** null if the plot is free for the selected name, else a reason. */
function canPlace(x: number, y: number): string | null {
  const w = state.world;
  const i = w.idx(x, y);
  if (i < 0 || !w.isLand(x, y)) return 'That’s outside the map — pick a plot on land.';
  const t = w.terr[i];
  if (t !== T.PLOT) {
    const what = t === T.ROAD ? 'a road' : t === T.PARK ? 'a park' : t === T.PLAZA ? 'a plaza' : t === T.SAND ? 'the beach' : 'scenery';
    return `That’s ${what}, not a buildable plot.`;
  }
  if (w.bld[i]) return 'That plot already has a demo building.';
  const r = renderer.real.get(pack(x, y));
  if (r) return `That plot already holds ${r.name}.`;
  return null;
}

function startPlacing(n: OwnedName) {
  if (placedOf(n.namehash)) return;
  state.placing = state.placing?.namehash === n.namehash ? null : n;
  syncPlacing();
  renderNames();
}

function cancelPlacing() {
  if (!state.placing) return;
  state.placing = null;
  syncPlacing();
  renderNames();
}

function syncPlacing() {
  const n = state.placing;
  renderer.placing = n ? { name: n.name, namehash: n.namehash, ...designFor(n.namehash) } : null;
  document.body.classList.toggle('placing', !!n);
  const b = $('banner');
  if (n) {
    b.innerHTML = `Placing <b>${esc(n.name)}</b> — click any glowing open plot <kbd>Esc</kbd><button class="btn ghost" id="cancel-place">Cancel</button>`;
    b.hidden = false;
    $('cancel-place').onclick = cancelPlacing;
  } else b.hidden = true;
  renderer.request();
}

function placeAt(x: number, y: number) {
  const n = state.placing;
  if (!n || !state.address) return;
  if (placedOf(n.namehash)) {
    toast(`${n.name} already has a building.`, 'err');
    return;
  }
  const why = canPlace(x, y);
  if (why) {
    toast(why, 'err');
    return;
  }
  const land = state.world.landAt(x, y);
  state.placements = state.placements.filter((p) => p.namehash !== n.namehash);
  state.placements.push({ namehash: n.namehash, name: n.name, x, y, land, t: Date.now() });
  if (!savePlacements(state.address, state.saved.worldId, state.placements)) toast('Placed, but this browser blocked saving it.', 'warn');
  state.placing = null;
  refreshReal();
  syncPlacing();
  syncAll();
  $('tooltip').hidden = true;
  renderer.focusTile = { x, y, until: performance.now() + 1800 };
  const lm = state.world.getLandmass(land);
  toast(`${n.name} is now a ${FAMILIES[designFor(n.namehash).family].toLowerCase()} on ${lm?.name ?? 'the map'}.`, 'ok');
}

// ================================================================ map interaction

renderer.onClickTile = (x, y, sx, sy) => {
  if (state.placing) {
    if (renderer.cam.zoom < 0.32) {
      renderer.zoomAt(sx, sy, 0.9 / renderer.cam.zoom);
      toast('Zoomed in — now pick an exact plot.', 'info');
      return;
    }
    placeAt(x, y);
    return;
  }
  const land = state.world.landAt(x, y);
  selectLand(land);
};

function selectLand(uid: number) {
  renderer.selectedLand = uid;
  renderer.request();
  renderLandPanel();
}

renderer.onHover = (x, y, sx, sy) => {
  const tip = $('tooltip');
  if (Number.isNaN(x) || renderer.cam.zoom < 0.18 || document.querySelector('#map.dragging')) {
    tip.hidden = true;
    return;
  }
  const html = describe(x, y);
  if (!html) {
    tip.hidden = true;
    return;
  }
  tip.innerHTML = html;
  tip.hidden = false;
  const r = tip.getBoundingClientRect();
  tip.style.left = `${Math.min(sx + 16, window.innerWidth - r.width - 8)}px`;
  tip.style.top = `${Math.max(8, sy - r.height - 14)}px`;
};

function describe(x: number, y: number): string {
  const w = state.world;
  const i = w.idx(x, y);
  if (i < 0) return '';
  const t = w.terr[i];
  if (t === T.WATER) return '';
  if (t === T.BRIDGE) return '<b>Bridge</b>';
  const lm = w.getLandmass(w.land[i]);
  const where = lm ? `<div class="t-sub">${esc(lm.name)} · ${THEMES[lm.theme].label}</div>` : '';
  const real = renderer.real.get(pack(x, y));
  if (real) return `<b class="t-real">${esc(real.name)}</b><div>Your building · ${FAMILIES[real.family]}</div>${where}`;
  if (state.placing) {
    const why = canPlace(x, y);
    return why ? `<div>${esc(why)}</div>${where}` : `<b>Open plot</b><div>Click to place <b>${esc(state.placing.name)}</b></div>${where}`;
  }
  if (w.bld[i]) return `<b>Demo building</b> · ${FAMILIES[bldFamily(w.bld[i])]}<div class="t-sub">Generated scenery — not a real .hl name</div>${where}`;
  if (t === T.PLOT) return `<b>Open plot</b><div class="t-sub">${state.address ? 'Pick an unplaced name to build here' : 'Connect a wallet to place a name'}</div>${where}`;
  const d = w.deco[i];
  const label = d && DECO_NAMES[d] && d >= 20 ? DECO_NAMES[d] : t === T.ROAD ? 'Street' : t === T.PARK ? 'Park' : t === T.PLAZA ? 'Plaza' : t === T.SAND ? 'Beach' : d ? DECO_NAMES[d] ?? 'Green' : 'Green';
  return `<b>${label}</b>${where}`;
}

renderer.onCameraChange = () => {
  $('tooltip').hidden = true;
};

window.addEventListener('keydown', (e) => {
  if ((e.target as HTMLElement)?.closest?.('input, textarea')) return;
  if (e.key === 'Escape') {
    if (state.placing) cancelPlacing();
    else selectLand(0);
  } else if (e.key === 'f' || e.key === 'F' || e.key === 'Home') renderer.fitWorld();
});
$('map').addEventListener('contextmenu', (e) => {
  e.preventDefault();
  cancelPlacing();
});
$('zoom-in').onclick = () => renderer.zoomAt(renderer.viewW / 2, renderer.viewH / 2, 1.4);
$('zoom-out').onclick = () => renderer.zoomAt(renderer.viewW / 2, renderer.viewH / 2, 1 / 1.4);
$('zoom-fit').onclick = () => renderer.fitWorld();

// ================================================================ top bar

$('preset').addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest('button');
  if (!b) return;
  const n = Number(b.dataset.n);
  if (n === state.saved.preset) {
    toast('Already showing that many demo buildings — use Regenerate map for a fresh layout.', 'info');
    return;
  }
  void newWorld(n, `New world with ${fmt(n)} demo buildings`);
});
$('add-land').onclick = () => void addLand();
$('regen-map').onclick = () => void newWorld(state.saved.preset, 'Regenerated');
$('reset').onclick = () => void newWorld(0, 'Demo reset');

function renderTopbar() {
  for (const b of $('preset').querySelectorAll('button')) {
    const on = Number(b.dataset.n) === state.saved.preset;
    b.classList.toggle('active', on);
    b.setAttribute('aria-checked', String(on));
  }
  const s = state.world.stats();
  const mine = renderer.real.size;
  $('stats').textContent = `${fmt(s.landmasses)} landmass${s.landmasses === 1 ? '' : 'es'} · ${fmt(s.plots)} plots · ${fmt(s.demo)} demo buildings · ${fmt(s.plots - s.demo - mine)} open${mine ? ` · ${mine} yours` : ''}`;
}

function renderLandPanel() {
  const p = $('landpanel');
  const l = state.world.getLandmass(renderer.selectedLand);
  $('hint').hidden = !!l;
  if (!l) {
    p.hidden = true;
    return;
  }
  const st = state.world.landStats(l);
  let mine = 0;
  for (const [k] of renderer.real) if (state.world.landAt(unpackX(k), unpackY(k)) === l.uid) mine++;
  const free = st.plots - st.demo - mine;
  p.innerHTML = `
    <button class="close" id="lp-close" aria-label="Close">×</button>
    <h3>${esc(l.name)}</h3>
    <div class="theme">${THEMES[l.theme].label} · ${fmt(l.tiles)} tiles</div>
    <div class="kv">
      <div><b>${fmt(st.demo)}</b><span>Demo</span></div>
      <div><b>${fmt(free)}</b><span>Open</span></div>
      <div><b>${mine}</b><span>Yours</span></div>
    </div>
    ${mine ? `<div class="warnline">Regenerating removes your ${mine} building${mine > 1 ? 's' : ''} here (names go back to Unplaced).</div>` : ''}
    <div class="row">
      <button class="btn" id="lp-regen" title="New outline, streets, scenery and buildings for this island only">⟳ Regenerate landmass</button>
      <button class="btn ghost" id="lp-zoom">Zoom to</button>
    </div>`;
  p.hidden = false;
  $('lp-close').onclick = () => selectLand(0);
  $('lp-regen').onclick = () => void regenLand(l.uid);
  $('lp-zoom').onclick = () => renderer.fitBounds(l.minX - 4, l.minY - 4, l.maxX + 4, l.maxY + 4, true, 1);
}

// ================================================================ wallet

let namesAbort: AbortController | null = null;
let detach: (() => void) | null = null;

async function connect(w: WalletOption) {
  state.status = 'connecting';
  state.connectError = '';
  renderWallet();
  try {
    const acct = await requestAccount(w);
    if (!acct) throw new Error('No account returned by the wallet.');
    attachWallet(w);
    setLastWallet(w.id);
    setAccount(acct);
  } catch (e) {
    const err = e as { code?: number; message?: string };
    state.status = 'disconnected';
    state.connectError = err.code === 4001 ? 'Connection request was rejected in the wallet.' : err.message || 'Could not connect.';
    renderWallet();
  }
}

function attachWallet(w: WalletOption) {
  detach?.();
  state.wallet = w;
  const onAccounts = (accts: unknown) => {
    const a = Array.isArray(accts) && typeof accts[0] === 'string' ? accts[0] : null;
    if (a) setAccount(a);
    else disconnect(false);
  };
  w.provider.on?.('accountsChanged', onAccounts);
  detach = () => w.provider.removeListener?.('accountsChanged', onAccounts);
}

function setAccount(address: string) {
  if (state.address?.toLowerCase() === address.toLowerCase() && state.status === 'connected') return;
  state.address = address.toLowerCase();
  state.status = 'connected';
  state.placing = null;
  state.names = [];
  state.placements = loadPlacements(state.address, state.saved.worldId);
  syncPlacing();
  refreshReal();
  void loadNames();
  syncAll();
}

function disconnect(revokePerms = true) {
  if (revokePerms && state.wallet) void revoke(state.wallet);
  detach?.();
  detach = null;
  namesAbort?.abort();
  Object.assign(state, { status: 'disconnected', wallet: null, address: null, names: [], placements: [], placing: null, namesStatus: 'idle', namesError: '' });
  setLastWallet(null);
  syncPlacing();
  refreshReal();
  syncAll();
}

async function loadNames() {
  if (!state.address) return;
  namesAbort?.abort();
  const ctl = new AbortController();
  namesAbort = ctl;
  const addr = state.address;
  state.namesStatus = 'loading';
  state.namesError = '';
  renderNames();
  try {
    const names = await fetchOwnedNames(addr, ctl.signal);
    if (ctl.signal.aborted || state.address !== addr) return;
    state.names = names;
    state.namesStatus = 'ready';
    if (state.placing && !names.some((n) => n.namehash === state.placing!.namehash)) state.placing = null;
  } catch (e) {
    if ((e as Error).name === 'AbortError') return;
    state.namesStatus = 'error';
    state.namesError = e instanceof HlnApiError ? e.message : 'Could not load names.';
  }
  refreshReal();
  syncPlacing();
  syncAll();
}

async function restoreWallet() {
  const id = getLastWallet();
  if (!id) return;
  const w = findWallet(id);
  if (!w) return;
  const acct = await getAuthorizedAccount(w);
  if (acct) {
    attachWallet(w);
    setAccount(acct);
  }
}

function blockie(addr: string): string {
  const c = document.createElement('canvas');
  c.width = c.height = 8;
  const g = c.getContext('2d')!;
  const h = parseInt(addr.slice(2, 10), 16);
  g.fillStyle = `hsl(${h % 360} 60% 45%)`;
  g.fillRect(0, 0, 8, 8);
  g.fillStyle = `hsl(${(h >> 9) % 360} 75% 70%)`;
  for (let i = 0; i < 32; i++) if (parseInt(addr[2 + (i % 40)], 16) & 1) {
    const x = i % 4, y = (i / 4) | 0;
    g.fillRect(x, y, 1, 1);
    g.fillRect(7 - x, y, 1, 1);
  }
  return c.toDataURL();
}

function renderWallet() {
  const el = $('wallet');
  if (state.status === 'connected' && state.address) {
    el.innerHTML = `
      <div class="wallet-row">
        <img class="avatar" src="${blockie(state.address)}" alt="" style="image-rendering:pixelated" />
        <div><div class="addr">${shortAddress(state.address)}</div><div class="sub">${esc(state.wallet?.name ?? 'Wallet')} · connected</div></div>
        <button class="btn ghost" id="disconnect">Disconnect</button>
      </div>`;
    $('disconnect').onclick = () => disconnect();
    return;
  }
  const opts = getWalletOptions();
  const busyNow = state.status === 'connecting';
  if (!opts.length) {
    el.innerHTML = `<p class="wallet-title">Connect an EVM wallet to place your <b>.hl</b> names. You can explore the city without one.</p>
      <button class="btn" disabled>No wallet detected</button>
      <p class="muted" style="margin:8px 0 0;font-size:12px">Install a browser wallet (e.g. Rabby or MetaMask) and reload.</p>`;
    return;
  }
  el.innerHTML = `<p class="wallet-title">Connect to see the <b>.hl</b> names you own. Read-only — no signature, no transaction.</p>
    <div class="wallet-list">${opts.map((o, i) => `<button class="btn" id="connect-${i}" ${busyNow ? 'disabled' : ''}>${o.icon ? `<img src="${esc(o.icon)}" alt="" />` : ''}${busyNow ? 'Check your wallet…' : opts.length > 1 ? esc(o.name) : 'Connect wallet'}</button>`).join('')}</div>
    ${state.connectError ? `<p class="err">${esc(state.connectError)}</p>` : ''}`;
  opts.forEach((o, i) => ($(`connect-${i}`).onclick = () => void connect(o)));
}

// ================================================================ names list

const thumbCache = new Map<string, string>();
function thumb(namehash: string): string {
  const { family, variant } = designFor(namehash);
  const key = `${family}:${variant}`;
  let url = thumbCache.get(key);
  if (!url) {
    const sp = mip(buildingSprite(family, variant), 0.5);
    const c = document.createElement('canvas');
    c.width = c.height = 60;
    const g = c.getContext('2d')!;
    const s = Math.min(56 / sp.c.width, 56 / sp.c.height);
    g.drawImage(sp.c, (60 - sp.c.width * s) / 2, (60 - sp.c.height * s) / 2, sp.c.width * s, sp.c.height * s);
    url = c.toDataURL();
    thumbCache.set(key, url);
  }
  return url;
}

function renderNames() {
  const box = $('names');
  box.hidden = state.status !== 'connected';
  if (box.hidden) return;
  const list = $('name-list');
  const count = $('names-count');
  $('refresh').classList.toggle('spin', state.namesStatus === 'loading');
  for (const b of $('filters').querySelectorAll('button')) b.classList.toggle('active', b.dataset.filter === state.filter);
  if (state.namesStatus === 'loading' && !state.names.length) {
    count.textContent = '';
    list.innerHTML = Array.from({ length: 4 }, () => '<div class="skeleton"></div>').join('') + '<p class="muted" style="text-align:center;font-size:12px">Fetching names owned on HyperEVM…</p>';
    return;
  }
  if (state.namesStatus === 'error') {
    count.textContent = '';
    list.innerHTML = `<div class="state"><div class="big">⚠️</div><h3>Couldn’t load names</h3>${esc(state.namesError)}<br/><br/><button class="btn" id="retry">Try again</button></div>`;
    $('retry').onclick = () => void loadNames();
    return;
  }
  if (state.namesStatus === 'ready' && !state.names.length) {
    count.textContent = '(0)';
    list.innerHTML = `<div class="state"><div class="big">🏗️</div><h3>No active .hl names</h3>This wallet doesn’t own any active Hyperliquid names.<br/>Get one at <a href="https://app.hlnames.xyz" target="_blank" rel="noopener" style="color:var(--accent-2)">hlnames.xyz</a>, then refresh.</div>`;
    return;
  }
  const placedCount = state.names.filter((n) => placedOf(n.namehash)).length;
  count.textContent = `(${placedCount}/${state.names.length} placed)`;
  const q = state.search.trim().toLowerCase();
  const items = state.names.filter((n) => {
    const placed = !!placedOf(n.namehash);
    if (state.filter === 'placed' && !placed) return false;
    if (state.filter === 'unplaced' && placed) return false;
    return !q || n.name.toLowerCase().includes(q);
  });
  if (!items.length) {
    list.innerHTML = `<div class="state">No names match.</div>`;
    return;
  }
  list.innerHTML = items.map((n) => {
    const p = placedOf(n.namehash);
    const sel = state.placing?.namehash === n.namehash;
    const fam = FAMILIES[designFor(n.namehash).family];
    const lm = p ? state.world.getLandmass(p.land) : undefined;
    const sub = p ? `${fam} · ${esc(lm?.name ?? '')}` : sel ? 'Click a glowing plot…' : `${fam}${n.expiry === null ? ' · expiry unverified' : ''}`;
    return `<button class="name-item${sel ? ' selected' : ''}" data-hash="${n.namehash}" role="listitem" title="${p ? 'Fly to this building' : 'Select, then click an open plot'}">
      <span class="ico"><img src="${thumb(n.namehash)}" alt="" width="30" height="30" /></span>
      <span class="nm"><b>${esc(n.name)}</b><small>${sub}</small></span>
      <span class="pill ${p ? 'placed' : 'unplaced'}">${p ? 'Placed' : 'Unplaced'}</span>
    </button>`;
  }).join('');
}

$('name-list').addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest<HTMLElement>('.name-item');
  if (!b) return;
  const n = state.names.find((x) => x.namehash === b.dataset.hash);
  if (!n) return;
  const p = placedOf(n.namehash);
  if (p) {
    cancelPlacing();
    renderer.flyToTile(p.x, p.y, Math.max(renderer.cam.zoom, 1.1));
  } else startPlacing(n);
});
$('filters').addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest<HTMLElement>('button');
  if (!b) return;
  state.filter = b.dataset.filter as typeof state.filter;
  renderNames();
});
$<HTMLInputElement>('search').addEventListener('input', (e) => {
  state.search = (e.target as HTMLInputElement).value;
  renderNames();
});
$('refresh').onclick = () => void loadNames();

// ================================================================ misc UI

function toast(msg: string, kind: 'ok' | 'err' | 'warn' | 'info' = 'info') {
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.textContent = msg;
  const box = $('toasts');
  box.appendChild(el);
  while (box.children.length > 3) box.firstElementChild?.remove();
  setTimeout(() => el.remove(), kind === 'err' ? 3200 : 4200);
}

function syncAll() {
  renderTopbar();
  renderWallet();
  renderNames();
  renderLandPanel();
}

// ================================================================ boot

async function boot() {
  await busy('Painting the city…', () => {
    prepareArt();
    const saved = loadWorld();
    let world: World | null = null;
    if (saved && PRESETS.includes(saved.preset)) {
      try {
        world = rebuild(saved);
        state.saved = saved;
      } catch (e) {
        console.warn('Could not restore saved world, starting fresh', e);
      }
    }
    if (!world) {
      const seed = newSeed();
      state.saved = { v: 2, worldId: `${Date.now().toString(36)}-${seed.toString(36)}`, seed, preset: 0, ops: [] };
      clearAllPlacements();
      world = generateWorld(seed, 0);
      persistWorld();
    }
    state.world = world;
    renderer.setWorld(world);
    renderer.fitWorld(false);
  });
  refreshReal();
  syncAll();
  startDiscovery(() => {
    if (state.status !== 'connected') renderWallet();
  });
  setTimeout(() => void restoreWallet(), 250);
  // debug / testing hook
  (window as unknown as Record<string, unknown>).__city = { state, renderer };
}

void boot();
