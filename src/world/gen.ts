/**
 * Procedural world generation. Fully deterministic from seeds so the world can
 * be rebuilt after a refresh from {seed, preset, ops} alone.
 */
import { fbm, hash01, mulberry32, Rng } from '../rng';
import { D, Landmass, T, THEMES, VARIANTS, World, bldCode, pack, unpackX, unpackY } from './world';

/** Minimum number of water tiles between two landmasses. */
const GAP = 3;
const DIRS4 = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
] as const;

// --------------------------------------------------------------- shapes

interface Shape {
  w: number;
  h: number;
  mask: Uint8Array;
  area: number;
}

function smooth(mask: Uint8Array, w: number, h: number): Uint8Array {
  const out = new Uint8Array(mask.length);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let n = 0;
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          const xx = x + dx, yy = y + dy;
          if (xx >= 0 && yy >= 0 && xx < w && yy < h) n += mask[yy * w + xx];
        }
      const i = y * w + x;
      out[i] = n >= 5 ? 1 : n <= 3 ? 0 : mask[i];
    }
  return out;
}

/** Remove 1-tile-thin necks/spikes (land with < 2 orthogonal land neighbours). */
function thin(mask: Uint8Array, w: number, h: number) {
  for (let pass = 0; pass < 2; pass++)
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (!mask[i]) continue;
        let n = 0;
        for (const [dx, dy] of DIRS4) {
          const xx = x + dx, yy = y + dy;
          if (xx >= 0 && yy >= 0 && xx < w && yy < h && mask[yy * w + xx]) n++;
        }
        if (n < 2) mask[i] = 0;
      }
}

/** Components of cells where mask[i] === val (4-connected). Returns label array + sizes. */
function components(mask: Uint8Array, w: number, h: number, val: number) {
  const lab = new Int32Array(mask.length).fill(-1);
  const sizes: number[] = [];
  const touchesEdge: boolean[] = [];
  const stack: number[] = [];
  for (let s = 0; s < mask.length; s++) {
    if (mask[s] !== val || lab[s] >= 0) continue;
    const id = sizes.length;
    let size = 0, edge = false;
    lab[s] = id;
    stack.push(s);
    while (stack.length) {
      const i = stack.pop()!;
      size++;
      const x = i % w, y = (i / w) | 0;
      if (x === 0 || y === 0 || x === w - 1 || y === h - 1) edge = true;
      for (const [dx, dy] of DIRS4) {
        const xx = x + dx, yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
        const j = yy * w + xx;
        if (mask[j] === val && lab[j] < 0) {
          lab[j] = id;
          stack.push(j);
        }
      }
    }
    sizes.push(size);
    touchesEdge.push(edge);
  }
  return { lab, sizes, touchesEdge };
}

function keepLargest(mask: Uint8Array, w: number, h: number) {
  const { lab, sizes } = components(mask, w, h, 1);
  if (!sizes.length) return;
  let best = 0;
  for (let i = 1; i < sizes.length; i++) if (sizes[i] > sizes[best]) best = i;
  for (let i = 0; i < mask.length; i++) if (mask[i] && lab[i] !== best) mask[i] = 0;
}

function fillLakes(mask: Uint8Array, w: number, h: number, rng: Rng) {
  const { lab, sizes, touchesEdge } = components(mask, w, h, 0);
  const keep = sizes.map((s, i) => !touchesEdge[i] && s >= 6 && s <= 40 && rng.chance(0.45));
  for (let i = 0; i < mask.length; i++) if (!mask[i] && !touchesEdge[lab[i]] && !keep[lab[i]]) mask[i] = 1;
}

/** An irregular island outline of roughly `targetArea` tiles: blobs along a bent spine + noise + coves. */
function makeShape(rng: Rng, targetArea: number): Shape {
  const R = Math.sqrt(targetArea / Math.PI);
  const blobs: { x: number; y: number; r: number }[] = [];
  const nb = rng.int(2, 4);
  let px = 0, py = 0, ang = rng.range(0, Math.PI * 2);
  for (let i = 0; i < nb; i++) {
    blobs.push({ x: px, y: py, r: R * rng.range(0.5, 0.85) });
    ang += rng.range(-1.2, 1.2);
    const step = R * rng.range(0.45, 0.85);
    px += Math.cos(ang) * step;
    py += Math.sin(ang) * step;
  }
  const mx = blobs.reduce((s, b) => s + b.x, 0) / nb, my = blobs.reduce((s, b) => s + b.y, 0) / nb;
  for (const b of blobs) {
    b.x -= mx;
    b.y -= my;
  }
  const coves: { x: number; y: number; r: number }[] = [];
  const nc = rng.int(1, 3);
  for (let i = 0; i < nc; i++) {
    const b = rng.pick(blobs), a = rng.range(0, Math.PI * 2), d = b.r * rng.range(0.8, 1.05);
    coves.push({ x: b.x + Math.cos(a) * d, y: b.y + Math.sin(a) * d, r: R * rng.range(0.16, 0.3) });
  }
  const nseed = rng.int(1, 1e9), nscale = rng.range(5, 9), namp = rng.range(0.45, 0.8);
  const lakeRng = mulberry32(nseed ^ 0x5bd1e995);

  let scale = 1;
  let best: Shape | null = null;
  for (let iter = 0; iter < 4; iter++) {
    let bx0 = Infinity, by0 = Infinity, bx1 = -Infinity, by1 = -Infinity;
    for (const b of blobs) {
      bx0 = Math.min(bx0, (b.x - b.r) * scale);
      by0 = Math.min(by0, (b.y - b.r) * scale);
      bx1 = Math.max(bx1, (b.x + b.r) * scale);
      by1 = Math.max(by1, (b.y + b.r) * scale);
    }
    const ox = Math.floor(bx0) - 5, oy = Math.floor(by0) - 5;
    const w = Math.ceil(bx1) + 5 - ox, h = Math.ceil(by1) + 5 - oy;
    let mask = new Uint8Array(w * h);
    for (let gy = 0; gy < h; gy++)
      for (let gx = 0; gx < w; gx++) {
        const x = gx + ox, y = gy + oy, ux = x / scale, uy = y / scale;
        let f = -1;
        for (const b of blobs) f = Math.max(f, 1 - Math.hypot(ux - b.x, uy - b.y) / b.r);
        for (const c of coves) f -= Math.max(0, 1 - Math.hypot(ux - c.x, uy - c.y) / c.r) * 1.6;
        f += (fbm(x / nscale, y / nscale, nseed, 3) - 0.5) * namp;
        mask[gy * w + gx] = f > 0 ? 1 : 0;
      }
    mask = smooth(smooth(mask, w, h), w, h);
    thin(mask, w, h);
    keepLargest(mask, w, h);
    fillLakes(mask, w, h, lakeRng);
    let area = 0;
    for (const v of mask) area += v;
    best = { w, h, mask, area };
    if (area > 0 && Math.abs(area - targetArea) / targetArea < 0.12) break;
    scale *= Math.sqrt(targetArea / Math.max(area, 1));
  }
  return crop(best!);
}

function crop(s: Shape): Shape {
  let x0 = s.w, y0 = s.h, x1 = -1, y1 = -1;
  for (let y = 0; y < s.h; y++)
    for (let x = 0; x < s.w; x++)
      if (s.mask[y * s.w + x]) {
        x0 = Math.min(x0, x);
        y0 = Math.min(y0, y);
        x1 = Math.max(x1, x);
        y1 = Math.max(y1, y);
      }
  const w = x1 - x0 + 1, h = y1 - y0 + 1;
  const mask = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) mask[y * w + x] = s.mask[(y + y0) * s.w + x + x0];
  return { w, h, mask, area: s.area };
}

// --------------------------------------------------------------- placement

function collides(world: World, s: Shape, ox: number, oy: number): boolean {
  for (let y = 0; y < s.h; y++)
    for (let x = 0; x < s.w; x++) {
      if (!s.mask[y * s.w + x]) continue;
      const i = world.idx(ox + x, oy + y);
      if (i >= 0 && world.near[i]) return true;
    }
  return false;
}

function stampNear(world: World, x: number, y: number, r: number) {
  for (let dy = -r; dy <= r; dy++)
    for (let dx = -r; dx <= r; dx++) {
      const i = world.idx(x + dx, y + dy);
      if (i >= 0) world.near[i] = 1;
    }
}

function rebuildNear(world: World) {
  world.near.fill(0);
  for (const l of world.landmasses)
    for (let y = l.minY; y <= l.maxY; y++)
      for (let x = l.minX; x <= l.maxX; x++) if (world.landAt(x, y) === l.uid) stampNear(world, x, y, GAP);
  for (const b of world.bridges) for (const k of b.tiles) stampNear(world, unpackX(k), unpackY(k), 1);
}

function degree(world: World, uid: number) {
  let d = 0;
  for (const b of world.bridges) if (b.a === uid || b.b === uid) d++;
  return d;
}

/** Find a spot next to an existing landmass, packed snugly but at least GAP water tiles away. */
function findSpot(world: World, s: Shape, rng: Rng): { ox: number; oy: number; parent: number } {
  if (!world.landmasses.length) return { ox: -Math.floor(s.w / 2), oy: -Math.floor(s.h / 2), parent: 0 };
  const b = world.bounds();
  const wcx = (b.minX + b.maxX) / 2, wcy = (b.minY + b.maxY) / 2;
  let best: { ox: number; oy: number; parent: number; cost: number } | null = null;
  for (let attempt = 0; attempt < 14; attempt++) {
    const parent = rng.weighted(world.landmasses, world.landmasses.map((l) => 1 / (1 + degree(world, l.uid) * 1.5)));
    const [dx, dy] = DIRS4[rng.int(0, 3)];
    const pw = parent.maxX - parent.minX + 1, ph = parent.maxY - parent.minY + 1;
    let ox: number, oy: number;
    if (dx) {
      oy = Math.round(parent.cy - s.h / 2 + rng.range(-0.3, 0.3) * ph);
      ox = Math.round(parent.cx - s.w / 2);
    } else {
      ox = Math.round(parent.cx - s.w / 2 + rng.range(-0.3, 0.3) * pw);
      oy = Math.round(parent.cy - s.h / 2);
    }
    let steps = 0;
    while (collides(world, s, ox, oy) && steps < 400) {
      ox += dx;
      oy += dy;
      steps++;
    }
    const extra = rng.int(0, 3);
    for (let e = 0; e < extra; e++) {
      if (collides(world, s, ox + dx, oy + dy)) break;
      ox += dx;
      oy += dy;
    }
    const ncx = ox + s.w / 2, ncy = oy + s.h / 2;
    const cost = Math.hypot(ncx - wcx, ncy - wcy) + Math.hypot(ncx - parent.cx, ncy - parent.cy) * 0.6 + rng() * 6;
    if (!best || cost < best.cost) best = { ox, oy, parent: parent.uid, cost };
  }
  return best!;
}

// --------------------------------------------------------------- landmass content

const PREFIX = ['Amber', 'Coral', 'Jade', 'Willow', 'Saffron', 'Cobalt', 'Lotus', 'Ember', 'Mist', 'Pine', 'Opal', 'Cinder', 'Lumen', 'Velvet', 'Sable', 'Tidal', 'Aster', 'Kelp', 'Copper', 'Indigo', 'Marigold', 'Heron', 'Lark', 'Moss'];
const SUFFIX = ['Key', 'Reach', 'Isle', 'Point', 'Hollow', 'Bay', 'Shoals', 'Cove', 'Heights', 'Landing', 'Haven', 'Rise', 'Atoll', 'Gardens', 'Quay', 'Bluff'];

/** Distance (in tiles, 4-neighbour BFS) from the coast for every tile of a landmass; 0 = not this landmass. */
function coastDist(world: World, l: Landmass): { dist: Uint16Array; w: number } {
  const w = l.maxX - l.minX + 1, h = l.maxY - l.minY + 1;
  const dist = new Uint16Array(w * h);
  const q: number[] = [];
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      if (world.landAt(x + l.minX, y + l.minY) !== l.uid) continue;
      let coast = false;
      for (const [dx, dy] of DIRS4) if (world.landAt(x + l.minX + dx, y + l.minY + dy) !== l.uid) coast = true;
      if (coast) {
        dist[y * w + x] = 1;
        q.push(y * w + x);
      }
    }
  for (let qi = 0; qi < q.length; qi++) {
    const i = q[qi], x = i % w, y = (i / w) | 0;
    for (const [dx, dy] of DIRS4) {
      const xx = x + dx, yy = y + dy;
      if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
      const j = yy * w + xx;
      if (dist[j] || world.landAt(xx + l.minX, yy + l.minY) !== l.uid) continue;
      dist[j] = dist[i] + 1;
      q.push(j);
    }
  }
  return { dist, w };
}

function layRoads(world: World, l: Landmass, rng: Rng) {
  const th = THEMES[l.theme];
  const { dist, w } = coastDist(world, l);
  const D_ = (x: number, y: number) => dist[(y - l.minY) * w + (x - l.minX)];
  const bw = rng.int(th.block[0], th.block[1]), bh = rng.int(th.block[0], th.block[1]);
  const px = bw + 1, py = bh + 1, ox = rng.int(0, px - 1), oy = rng.int(0, py - 1);
  const sv = rng.int(1, 1e9), sh = rng.int(1, 1e9);
  const pMergeV = rng.range(0.08, 0.22), pMergeH = rng.range(0.08, 0.22);
  const mod = (a: number, m: number) => ((a % m) + m) % m;
  const roads: number[] = [];
  for (let y = l.minY; y <= l.maxY; y++)
    for (let x = l.minX; x <= l.maxX; x++) {
      if (world.landAt(x, y) !== l.uid || D_(x, y) < 2) continue;
      const lx = mod(x - ox, px) === 0, ly = mod(y - oy, py) === 0;
      if (!lx && !ly) continue;
      const ci = Math.floor((x - ox) / px), cj = Math.floor((y - oy) / py);
      if (lx && !ly && hash01(ci, cj, sv) < pMergeV) continue;
      if (ly && !lx && hash01(ci, cj, sh) < pMergeH) continue;
      roads.push(pack(x, y));
    }
  const set = new Set(roads);
  // Keep the largest connected network.
  const seen = new Set<number>();
  let bestComp: number[] = [];
  for (const k of roads) {
    if (seen.has(k)) continue;
    const comp: number[] = [];
    const st = [k];
    seen.add(k);
    while (st.length) {
      const c = st.pop()!;
      comp.push(c);
      const x = unpackX(c), y = unpackY(c);
      for (const [dx, dy] of DIRS4) {
        const n = pack(x + dx, y + dy);
        if (set.has(n) && !seen.has(n)) {
          seen.add(n);
          st.push(n);
        }
      }
    }
    if (comp.length > bestComp.length) bestComp = comp;
  }
  const keep = new Set(bestComp);
  // Trim short dead-end stubs.
  for (let pass = 0; pass < 2; pass++) {
    const drop: number[] = [];
    for (const k of keep) {
      const x = unpackX(k), y = unpackY(k);
      let n = 0;
      for (const [dx, dy] of DIRS4) if (keep.has(pack(x + dx, y + dy))) n++;
      if (n <= 1) drop.push(k);
    }
    for (const k of drop) keep.delete(k);
  }
  if (keep.size < 6) {
    // Tiny or awkward island: a simple cross through the middle.
    const cx = Math.round(l.cx), cy = Math.round(l.cy);
    for (let x = l.minX; x <= l.maxX; x++) if (world.landAt(x, cy) === l.uid && D_(x, cy) >= 2) keep.add(pack(x, cy));
    for (let y = l.minY; y <= l.maxY; y++) if (world.landAt(cx, y) === l.uid && D_(cx, y) >= 2) keep.add(pack(cx, y));
  }
  for (const k of keep) world.terr[world.idx(unpackX(k), unpackY(k))] = T.ROAD;
}

function rebuildPlots(world: World, l: Landmass) {
  l.plots = [];
  for (let y = l.minY; y <= l.maxY; y++)
    for (let x = l.minX; x <= l.maxX; x++) {
      const i = world.idx(x, y);
      if (i >= 0 && world.land[i] === l.uid && world.terr[i] === T.PLOT) l.plots.push(pack(x, y));
    }
}

function treeKind(rng: Rng, weights: number[], coast: boolean) {
  const w = coast ? weights : weights.map((v, i) => (i === 3 ? v * 0.25 : v));
  return rng.weighted([D.TREE_ROUND, D.TREE_CONIFER, D.TREE_SAKURA, D.TREE_PALM, D.TREE_AUTUMN], w);
}

function classify(world: World, l: Landmass, rng: Rng) {
  const th = THEMES[l.theme];
  const { dist, w } = coastDist(world, l);
  const D_ = (x: number, y: number) => dist[(y - l.minY) * w + (x - l.minX)];
  const beachSeed = rng.int(1, 1e9);
  const isRoad = (x: number, y: number) => world.t(x, y) === T.ROAD && world.landAt(x, y) === l.uid;

  for (let y = l.minY; y <= l.maxY; y++)
    for (let x = l.minX; x <= l.maxX; x++) {
      const i = world.idx(x, y);
      if (world.land[i] !== l.uid || world.terr[i] === T.ROAD) continue;
      if (D_(x, y) === 1) world.terr[i] = fbm(x / 5, y / 5, beachSeed, 2) < th.beach * 0.75 + 0.12 ? T.SAND : T.GRASS;
      else {
        let adj = false;
        for (const [dx, dy] of DIRS4) if (isRoad(x + dx, y + dy)) adj = true;
        world.terr[i] = adj ? T.PLOT : T.GRASS;
      }
    }

  // City blocks = connected interior non-road areas. Some become parks, one a plaza with a landmark.
  const bw = w, bh = l.maxY - l.minY + 1;
  const blockMask = new Uint8Array(bw * bh);
  for (let y = 0; y < bh; y++)
    for (let x = 0; x < bw; x++) {
      const t = world.t(x + l.minX, y + l.minY);
      if (world.landAt(x + l.minX, y + l.minY) === l.uid && dist[y * bw + x] >= 2 && (t === T.PLOT || t === T.GRASS)) blockMask[y * bw + x] = 1;
    }
  const { lab, sizes } = components(blockMask, bw, bh, 1);
  const cells: number[][] = sizes.map(() => []);
  for (let i = 0; i < lab.length; i++) if (blockMask[i]) cells[lab[i]].push(i);
  let plaza = -1, plazaD = Infinity;
  cells.forEach((c, id) => {
    if (c.length < 4 || c.length > 30) return;
    let sx = 0, sy = 0;
    for (const i of c) {
      sx += i % bw;
      sy += (i / bw) | 0;
    }
    const d = Math.hypot(sx / c.length + l.minX - l.cx, sy / c.length + l.minY - l.cy);
    if (d < plazaD) {
      plazaD = d;
      plaza = id;
    }
  });
  const parkChance = rng.range(0.08, 0.16);
  cells.forEach((c, id) => {
    let kind: number | null = null;
    if (id === plaza) kind = T.PLAZA;
    else if (c.length >= 4 && rng.chance(parkChance)) kind = T.PARK;
    if (kind === null) return;
    for (const i of c) world.terr[world.idx((i % bw) + l.minX, ((i / bw) | 0) + l.minY)] = kind;
    if (kind === T.PLAZA) {
      let sx = 0, sy = 0;
      for (const i of c) {
        sx += i % bw;
        sy += (i / bw) | 0;
      }
      const mx = sx / c.length, my = sy / c.length;
      let bi = c[0], bd = Infinity;
      for (const i of c) {
        const d = Math.hypot((i % bw) - mx, ((i / bw) | 0) - my);
        if (d < bd) {
          bd = d;
          bi = i;
        }
      }
      world.deco[world.idx((bi % bw) + l.minX, ((bi / bw) | 0) + l.minY)] = rng.pick(th.landmarks);
    }
  });

  // Scenery.
  const dens = th.treeDensity;
  let lighthouse = -1, lhD = -1;
  for (let y = l.minY; y <= l.maxY; y++)
    for (let x = l.minX; x <= l.maxX; x++) {
      const i = world.idx(x, y);
      if (world.land[i] !== l.uid || world.deco[i]) continue;
      const t = world.terr[i];
      const r = rng();
      if (t === T.ROAD) {
        const h = isRoad(x - 1, y) && isRoad(x + 1, y) && !isRoad(x, y - 1) && !isRoad(x, y + 1);
        const v = isRoad(x, y - 1) && isRoad(x, y + 1) && !isRoad(x - 1, y) && !isRoad(x + 1, y);
        if ((h || v) && r < 0.16) world.deco[i] = h ? D.LAMP : D.LAMP_V;
      } else if (D_(x, y) === 1) {
        const d = Math.hypot(x - l.cx, y - l.cy);
        if (d > lhD && (t === T.GRASS || t === T.SAND)) {
          lhD = d;
          lighthouse = i;
        }
        if (t === T.SAND) {
          if (th.trees[3] > 0 && r < 0.22 * dens) world.deco[i] = D.TREE_PALM;
          else if (r > 0.94) world.deco[i] = D.ROCK;
        } else if (t === T.GRASS) {
          if (r < 0.3 * dens) world.deco[i] = treeKind(rng, th.trees, true);
          else if (r < 0.38) world.deco[i] = D.BUSH;
          else if (r > 0.95) world.deco[i] = D.ROCK;
        }
      } else if (t === T.GRASS) {
        if (r < 0.55 * dens) world.deco[i] = treeKind(rng, th.trees, false);
        else if (r < 0.7) world.deco[i] = D.BUSH;
        else if (r < 0.8) world.deco[i] = D.FLOWERS;
      } else if (t === T.PARK) {
        if (r < 0.34 * dens) world.deco[i] = treeKind(rng, th.trees, false);
        else if (r < 0.48) world.deco[i] = D.FLOWERS;
        else if (r < 0.56) world.deco[i] = D.BENCH;
        else if (r < 0.64) world.deco[i] = D.BUSH;
      } else if (t === T.PLAZA) {
        if (r < 0.1) world.deco[i] = D.LAMP;
        else if (r < 0.18) world.deco[i] = D.BENCH;
        else if (r < 0.26) world.deco[i] = D.FLOWERS;
      }
    }
  if (lighthouse >= 0 && (th.id === 'harbor' || rng.chance(0.45))) world.deco[lighthouse] = D.LM_LIGHTHOUSE;
  rebuildPlots(world, l);
}

// --------------------------------------------------------------- bridges

interface BridgeCand {
  axis: 1 | 2;
  tiles: number[];
  ends: [number, number, number, number, number, number]; // ax, ay, adir(x,y) inward for side A..., packed below
  score: number;
}

/** Walk inward from a shore tile; returns how many tiles until a road (or 99). */
function roadDistance(world: World, uid: number, x: number, y: number, dx: number, dy: number): number {
  for (let k = 0; k < 16; k++) {
    const xx = x + dx * k, yy = y + dy * k;
    if (world.landAt(xx, yy) !== uid) return 99;
    if (world.t(xx, yy) === T.ROAD) return k;
  }
  return 99;
}

function solidShore(world: World, uid: number, x: number, y: number, axis: 1 | 2) {
  return axis === 1
    ? world.landAt(x, y - 1) === uid && world.landAt(x, y + 1) === uid
    : world.landAt(x - 1, y) === uid && world.landAt(x + 1, y) === uid;
}

/** Best straight water crossing between landmasses a and b (axis-aligned), or null. */
function findBridge(world: World, a: Landmass, b: Landmass, rng: Rng, maxLen: number): BridgeCand | null {
  let best: BridgeCand | null = null;
  for (const axis of [1, 2] as const) {
    // axis 1: scan rows (bridge runs along x); axis 2: scan columns.
    const lo = axis === 1 ? Math.max(a.minY, b.minY) : Math.max(a.minX, b.minX);
    const hi = axis === 1 ? Math.min(a.maxY, b.maxY) : Math.min(a.maxX, b.maxX);
    const s0 = axis === 1 ? Math.min(a.minX, b.minX) : Math.min(a.minY, b.minY);
    const s1 = axis === 1 ? Math.max(a.maxX, b.maxX) : Math.max(a.maxY, b.maxY);
    for (let line = lo; line <= hi; line++) {
      let lastOwner = 0, lastPos = 0, run = 0, clean = true;
      for (let p = s0; p <= s1; p++) {
        const x = axis === 1 ? p : line, y = axis === 1 ? line : p;
        const t = world.t(x, y);
        if (t === T.WATER) {
          run++;
          continue;
        }
        if (t === T.BRIDGE) {
          clean = false;
          run++;
          continue;
        }
        const owner = world.landAt(x, y);
        if (run > 0 && clean && lastOwner && owner !== lastOwner && run <= maxLen &&
          ((owner === a.uid && lastOwner === b.uid) || (owner === b.uid && lastOwner === a.uid))) {
          // shore tiles: (lastPos) belongs to lastOwner, (p) belongs to owner
          const x1 = axis === 1 ? lastPos : line, y1 = axis === 1 ? line : lastPos;
          const dx = axis === 1 ? 1 : 0, dy = axis === 1 ? 0 : 1;
          const r1 = roadDistance(world, lastOwner, x1, y1, -dx, -dy);
          const r2 = roadDistance(world, owner, x, y, dx, dy);
          let score = run + Math.min(r1, 20) * 0.7 + Math.min(r2, 20) * 0.7 + rng() * 1.5;
          if (!solidShore(world, lastOwner, x1, y1, axis)) score += 4;
          if (!solidShore(world, owner, x, y, axis)) score += 4;
          if (!best || score < best.score) {
            const tiles: number[] = [];
            for (let q = lastPos + 1; q < p; q++) tiles.push(axis === 1 ? pack(q, line) : pack(line, q));
            best = { axis, tiles, ends: [x1, y1, -dx, -dy, x, y], score };
          }
        }
        lastOwner = owner;
        lastPos = p;
        run = 0;
        clean = true;
      }
    }
  }
  return best;
}

function carveRoad(world: World, l: Landmass, x: number, y: number, dx: number, dy: number) {
  for (let k = 0; k < 16; k++) {
    const xx = x + dx * k, yy = y + dy * k;
    const i = world.idx(xx, yy);
    if (i < 0 || world.land[i] !== l.uid) return;
    if (world.terr[i] === T.ROAD) return;
    world.terr[i] = T.ROAD;
    world.deco[i] = 0;
    world.bld[i] = 0;
  }
  void l;
}

function connect(world: World, a: Landmass, b: Landmass, rng: Rng, maxLen = 24): boolean {
  const c = findBridge(world, a, b, rng, maxLen);
  if (!c) return false;
  for (const k of c.tiles) {
    const i = world.idx(unpackX(k), unpackY(k));
    world.terr[i] = T.BRIDGE;
    world.aux[i] = c.axis;
    world.deco[i] = 0;
  }
  const [x1, y1, dx, dy, x2, y2] = c.ends;
  const l1 = world.getLandmass(world.landAt(x1, y1))!, l2 = world.getLandmass(world.landAt(x2, y2))!;
  carveRoad(world, l1, x1, y1, dx, dy);
  carveRoad(world, l2, x2, y2, -dx, -dy);
  // lamp posts at both bridge heads
  world.bridges.push({ a: a.uid, b: b.uid, axis: c.axis, tiles: c.tiles });
  for (const k of c.tiles) stampNear(world, unpackX(k), unpackY(k), 1);
  return true;
}

// --------------------------------------------------------------- landmass lifecycle

function stampShape(world: World, s: Shape, ox: number, oy: number, uid: number) {
  world.ensure(ox - GAP - 2, oy - GAP - 2, ox + s.w + GAP + 2, oy + s.h + GAP + 2);
  for (let y = 0; y < s.h; y++)
    for (let x = 0; x < s.w; x++) {
      if (!s.mask[y * s.w + x]) continue;
      const i = world.idx(ox + x, oy + y);
      world.terr[i] = T.GRASS;
      world.land[i] = uid;
      world.deco[i] = 0;
      world.bld[i] = 0;
      world.aux[i] = 0;
    }
}

function makeLandmass(world: World, uid: number, seed: number, s: Shape, ox: number, oy: number, rng: Rng): Landmass {
  let sx = 0, sy = 0, n = 0;
  for (let y = 0; y < s.h; y++)
    for (let x = 0; x < s.w; x++)
      if (s.mask[y * s.w + x]) {
        sx += x;
        sy += y;
        n++;
      }
  return {
    uid,
    seed,
    theme: rng.int(0, THEMES.length - 1),
    name: uniqueName(world, rng),
    minX: ox,
    minY: oy,
    maxX: ox + s.w - 1,
    maxY: oy + s.h - 1,
    cx: ox + sx / n,
    cy: oy + sy / n,
    radius: Math.sqrt(n / Math.PI),
    tiles: n,
    plots: [],
  };
}

function uniqueName(world: World, rng: Rng): string {
  const used = new Set(world.landmasses.map((l) => l.name));
  let name = '';
  for (let i = 0; i < 20; i++) {
    name = `${rng.pick(PREFIX)} ${rng.pick(SUFFIX)}`;
    if (!used.has(name)) break;
  }
  return name;
}

function areaFor(rng: Rng, preset: number, index: number): number {
  if (preset === 0) return rng.int(650, 900);
  if (preset <= 100) return rng.int(380, 560);
  const big = rng.chance(0.15);
  return big ? rng.int(1300, 1700) : rng.int(550, 1150) + (index === 0 ? 200 : 0);
}

/** Adds one landmass (empty — no demo buildings) connected to the world. Returns the new landmass. */
export function addLandmass(world: World, seed: number, area?: number): Landmass {
  const rng = mulberry32(seed);
  const s = makeShape(rng, area ?? rng.int(520, 950));
  const { ox, oy, parent } = findSpot(world, s, rng);
  const uid = world.nextUid++;
  stampShape(world, s, ox, oy, uid);
  const l = makeLandmass(world, uid, seed, s, ox, oy, rng);
  // Neighbouring landmasses must avoid it from now on.
  for (let y = l.minY; y <= l.maxY; y++) for (let x = l.minX; x <= l.maxX; x++) if (world.landAt(x, y) === uid) stampNear(world, x, y, GAP);
  world.landmasses.push(l);
  layRoads(world, l, rng);
  if (parent) {
    // Prefer a short crossing: the parent, then any close neighbour; long spans only as a last resort.
    const near = world.landmasses.filter((o) => o.uid !== uid)
      .sort((m, n) => (m.uid === parent ? -1 : n.uid === parent ? 1 : Math.hypot(m.cx - l.cx, m.cy - l.cy) - Math.hypot(n.cx - l.cx, n.cy - l.cy)))
      .slice(0, 6);
    let ok = false;
    for (const maxLen of [10, 18, 40, 90]) {
      for (const o of near) {
        if (connect(world, l, o, rng, maxLen)) {
          rebuildPlots(world, o);
          ok = true;
          break;
        }
      }
      if (ok) break;
    }
    if (!ok) connectNearest(world, l, rng, new Set());
    // Occasionally a second bridge to another close neighbour for a less tree-like network.
    if (rng.chance(0.35)) {
      const others = world.landmasses.filter((o) => o.uid !== uid && o.uid !== parent)
        .sort((m, n) => Math.hypot(m.cx - l.cx, m.cy - l.cy) - Math.hypot(n.cx - l.cx, n.cy - l.cy));
      const linked = new Set(world.bridges.filter((b) => b.a === uid || b.b === uid).map((b) => (b.a === uid ? b.b : b.a)));
      const o = others.find((x) => !linked.has(x.uid));
      if (o && connect(world, l, o, rng, 8)) rebuildPlots(world, o);
    }
  }
  classify(world, l, rng);
  return l;
}

function connectNearest(world: World, l: Landmass, rng: Rng, skip: Set<number>): boolean {
  const others = world.landmasses.filter((o) => o.uid !== l.uid && !skip.has(o.uid))
    .sort((m, n) => Math.hypot(m.cx - l.cx, m.cy - l.cy) - Math.hypot(n.cx - l.cx, n.cy - l.cy));
  for (const o of others.slice(0, 6)) {
    if (connect(world, l, o, rng, 60)) {
      rebuildPlots(world, o);
      return true;
    }
  }
  return false;
}

/** Fill plots of the given landmasses with demo buildings: exactly `count`, or `density` × plots. */
function populate(world: World, lms: Landmass[], rng: Rng, count: number | null, density: number) {
  const plots: { k: number; l: Landmass }[] = [];
  for (const l of lms) for (const k of l.plots) plots.push({ k, l });
  const n = Math.min(plots.length, count ?? Math.round(plots.length * density));
  const ns = rng.int(1, 1e9);
  const keyed = plots.map((p) => {
    const x = unpackX(p.k), y = unpackY(p.k);
    const c = Math.max(0, 1 - Math.hypot(x - p.l.cx, y - p.l.cy) / (p.l.radius * 1.15));
    const w = 0.25 + fbm(x / 9, y / 9, ns, 2) + c * 0.5;
    return { p, c, key: Math.pow(rng(), 1 / w) };
  });
  keyed.sort((a, b) => b.key - a.key);
  for (let i = 0; i < keyed.length; i++) {
    const { p, c } = keyed[i];
    const idx = world.idx(unpackX(p.k), unpackY(p.k));
    if (i >= n) {
      world.bld[idx] = 0;
      continue;
    }
    const fw = THEMES[p.l.theme].families.slice();
    fw[3] *= 0.3 + 2.2 * c * c; // towers cluster downtown
    fw[1] *= 1.4 - c; // greenhouses towards the edges
    const fam = rng.weighted([0, 1, 2, 3], fw);
    world.bld[idx] = bldCode(fam, rng.int(0, VARIANTS - 1));
  }
}

/** A fresh world for a population preset (0 / 100 / 1,000 / 10,000 demo buildings). */
export function generateWorld(seed: number, preset: number): World {
  const world = new World(seed, preset);
  const rng = mulberry32(seed);
  const need = preset === 0 ? 0 : Math.ceil(preset / 0.8);
  const minCount = preset === 0 ? 1 : preset <= 100 ? 2 : preset <= 1000 ? 3 : 10;
  let plots = 0;
  for (let i = 0; i < 200; i++) {
    const l = addLandmass(world, rng.int(1, 2 ** 31 - 1), areaFor(rng, preset, i));
    plots += l.plots.length;
    // bridges may have consumed a few plots on older islands; recount occasionally
    if (world.landmasses.length >= minCount && plots >= need) {
      plots = world.stats().plots;
      if (plots >= need) break;
    }
  }
  if (preset > 0) {
    populate(world, world.landmasses, rng, preset, 0);
    world.density = preset / Math.max(1, world.stats().plots);
  }
  return world;
}

/**
 * Replace one landmass's outline, roads, scenery and demo buildings in place and
 * reconnect it. Returns the new landmass (it gets a fresh uid) plus the bbox touched.
 */
export function regenLandmass(world: World, uid: number, seed: number): { l: Landmass; dirty: { minX: number; minY: number; maxX: number; maxY: number } } | null {
  const idx = world.landmasses.findIndex((l) => l.uid === uid);
  if (idx < 0) return null;
  const old = world.landmasses[idx];
  const rng = mulberry32(seed);
  const partners = new Set<number>();
  const dirty = { minX: old.minX, minY: old.minY, maxX: old.maxX, maxY: old.maxY };
  const grow = (x: number, y: number) => {
    dirty.minX = Math.min(dirty.minX, x);
    dirty.minY = Math.min(dirty.minY, y);
    dirty.maxX = Math.max(dirty.maxX, x);
    dirty.maxY = Math.max(dirty.maxY, y);
  };

  // Remove the old island and its bridges.
  for (let y = old.minY; y <= old.maxY; y++)
    for (let x = old.minX; x <= old.maxX; x++) {
      const i = world.idx(x, y);
      if (world.land[i] !== uid) continue;
      world.terr[i] = T.WATER;
      world.land[i] = 0;
      world.deco[i] = 0;
      world.bld[i] = 0;
      world.aux[i] = 0;
    }
  world.bridges = world.bridges.filter((b) => {
    if (b.a !== uid && b.b !== uid) return true;
    partners.add(b.a === uid ? b.b : b.a);
    for (const k of b.tiles) {
      const i = world.idx(unpackX(k), unpackY(k));
      world.terr[i] = T.WATER;
      world.aux[i] = 0;
      grow(unpackX(k), unpackY(k));
    }
    return false;
  });
  world.landmasses.splice(idx, 1);
  rebuildNear(world);

  // New outline around the same centre, trimmed so it keeps clear of the neighbours.
  const s = makeShape(rng, Math.round(old.tiles * rng.range(0.85, 1.2)));
  let bestPos = { ox: 0, oy: 0, area: -1, mask: s.mask };
  for (const [dx, dy] of [[0, 0], [3, 0], [-3, 0], [0, 3], [0, -3], [3, 3], [-3, -3], [3, -3], [-3, 3]]) {
    const ox = Math.round(old.cx - s.w / 2) + dx, oy = Math.round(old.cy - s.h / 2) + dy;
    const m = s.mask.slice();
    for (let y = 0; y < s.h; y++)
      for (let x = 0; x < s.w; x++) {
        const i = world.idx(ox + x, oy + y);
        if (m[y * s.w + x] && i >= 0 && world.near[i]) m[y * s.w + x] = 0;
      }
    thin(m, s.w, s.h);
    keepLargest(m, s.w, s.h);
    let area = 0;
    for (const v of m) area += v;
    if (area > bestPos.area) bestPos = { ox, oy, area, mask: m };
    if (area === s.area) break;
  }
  const shape = crop({ w: s.w, h: s.h, mask: bestPos.mask, area: bestPos.area });
  // crop shifts the origin; recover it
  let cx0 = s.w, cy0 = s.h;
  for (let y = 0; y < s.h; y++) for (let x = 0; x < s.w; x++) if (bestPos.mask[y * s.w + x]) { cx0 = Math.min(cx0, x); cy0 = Math.min(cy0, y); }
  const ox = bestPos.ox + cx0, oy = bestPos.oy + cy0;

  const newUid = world.nextUid++;
  stampShape(world, shape, ox, oy, newUid);
  const l = makeLandmass(world, newUid, seed, shape, ox, oy, rng);
  for (let y = l.minY; y <= l.maxY; y++) for (let x = l.minX; x <= l.maxX; x++) if (world.landAt(x, y) === newUid) stampNear(world, x, y, GAP);
  world.landmasses.splice(idx, 0, l);
  layRoads(world, l, rng);
  let linked = false;
  for (const p of [...partners].sort((a, b) => a - b)) {
    const pl = world.getLandmass(p);
    if (pl && connect(world, l, pl, rng, 40)) {
      linked = true;
      rebuildPlots(world, pl);
    }
  }
  if (!linked && world.landmasses.length > 1) connectNearest(world, l, rng, new Set());
  for (const b of world.bridges) if (b.a === newUid || b.b === newUid) for (const k of b.tiles) grow(unpackX(k), unpackY(k));
  classify(world, l, rng);
  if (world.density > 0) populate(world, [l], rng, null, world.density);
  grow(l.minX, l.minY);
  grow(l.maxX, l.maxY);
  return { l, dirty };
}
