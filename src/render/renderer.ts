/**
 * Canvas renderer.
 *
 * Performance approach (for 10,000 buildings): the world is cut into 16×16-tile
 * chunks. Each chunk — terrain, cliffs, bridges, shadows, trees and buildings —
 * is baked once into an offscreen canvas per zoom bucket (powers of two), and
 * frames just blit the visible chunks. Missing chunks are baked progressively
 * within a per-frame time budget, using another bucket's bake as a stand-in.
 * Only overlays (hover, placement highlights, labels, pins) are drawn live.
 */
import { CLIFF, S, Sprite, TH, TW, mip } from '../art/core';
import { BUILDERS, buildingMetrics } from '../art/buildings';
import { decoSprites } from '../art/nature';
import { groundSprites } from '../art/ground';
import { hash3 } from '../rng';
import { D, T, THEMES, World, bldFamily, bldVariant, pack, unpackX, unpackY } from '../world/world';

export interface RealBuilding {
  name: string;
  namehash: string;
  family: number;
  variant: number;
}

const CH = 16; // chunk size in tiles
const MT = 178; // chunk top margin (tallest sprite), world px
const MB = CLIFF + 10;
const MX = 44;
const MAX_ZOOM = 2;
const PIXEL_BUDGET = 48e6; // cached chunk pixels before LRU eviction

interface Chunk {
  c: HTMLCanvasElement;
  b: number;
  px: number;
  used: number;
}

const bsprites: Sprite[][] = [];
export function buildingSprite(family: number, variant: number): Sprite {
  if (!bsprites[family]) bsprites[family] = [];
  return (bsprites[family][variant] ??= BUILDERS[family](variant));
}

/** Warm the sprite caches (call once at startup). */
export function prepareArt() {
  groundSprites();
  decoSprites();
  for (let f = 0; f < 4; f++) for (let v = 0; v < 6; v++) buildingSprite(f, v);
}

const tileAnchor = (x: number, y: number) => ({ x: (x - y) * (TW / 2), y: (x + y + 1) * (TH / 2) });

export class Renderer {
  readonly ctx: CanvasRenderingContext2D;
  world!: World;
  real = new Map<number, RealBuilding>();
  cam = { x: 0, y: 0, zoom: 1 };
  minZoom = 0.05;
  hover: { x: number; y: number } | null = null;
  placing: RealBuilding | null = null;
  canPlace: (x: number, y: number) => boolean = () => false;
  selectedLand = 0;
  focusTile: { x: number; y: number; until: number } | null = null;

  onClickTile: (x: number, y: number, sx: number, sy: number) => void = () => {};
  onHover: (x: number, y: number, sx: number, sy: number) => void = () => {};
  onCameraChange: () => void = () => {};

  private chunks = new Map<string, Chunk>();
  private pixels = 0;
  private frameNo = 0;
  private contentList: [number, number][] = [];
  private outlines = new Map<number, Path2D>();
  private waterPattern: CanvasPattern | null = null;
  private raf = 0;
  private anim: { from: { x: number; y: number; zoom: number }; to: { x: number; y: number; zoom: number }; t0: number; dur: number } | null = null;
  private keys = new Set<string>();
  private w = 0;
  private h = 0;
  private dpr = 1;
  private miniBase: HTMLCanvasElement | null = null;
  private miniXf = { s: 1, ox: 0, oy: 0 };
  bakingPending = 0;
  private openPath: Path2D | null = null;
  private openFor = '';

  constructor(readonly canvas: HTMLCanvasElement, readonly mini: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d')!;
    this.makeWaterPattern();
    this.resize();
    window.addEventListener('resize', () => this.resize());
    this.bindInput();
  }

  // ------------------------------------------------------------ world binding

  setWorld(world: World) {
    this.world = world;
    this.selectedLand = 0;
    this.invalidateAll();
  }

  invalidateAll() {
    this.openPath = null;
    this.chunks.clear();
    this.pixels = 0;
    this.outlines.clear();
    this.rebuildContent();
    this.miniBase = null;
    this.request();
  }

  invalidateRect(minX: number, minY: number, maxX: number, maxY: number) {
    this.openPath = null;
    const c0x = Math.floor((minX - 3) / CH), c1x = Math.floor((maxX + 3) / CH);
    const c0y = Math.floor((minY - 3) / CH), c1y = Math.floor((maxY + 3) / CH);
    for (const [k, ch] of this.chunks) {
      const [, sx, sy] = k.split(':').map(Number);
      if (sx >= c0x && sx <= c1x && sy >= c0y && sy <= c1y) {
        this.pixels -= ch.px;
        this.chunks.delete(k);
      }
    }
    this.outlines.clear();
    this.rebuildContent();
    this.miniBase = null;
    this.request();
  }

  invalidateTile(x: number, y: number) {
    const cx = Math.floor(x / CH), cy = Math.floor(y / CH);
    for (const [k, ch] of this.chunks) {
      const [, sx, sy] = k.split(':').map(Number);
      if (sx === cx && sy === cy) {
        this.pixels -= ch.px;
        this.chunks.delete(k);
      }
    }
    this.miniBase = null;
    this.request();
  }

  setReal(next: Map<number, RealBuilding>) {
    const changed = new Set<number>();
    for (const [k, v] of this.real) if (next.get(k)?.namehash !== v.namehash) changed.add(k);
    for (const [k, v] of next) if (this.real.get(k)?.namehash !== v.namehash) changed.add(k);
    this.real = new Map(next);
    this.openPath = null;
    for (const k of changed) this.invalidateTile(unpackX(k), unpackY(k));
    this.request();
  }

  private rebuildContent() {
    const w = this.world;
    const set = new Set<string>();
    const mark = (x: number, y: number) => set.add(`${Math.floor(x / CH)}:${Math.floor(y / CH)}`);
    for (const l of w.landmasses)
      for (let y = l.minY; y <= l.maxY; y += 2)
        for (let x = l.minX; x <= l.maxX; x += 2) {
          if (!w.landAt(x, y) && !w.landAt(x + 1, y) && !w.landAt(x, y + 1) && !w.landAt(x + 1, y + 1)) continue;
          mark(x - 3, y - 3);
          mark(x + 4, y - 3);
          mark(x - 3, y + 4);
          mark(x + 4, y + 4);
          mark(x, y);
        }
    for (const b of w.bridges) for (const k of b.tiles) mark(unpackX(k), unpackY(k));
    this.contentList = [...set].map((s) => s.split(':').map(Number) as [number, number]);
    this.contentList.sort((a, b) => a[0] + a[1] - (b[0] + b[1]) || a[0] - b[0]);
  }

  // ------------------------------------------------------------ camera

  private resize() {
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.w = this.canvas.clientWidth;
    this.h = this.canvas.clientHeight;
    this.canvas.width = Math.round(this.w * this.dpr);
    this.canvas.height = Math.round(this.h * this.dpr);
    this.request();
  }

  screenToWorld(sx: number, sy: number) {
    return { x: (sx - this.w / 2) / this.cam.zoom + this.cam.x, y: (sy - this.h / 2) / this.cam.zoom + this.cam.y };
  }
  worldToScreen(wx: number, wy: number) {
    return { x: (wx - this.cam.x) * this.cam.zoom + this.w / 2, y: (wy - this.cam.y) * this.cam.zoom + this.h / 2 };
  }
  /** Tile under a screen point (ground plane). */
  screenToTile(sx: number, sy: number) {
    const p = this.screenToWorld(sx, sy);
    const a = p.x / (TW / 2), b = p.y / (TH / 2);
    return { x: Math.floor((a + b) / 2), y: Math.floor((b - a) / 2) };
  }

  /** Building or tall object under the cursor (checks tiles in front first), else the ground tile. */
  pick(sx: number, sy: number) {
    const g = this.screenToTile(sx, sy);
    const p = this.screenToWorld(sx, sy);
    for (let k = 7; k >= 1; k--) {
      for (const [dx, dy] of [[k, k], [k, k - 1], [k - 1, k]]) {
        const x = g.x + dx, y = g.y + dy;
        const h = this.objectHeight(x, y);
        if (!h) continue;
        const a = tileAnchor(x, y);
        if (Math.abs(p.x - a.x) < TW * 0.3 && p.y < a.y + 4 && p.y > a.y - h) return { x, y };
      }
    }
    return g;
  }

  objectHeight(x: number, y: number): number {
    const i = this.world.idx(x, y);
    if (i < 0) return 0;
    const r = this.real.get(pack(x, y));
    if (r) return buildingMetrics(r.family, r.variant).h;
    const b = this.world.bld[i];
    if (b) return buildingMetrics(bldFamily(b), bldVariant(b)).h;
    return 0;
  }

  fitBounds(minX: number, minY: number, maxX: number, maxY: number, animate = true, maxZoom = 1.1) {
    const pts = [tileAnchor(minX, minY), tileAnchor(maxX + 1, minY), tileAnchor(minX, maxY + 1), tileAnchor(maxX + 1, maxY + 1)];
    const x0 = Math.min(...pts.map((p) => p.x)) - 40, x1 = Math.max(...pts.map((p) => p.x)) + 40;
    const y0 = Math.min(...pts.map((p) => p.y)) - 90, y1 = Math.max(...pts.map((p) => p.y)) + 30;
    const availW = this.w - 360, availH = this.h - 140;
    const z = Math.min(maxZoom, Math.max(0.02, Math.min(availW / (x1 - x0), availH / (y1 - y0))));
    // keep the map centred in the area not covered by the sidebar (right) and top bar
    const cx = (x0 + x1) / 2 + 150 / z, cy = (y0 + y1) / 2 - 20 / z;
    this.minZoom = Math.min(0.06, z * 0.7);
    this.flyTo(cx, cy, z, animate);
  }

  fitWorld(animate = true) {
    const b = this.world.bounds();
    this.fitBounds(b.minX, b.minY, b.maxX, b.maxY, animate);
  }

  flyTo(x: number, y: number, zoom: number, animate = true) {
    zoom = Math.max(this.minZoom, Math.min(MAX_ZOOM, zoom));
    if (!animate) {
      this.cam = { x, y, zoom };
      this.anim = null;
      this.request();
      this.onCameraChange();
      return;
    }
    this.anim = { from: { ...this.cam }, to: { x, y, zoom }, t0: performance.now(), dur: 650 };
    this.request();
  }

  flyToTile(x: number, y: number, zoom = Math.max(this.cam.zoom, 1)) {
    const a = tileAnchor(x, y);
    this.flyTo(a.x + 150 / zoom, a.y - 30, zoom);
    this.focusTile = { x, y, until: performance.now() + 2600 };
  }

  zoomAt(sx: number, sy: number, factor: number) {
    const before = this.screenToWorld(sx, sy);
    const z = Math.max(this.minZoom, Math.min(MAX_ZOOM, this.cam.zoom * factor));
    this.cam.zoom = z;
    const after = this.screenToWorld(sx, sy);
    this.cam.x += before.x - after.x;
    this.cam.y += before.y - after.y;
    this.anim = null;
    this.request();
    this.onCameraChange();
  }

  // ------------------------------------------------------------ input

  private bindInput() {
    const cv = this.canvas;
    let down: { x: number; y: number; cx: number; cy: number; moved: boolean; id: number } | null = null;
    cv.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      cv.setPointerCapture(e.pointerId);
      down = { x: e.clientX, y: e.clientY, cx: this.cam.x, cy: this.cam.y, moved: false, id: e.pointerId };
    });
    cv.addEventListener('pointermove', (e) => {
      const r = cv.getBoundingClientRect();
      const sx = e.clientX - r.left, sy = e.clientY - r.top;
      if (down) {
        const dx = e.clientX - down.x, dy = e.clientY - down.y;
        if (!down.moved && Math.hypot(dx, dy) > 4) {
          down.moved = true;
          cv.classList.add('dragging');
        }
        if (down.moved) {
          this.anim = null;
          this.cam.x = down.cx - dx / this.cam.zoom;
          this.cam.y = down.cy - dy / this.cam.zoom;
          this.request();
          this.onCameraChange();
        }
      }
      const t = this.placing ? this.screenToTile(sx, sy) : this.pick(sx, sy);
      if (!this.hover || this.hover.x !== t.x || this.hover.y !== t.y) {
        this.hover = t;
        this.request();
      }
      this.onHover(t.x, t.y, sx, sy);
    });
    const up = (e: PointerEvent) => {
      if (!down || e.pointerId !== down.id) return;
      cv.classList.remove('dragging');
      const wasClick = !down.moved;
      down = null;
      if (wasClick) {
        const r = cv.getBoundingClientRect();
        const sx = e.clientX - r.left, sy = e.clientY - r.top;
        const t = this.placing ? this.screenToTile(sx, sy) : this.pick(sx, sy);
        this.onClickTile(t.x, t.y, sx, sy);
      }
    };
    cv.addEventListener('pointerup', up);
    cv.addEventListener('pointercancel', () => {
      down = null;
      cv.classList.remove('dragging');
    });
    cv.addEventListener('pointerleave', () => {
      this.hover = null;
      this.request();
      this.onHover(NaN, NaN, -1, -1);
    });
    cv.addEventListener('wheel', (e) => {
      e.preventDefault();
      const r = cv.getBoundingClientRect();
      const f = Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0018));
      this.zoomAt(e.clientX - r.left, e.clientY - r.top, f);
    }, { passive: false });
    window.addEventListener('keydown', (e) => {
      if ((e.target as HTMLElement)?.closest?.('input, textarea')) return;
      const k = e.key.toLowerCase();
      if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'w', 'a', 's', 'd'].includes(k)) {
        this.keys.add(k);
        this.request();
      } else if (k === '+' || k === '=') this.zoomAt(this.w / 2, this.h / 2, 1.25);
      else if (k === '-' || k === '_') this.zoomAt(this.w / 2, this.h / 2, 0.8);
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.key.toLowerCase()));
    window.addEventListener('blur', () => this.keys.clear());

    // minimap
    const jump = (e: PointerEvent) => {
      const r = this.mini.getBoundingClientRect();
      const mx = ((e.clientX - r.left) / r.width) * this.mini.width, my = ((e.clientY - r.top) / r.height) * this.mini.height;
      const { s, ox, oy } = this.miniXf;
      this.cam.x = (mx - ox) / s;
      this.cam.y = (my - oy) / s;
      this.anim = null;
      this.request();
      this.onCameraChange();
    };
    let miniDown = false;
    this.mini.addEventListener('pointerdown', (e) => {
      miniDown = true;
      this.mini.setPointerCapture(e.pointerId);
      jump(e);
    });
    this.mini.addEventListener('pointermove', (e) => miniDown && jump(e));
    this.mini.addEventListener('pointerup', () => (miniDown = false));
  }

  // ------------------------------------------------------------ frame loop

  request() {
    if (!this.raf) this.raf = requestAnimationFrame((t) => this.frame(t));
  }

  private frame(now: number) {
    this.raf = 0;
    if (!this.world) return;
    let again = false;
    if (this.anim) {
      const t = Math.min(1, (now - this.anim.t0) / this.anim.dur);
      const e = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
      const { from, to } = this.anim;
      // zoom interpolated in log space
      this.cam.zoom = Math.exp(Math.log(from.zoom) + (Math.log(to.zoom) - Math.log(from.zoom)) * e);
      this.cam.x = from.x + (to.x - from.x) * e;
      this.cam.y = from.y + (to.y - from.y) * e;
      if (t >= 1) this.anim = null;
      else again = true;
      this.onCameraChange();
    }
    if (this.keys.size) {
      const sp = 14 / this.cam.zoom;
      if (this.keys.has('arrowleft') || this.keys.has('a')) this.cam.x -= sp;
      if (this.keys.has('arrowright') || this.keys.has('d')) this.cam.x += sp;
      if (this.keys.has('arrowup') || this.keys.has('w')) this.cam.y -= sp;
      if (this.keys.has('arrowdown') || this.keys.has('s')) this.cam.y += sp;
      again = true;
      this.onCameraChange();
    }
    if (this.focusTile && now < this.focusTile.until) again = true;
    if (this.draw(now)) again = true;
    this.drawMini();
    if (again) this.request();
  }

  private bucket(): number {
    const z = this.cam.zoom * this.dpr;
    let b = Math.pow(2, Math.ceil(Math.log2(z) - 0.15));
    b = Math.max(1 / 32, Math.min(2, b));
    return b;
  }

  private chunkRect(cx: number, cy: number) {
    const left = ((cx - cy) * CH - CH) * (TW / 2) - MX;
    const top = (cx + cy) * CH * (TH / 2) - MT;
    return { left, top, w: CH * TW + 2 * MX, h: CH * TH + MT + MB };
  }

  /** Returns true if more work is pending (another frame needed). */
  private draw(now: number): boolean {
    const g = this.ctx;
    const { zoom } = this.cam;
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    // water
    g.fillStyle = '#3d8db3';
    g.fillRect(0, 0, this.w, this.h);
    if (this.waterPattern && zoom > 0.12) {
      const m = new DOMMatrix();
      const o = this.worldToScreen(0, 0);
      m.translateSelf(o.x, o.y).scaleSelf(zoom, zoom);
      this.waterPattern.setTransform(m);
      g.globalAlpha = Math.min(1, (zoom - 0.12) * 2.5);
      g.fillStyle = this.waterPattern;
      g.fillRect(0, 0, this.w, this.h);
      g.globalAlpha = 1;
    }

    const b = this.bucket();
    const v0 = this.screenToWorld(0, 0), v1 = this.screenToWorld(this.w, this.h);
    const visible: { cx: number; cy: number; r: ReturnType<Renderer['chunkRect']>; key: string }[] = [];
    for (const [cx, cy] of this.contentList) {
      const r = this.chunkRect(cx, cy);
      if (r.left > v1.x || r.left + r.w < v0.x || r.top > v1.y || r.top + r.h < v0.y) continue;
      visible.push({ cx, cy, r, key: `${b}:${cx}:${cy}` });
    }
    // bake missing chunks within a time budget, nearest to the screen centre first
    const missing = visible.filter((v) => !this.chunks.has(v.key));
    let pending = missing.length;
    if (missing.length) {
      const ccx = this.cam.x, ccy = this.cam.y;
      missing.sort((a, b2) => Math.hypot(a.r.left + a.r.w / 2 - ccx, a.r.top + a.r.h / 2 - ccy) - Math.hypot(b2.r.left + b2.r.w / 2 - ccx, b2.r.top + b2.r.h / 2 - ccy));
      const t0 = performance.now();
      const budget = this.chunks.size === 0 ? 40 : 12;
      for (const m of missing) {
        this.bake(b, m.cx, m.cy);
        pending--;
        if (performance.now() - t0 > budget) break;
      }
    }
    this.bakingPending = pending;
    this.frameNo++;
    g.imageSmoothingEnabled = true;
    g.imageSmoothingQuality = zoom < 0.5 ? 'medium' : 'low';
    for (const v of visible) {
      let ch = this.chunks.get(v.key);
      if (!ch) {
        // stand-in: any other bucket of this chunk
        for (const alt of [b * 2, b / 2, b * 4, b / 4, b * 8, b / 8]) {
          ch = this.chunks.get(`${alt}:${v.cx}:${v.cy}`);
          if (ch) break;
        }
        if (!ch) continue;
      }
      ch.used = this.frameNo;
      const s = this.worldToScreen(v.r.left, v.r.top);
      g.drawImage(ch.c, s.x, s.y, v.r.w * zoom, v.r.h * zoom);
    }
    this.evict();
    this.drawOverlays(now);
    return pending > 0;
  }

  private evict() {
    if (this.pixels <= PIXEL_BUDGET) return;
    const list = [...this.chunks.entries()].sort((a, b) => a[1].used - b[1].used);
    for (const [k, ch] of list) {
      if (this.pixels <= PIXEL_BUDGET * 0.8) break;
      if (ch.used === this.frameNo) continue;
      this.chunks.delete(k);
      this.pixels -= ch.px;
    }
  }

  // ------------------------------------------------------------ baking

  private bake(b: number, cx: number, cy: number) {
    const w = this.world;
    const r = this.chunkRect(cx, cy);
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.ceil(r.w * b));
    c.height = Math.max(1, Math.ceil(r.h * b));
    const g = c.getContext('2d')!;
    g.setTransform(b, 0, 0, b, -r.left * b, -r.top * b);
    g.imageSmoothingEnabled = true;
    g.imageSmoothingQuality = 'high';
    const gs = groundSprites();
    const ds = decoSprites();
    const x0 = cx * CH, y0 = cy * CH;
    const order: [number, number][] = [];
    for (let s = 0; s < CH * 2 - 1; s++)
      for (let x = Math.max(0, s - CH + 1); x <= Math.min(CH - 1, s); x++) order.push([x0 + x, y0 + s - x]);

    const put = (sp: Sprite, x: number, y: number, alpha = 1) => {
      const m = mip(sp, b);
      const a = tileAnchor(x, y);
      const k = 1 / b;
      if (alpha !== 1) g.globalAlpha = alpha;
      g.drawImage(m.c, a.x - m.ox * k, a.y - m.oy * k, m.c.width * k, m.c.height * k);
      if (alpha !== 1) g.globalAlpha = 1;
    };
    const isLand = (x: number, y: number) => w.isLand(x, y);
    const themeOf = (x: number, y: number) => {
      const l = w.landAt(x, y);
      const lm = l ? w.getLandmass(l) : undefined;
      return lm ? lm.theme : 0;
    };
    const diamond = (x: number, y: number, dz: number, inset = 0) => {
      const a = tileAnchor(x, y);
      const hw = TW / 2 - inset * 2, hh = TH / 2 - inset;
      g.moveTo(a.x, a.y - hh + dz);
      g.lineTo(a.x + hw, a.y + dz);
      g.lineTo(a.x, a.y + hh + dz);
      g.lineTo(a.x - hw, a.y + dz);
      g.closePath();
    };

    // 1. water level: shallows + foam around coasts
    const shallow1 = new Path2D(), shallow2 = new Path2D();
    g.beginPath();
    for (const [x, y] of order) {
      if (isLand(x, y)) continue;
      let near = 0;
      for (let dy = -2; dy <= 2 && near < 2; dy++)
        for (let dx = -2; dx <= 2; dx++) {
          if (!isLand(x + dx, y + dy)) continue;
          near = Math.max(near, Math.abs(dx) <= 1 && Math.abs(dy) <= 1 ? 2 : 1);
        }
      if (!near) continue;
      const a = tileAnchor(x, y);
      const p = near === 2 ? shallow1 : shallow2;
      p.moveTo(a.x, a.y - TH / 2 + CLIFF);
      p.lineTo(a.x + TW / 2, a.y + CLIFF);
      p.lineTo(a.x, a.y + TH / 2 + CLIFF);
      p.lineTo(a.x - TW / 2, a.y + CLIFF);
      p.closePath();
    }
    g.fillStyle = 'rgb(140 230 225 / 0.16)';
    g.fill(shallow2);
    g.fillStyle = 'rgb(150 236 228 / 0.34)';
    g.fill(shallow1);
    // foam on the front cliffs' feet
    if (b >= 0.25) {
      g.strokeStyle = 'rgb(255 255 255 / 0.75)';
      g.lineWidth = 1.6;
      g.beginPath();
      for (const [x, y] of order) {
        if (!isLand(x, y)) continue;
        const a = tileAnchor(x, y);
        if (!isLand(x + 1, y) && w.t(x + 1, y) !== T.BRIDGE) {
          g.moveTo(a.x + TW / 2 + 2, a.y + CLIFF + 1);
          g.lineTo(a.x + 2, a.y + TH / 2 + CLIFF + 1);
        }
        if (!isLand(x, y + 1) && w.t(x, y + 1) !== T.BRIDGE) {
          g.moveTo(a.x - TW / 2 - 2, a.y + CLIFF + 1);
          g.lineTo(a.x - 2, a.y + TH / 2 + CLIFF + 1);
        }
      }
      g.stroke();
    }

    // 2. cliffs
    for (const [x, y] of order) {
      if (!isLand(x, y)) continue;
      const th = themeOf(x, y), sandy = w.t(x, y) === T.SAND ? 1 : 0;
      if (!isLand(x + 1, y)) put(gs.cliffR[th][sandy], x, y);
      if (!isLand(x, y + 1)) put(gs.cliffL[th][sandy], x, y);
    }

    // 3. ground (one land-coloured underlay hides AA seams at tiny scales)
    if (b <= 0.25) {
      g.beginPath();
      for (const [x, y] of order) if (isLand(x, y)) diamond(x, y, 0);
      g.fillStyle = '#6f9a4f';
      g.fill();
    }
    const roadLike = (x: number, y: number) => {
      const t = w.t(x, y);
      return t === T.ROAD || t === T.BRIDGE;
    };
    const realPads: [number, number][] = [];
    for (const [x, y] of order) {
      const i = w.idx(x, y);
      if (i < 0) continue;
      const t = w.terr[i];
      if (t === T.WATER) continue;
      const hv = hash3(x, y, 7);
      if (t === T.BRIDGE) {
        put(gs.bridge[w.aux[i] === 2 ? 1 : 0], x, y);
        continue;
      }
      const th = themeOf(x, y);
      switch (t) {
        case T.GRASS: put(gs.grass[th][hv & 3], x, y); break;
        case T.SAND: put(gs.sand[hv % 3], x, y); break;
        case T.PARK: put(gs.park[th][hv & 1], x, y); break;
        case T.PLAZA: put(gs.plaza[hv & 1], x, y); break;
        case T.ROAD: {
          const m = (roadLike(x - 1, y) ? 1 : 0) | (roadLike(x + 1, y) ? 2 : 0) | (roadLike(x, y - 1) ? 4 : 0) | (roadLike(x, y + 1) ? 8 : 0);
          put(gs.road[m], x, y);
          break;
        }
        case T.PLOT: {
          const real = this.real.get(pack(x, y));
          const bl = w.bld[i];
          if (real) {
            put(gs.plotPad[th][real.family], x, y);
            realPads.push([x, y]);
          } else if (bl) put(gs.plotPad[th][bldFamily(bl)], x, y);
          else put(gs.plotFree[th], x, y);
          break;
        }
      }
    }
    // glowing rim around real-name plots
    if (realPads.length) {
      for (const [lw, col] of [[5, 'rgb(190 120 255 / 0.35)'], [2, 'rgb(236 205 255 / 0.95)']] as const) {
        g.beginPath();
        for (const [x, y] of realPads) diamond(x, y, 0, 2.5);
        g.strokeStyle = col;
        g.lineWidth = lw;
        g.stroke();
      }
    }

    // 4. cast shadows (light from the upper left → shadows fall to the right)
    g.fillStyle = 'rgb(18 28 60 / 0.2)';
    g.beginPath();
    for (const [x, y] of order) {
      const h = this.objectHeight(x, y);
      if (!h) continue;
      const r2 = this.real.get(pack(x, y));
      const bl = w.bld[w.idx(x, y)];
      const fam = r2 ? r2.family : bldFamily(bl), vr = r2 ? r2.variant : bldVariant(bl);
      const { fp } = buildingMetrics(fam, vr);
      const len = Math.min(1.6, h / 70);
      const du = len, dv = -len * 0.55;
      const P2 = (u: number, v: number) => {
        const a = tileAnchor(x, y);
        return { x: a.x + (u - v) * (TW / 2), y: a.y + (u + v - 1) * (TH / 2) };
      };
      const [u0, v0, u1, v1] = fp;
      const pts = [P2(u0, v1), P2(u1, v1), P2(u1 + du, v1 + dv), P2(u1 + du, v0 + dv), P2(u0 + du, v0 + dv), P2(u0, v0)];
      g.moveTo(pts[0].x, pts[0].y);
      for (let k = 1; k < pts.length; k++) g.lineTo(pts[k].x, pts[k].y);
      g.closePath();
    }
    g.fill();

    // 5. objects
    for (const [x, y] of order) {
      const i = w.idx(x, y);
      if (i < 0) continue;
      const real = this.real.get(pack(x, y));
      if (real) {
        put(buildingSprite(real.family, real.variant), x, y);
        continue;
      }
      const bl = w.bld[i];
      if (bl) {
        put(buildingSprite(bldFamily(bl), bldVariant(bl)), x, y);
        continue;
      }
      const d = w.deco[i];
      if (d) {
        const list = ds.get(d);
        if (list) put(list[hash3(x, y, 3) % list.length], x, y);
      }
    }

    const key = `${b}:${cx}:${cy}`;
    const px = c.width * c.height;
    this.chunks.set(key, { c, b, px, used: this.frameNo });
    this.pixels += px;
    void D;
  }

  // ------------------------------------------------------------ overlays

  private landOutline(uid: number): Path2D | null {
    const hit = this.outlines.get(uid);
    if (hit) return hit;
    const l = this.world.getLandmass(uid);
    if (!l) return null;
    const p = new Path2D();
    const corner = (x: number, y: number) => ({ x: (x - y) * (TW / 2), y: (x + y) * (TH / 2) });
    const seg = (a: { x: number; y: number }, b: { x: number; y: number }) => {
      p.moveTo(a.x, a.y);
      p.lineTo(b.x, b.y);
    };
    for (let y = l.minY; y <= l.maxY; y++)
      for (let x = l.minX; x <= l.maxX; x++) {
        if (this.world.landAt(x, y) !== uid) continue;
        if (this.world.landAt(x - 1, y) !== uid) seg(corner(x, y), corner(x, y + 1));
        if (this.world.landAt(x + 1, y) !== uid) seg(corner(x + 1, y), corner(x + 1, y + 1));
        if (this.world.landAt(x, y - 1) !== uid) seg(corner(x, y), corner(x + 1, y));
        if (this.world.landAt(x, y + 1) !== uid) seg(corner(x, y + 1), corner(x + 1, y + 1));
      }
    this.outlines.set(uid, p);
    return p;
  }

  private drawOverlays(now: number) {
    const g = this.ctx;
    const { zoom } = this.cam;
    const worldXf = () => {
      const o = this.worldToScreen(0, 0);
      g.setTransform(this.dpr * zoom, 0, 0, this.dpr * zoom, o.x * this.dpr, o.y * this.dpr);
    };
    const screenXf = () => g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    const v0 = this.screenToWorld(-80, -80), v1 = this.screenToWorld(this.w + 80, this.h + 200);
    const onScreen = (a: { x: number; y: number }) => a.x > v0.x && a.x < v1.x && a.y > v0.y && a.y < v1.y;
    const dia = (path: Path2D | CanvasRenderingContext2D, x: number, y: number, inset = 0) => {
      const a = tileAnchor(x, y);
      const hw = TW / 2 - inset * 2, hh = TH / 2 - inset;
      path.moveTo(a.x, a.y - hh);
      path.lineTo(a.x + hw, a.y);
      path.lineTo(a.x, a.y + hh);
      path.lineTo(a.x - hw, a.y);
      path.closePath();
    };

    // selected landmass outline
    if (this.selectedLand && !this.placing) {
      const p = this.landOutline(this.selectedLand);
      if (p) {
        worldXf();
        g.lineCap = 'round';
        g.strokeStyle = 'rgb(255 214 120 / 0.35)';
        g.lineWidth = 9 / zoom;
        g.stroke(p);
        g.strokeStyle = '#ffe08a';
        g.lineWidth = 2.5 / zoom;
        g.stroke(p);
      }
    }

    // placement mode: dim the map, light up every open plot
    if (this.placing) {
      screenXf();
      g.fillStyle = 'rgb(16 18 40 / 0.38)';
      g.fillRect(0, 0, this.w, this.h);
      worldXf();
      // all open plots as one cached path (rebuilt only when the world or placements change)
      if (!this.openPath || this.openFor !== this.placing.namehash) {
        const open = new Path2D();
        for (const l of this.world.landmasses)
          for (const k of l.plots) {
            const x = unpackX(k), y = unpackY(k);
            if (this.canPlace(x, y)) dia(open, x, y, 1.5);
          }
        this.openPath = open;
        this.openFor = this.placing.namehash;
      }
      const open = this.openPath;
      const pulse = 0.55 + Math.sin(now / 300) * 0.15;
      g.fillStyle = `rgb(120 255 190 / ${pulse * 0.45})`;
      g.fill(open);
      if (zoom > 0.25) {
        g.strokeStyle = 'rgb(170 255 210 / 0.9)';
        g.lineWidth = 1.2 / zoom;
        g.stroke(open);
      }
      this.request();
    }

    // hover
    if (this.hover && zoom > 0.15) {
      const { x, y } = this.hover;
      worldXf();
      if (this.placing) {
        const ok = this.canPlace(x, y);
        const p = new Path2D();
        dia(p, x, y, 0.5);
        g.fillStyle = ok ? 'rgb(120 255 190 / 0.5)' : 'rgb(255 90 110 / 0.35)';
        g.fill(p);
        g.strokeStyle = ok ? '#bfffe0' : '#ff8a9a';
        g.lineWidth = 2 / zoom;
        g.stroke(p);
        if (ok) {
          const bb = Math.min(this.bucket(), S);
          const sp = mip(buildingSprite(this.placing.family, this.placing.variant), bb);
          const a = tileAnchor(x, y);
          const k = 1 / bb;
          g.globalAlpha = 0.72;
          g.drawImage(sp.c, a.x - sp.ox * k, a.y - sp.oy * k, sp.c.width * k, sp.c.height * k);
          g.globalAlpha = 1;
        }
      } else if (this.world.isLand(x, y)) {
        const p = new Path2D();
        dia(p, x, y, 0.5);
        g.strokeStyle = 'rgb(255 255 255 / 0.85)';
        g.lineWidth = 1.5 / zoom;
        g.stroke(p);
      }
    }

    // focus pulse (fly-to target)
    if (this.focusTile && now < this.focusTile.until) {
      worldXf();
      const t = ((now / 900) % 1);
      const a = tileAnchor(this.focusTile.x, this.focusTile.y);
      g.strokeStyle = `rgb(220 180 255 / ${1 - t})`;
      g.lineWidth = 3 / zoom;
      g.beginPath();
      g.ellipse(a.x, a.y, 20 + t * 40, (20 + t * 40) / 2, 0, 0, Math.PI * 2);
      g.stroke();
    }

    // real-name labels / pins
    screenXf();
    const placed: { x0: number; y0: number; x1: number; y1: number }[] = [];
    const items = [...this.real.entries()].map(([k, r]) => ({ x: unpackX(k), y: unpackY(k), r }));
    items.sort((a, b) => b.x + b.y - (a.x + a.y));
    g.font = '600 12px Inter, system-ui, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    for (const it of items) {
      const a = tileAnchor(it.x, it.y);
      if (!onScreen(a)) continue;
      const h = buildingMetrics(it.r.family, it.r.variant).h;
      if (zoom >= 0.42) {
        const s = this.worldToScreen(a.x, a.y - h - 8);
        const tw = g.measureText(it.r.name).width + 18;
        const rect = { x0: s.x - tw / 2, y0: s.y - 22, x1: s.x + tw / 2, y1: s.y };
        if (placed.some((p) => rect.x0 < p.x1 && rect.x1 > p.x0 && rect.y0 < p.y1 && rect.y1 > p.y0)) continue;
        placed.push(rect);
        g.fillStyle = 'rgb(28 18 54 / 0.9)';
        roundRect(g, rect.x0, rect.y0, tw, 20, 10);
        g.fill();
        g.strokeStyle = '#b98cff';
        g.lineWidth = 1.5;
        g.stroke();
        g.fillStyle = 'rgb(28 18 54 / 0.9)';
        g.beginPath();
        g.moveTo(s.x - 5, s.y);
        g.lineTo(s.x + 5, s.y);
        g.lineTo(s.x, s.y + 6);
        g.fill();
        g.fillStyle = '#ffffff';
        g.fillText(it.r.name, s.x, s.y - 10);
      } else {
        const s = this.worldToScreen(a.x, a.y - h * 0.6);
        const r = 6;
        g.fillStyle = 'rgb(185 140 255 / 0.35)';
        g.beginPath();
        g.arc(s.x, s.y - r * 2, r * 2.2, 0, Math.PI * 2);
        g.fill();
        g.fillStyle = '#9b6bff';
        g.beginPath();
        g.moveTo(s.x, s.y);
        g.arc(s.x, s.y - r * 2, r, Math.PI * 0.75, Math.PI * 2.25);
        g.closePath();
        g.fill();
        g.strokeStyle = '#fff';
        g.lineWidth = 1.5;
        g.stroke();
        g.fillStyle = '#fff';
        g.beginPath();
        g.arc(s.x, s.y - r * 2, 2.2, 0, Math.PI * 2);
        g.fill();
      }
    }

    // landmass name tags when zoomed out
    if (zoom < 0.32) {
      g.font = '600 11px Inter, system-ui, sans-serif';
      for (const l of this.world.landmasses) {
        const a = tileAnchor(l.cx, l.cy);
        if (!onScreen(a)) continue;
        const s = this.worldToScreen(a.x, a.y);
        const sel = l.uid === this.selectedLand;
        const text = l.name;
        const tw = g.measureText(text).width + 14;
        const rect = { x0: s.x - tw / 2 - 3, y0: s.y - 12, x1: s.x + tw / 2 + 3, y1: s.y + 12 };
        if (!sel && placed.some((p) => rect.x0 < p.x1 && rect.x1 > p.x0 && rect.y0 < p.y1 && rect.y1 > p.y0)) continue;
        placed.push(rect);
        g.fillStyle = sel ? 'rgb(255 224 138 / 0.95)' : 'rgb(255 255 255 / 0.78)';
        roundRect(g, s.x - tw / 2, s.y - 9, tw, 18, 9);
        g.fill();
        g.fillStyle = '#1d2140';
        g.fillText(text, s.x, s.y);
      }
    }
  }

  // ------------------------------------------------------------ minimap

  private drawMini() {
    const m = this.mini;
    if (!m.isConnected || m.offsetParent === null) return;
    const g = m.getContext('2d')!;
    if (!this.miniBase) this.buildMini();
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, m.width, m.height);
    if (this.miniBase) g.drawImage(this.miniBase, 0, 0);
    const { s, ox, oy } = this.miniXf;
    const v0 = this.screenToWorld(0, 0), v1 = this.screenToWorld(this.w, this.h);
    g.strokeStyle = '#ffffff';
    g.lineWidth = 1.5;
    g.strokeRect(v0.x * s + ox, v0.y * s + oy, (v1.x - v0.x) * s, (v1.y - v0.y) * s);
    // real names
    g.fillStyle = '#c79bff';
    for (const k of this.real.keys()) {
      const a = tileAnchor(unpackX(k), unpackY(k));
      g.beginPath();
      g.arc(a.x * s + ox, a.y * s + oy, 2.5, 0, Math.PI * 2);
      g.fill();
    }
  }

  private buildMini() {
    const w = this.world;
    const m = this.mini;
    const b = w.bounds();
    const pts = [tileAnchor(b.minX, b.minY), tileAnchor(b.maxX, b.minY), tileAnchor(b.minX, b.maxY), tileAnchor(b.maxX, b.maxY)];
    const x0 = Math.min(...pts.map((p) => p.x)) - 60, x1 = Math.max(...pts.map((p) => p.x)) + 60;
    const y0 = Math.min(...pts.map((p) => p.y)) - 60, y1 = Math.max(...pts.map((p) => p.y)) + 60;
    const s = Math.min(m.width / (x1 - x0), m.height / (y1 - y0));
    const ox = (m.width - (x1 - x0) * s) / 2 - x0 * s, oy = (m.height - (y1 - y0) * s) / 2 - y0 * s;
    this.miniXf = { s, ox, oy };
    const c = document.createElement('canvas');
    c.width = m.width;
    c.height = m.height;
    const g = c.getContext('2d')!;
    const px = Math.max(1, TW * s * 0.75);
    for (const l of w.landmasses) {
      const [hh, ss, ll] = THEMES[l.theme].grass;
      const grass = `hsl(${hh} ${ss}% ${ll + 4}%)`;
      for (let y = l.minY; y <= l.maxY; y++)
        for (let x = l.minX; x <= l.maxX; x++) {
          const i = w.idx(x, y);
          if (w.land[i] !== l.uid) continue;
          const t = w.terr[i];
          g.fillStyle = w.bld[i] ? '#e8b07a' : t === T.ROAD ? '#8a8d99' : t === T.SAND ? '#ead6a0' : t === T.PLOT ? '#c9e6a8' : grass;
          const a = tileAnchor(x, y);
          g.fillRect(a.x * s + ox - px / 2, a.y * s + oy - px / 4, px, px / 2 + 0.6);
        }
    }
    g.fillStyle = '#a8774a';
    for (const br of w.bridges)
      for (const k of br.tiles) {
        const a = tileAnchor(unpackX(k), unpackY(k));
        g.fillRect(a.x * s + ox - px / 2, a.y * s + oy - px / 4, px, px / 2 + 0.6);
      }
    this.miniBase = c;
  }

  // ------------------------------------------------------------ misc

  private makeWaterPattern() {
    const c = document.createElement('canvas');
    c.width = 256;
    c.height = 128;
    const g = c.getContext('2d')!;
    let s = 7;
    const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 26; i++) {
      const x = rnd() * 256, y = rnd() * 128, w = 8 + rnd() * 18;
      g.strokeStyle = rnd() < 0.6 ? 'rgb(200 240 255 / 0.22)' : 'rgb(20 60 100 / 0.16)';
      g.lineWidth = 1.2;
      for (const dx of [-256, 0, 256]) {
        g.beginPath();
        g.moveTo(x + dx - w / 2, y);
        g.quadraticCurveTo(x + dx, y - 3, x + dx + w / 2, y);
        g.stroke();
      }
    }
    this.waterPattern = this.ctx.createPattern(c, 'repeat');
  }

  get viewW() {
    return this.w;
  }
  get viewH() {
    return this.h;
  }
}

function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}
