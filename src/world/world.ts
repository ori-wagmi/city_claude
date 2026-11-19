/**
 * World model: one global tile grid holding several connected landmasses.
 * The grid grows when landmasses are added; world coordinates are absolute
 * (can be negative), the arrays are offset by (x0, y0).
 */

export const T = {
  WATER: 0,
  GRASS: 1,
  SAND: 2,
  ROAD: 3,
  PLOT: 4,
  PARK: 5,
  PLAZA: 6,
  BRIDGE: 7,
} as const;
export type TileType = (typeof T)[keyof typeof T];

export const D = {
  NONE: 0,
  TREE_ROUND: 1,
  TREE_CONIFER: 2,
  TREE_SAKURA: 3,
  TREE_PALM: 4,
  TREE_AUTUMN: 5,
  BUSH: 6,
  FLOWERS: 7,
  ROCK: 8,
  LAMP: 9,
  LAMP_V: 11,
  BENCH: 10,
  LM_FOUNTAIN: 20,
  LM_LIGHTHOUSE: 21,
  LM_CLOCKTOWER: 22,
  LM_STATUE: 23,
  LM_WINDMILL: 24,
  LM_GAZEBO: 25,
} as const;

export const FAMILIES = ['Townhouse', 'Greenhouse', 'Pagoda', 'Cyber tower'] as const;
export const VARIANTS = 6;
/** bld array: 0 = none, else 1 + family * 8 + variant (synthetic demo buildings only). */
export const bldCode = (family: number, variant: number) => 1 + family * 8 + variant;
export const bldFamily = (code: number) => ((code - 1) >> 3) & 3;
export const bldVariant = (code: number) => (code - 1) & 7;

export interface Theme {
  id: string;
  label: string;
  /** grass base colour (h, s, l) */
  grass: [number, number, number];
  trees: number[]; // weights for [round, conifer, sakura, palm, autumn]
  treeDensity: number;
  beach: number; // 0..1, share of coastline that is sand
  families: number[]; // weights for building families
  block: [number, number];
  landmarks: number[];
}

export const THEMES: Theme[] = [
  { id: 'garden', label: 'Garden Quarter', grass: [98, 46, 46], trees: [6, 1, 1, 0, 0], treeDensity: 1.1, beach: 0.25, families: [3, 5, 1, 1], block: [3, 5], landmarks: [D.LM_FOUNTAIN, D.LM_GAZEBO] },
  { id: 'harbor', label: 'Harbor Town', grass: [88, 40, 50], trees: [2, 0, 0, 4, 0], treeDensity: 0.8, beach: 0.75, families: [6, 1, 1, 2], block: [3, 4], landmarks: [D.LM_CLOCKTOWER, D.LM_FOUNTAIN] },
  { id: 'neon', label: 'Neon Heights', grass: [150, 30, 38], trees: [2, 3, 0, 0, 0], treeDensity: 0.6, beach: 0.15, families: [2, 1, 1, 4], block: [4, 6], landmarks: [D.LM_STATUE, D.LM_FOUNTAIN] },
  { id: 'lantern', label: 'Lantern Hill', grass: [105, 38, 44], trees: [1, 2, 6, 0, 0], treeDensity: 1.0, beach: 0.3, families: [2, 1, 6, 1], block: [3, 5], landmarks: [D.LM_GAZEBO, D.LM_STATUE] },
  { id: 'maple', label: 'Maple Rise', grass: [72, 40, 44], trees: [1, 3, 0, 0, 5], treeDensity: 1.0, beach: 0.2, families: [5, 2, 1, 2], block: [3, 5], landmarks: [D.LM_WINDMILL, D.LM_CLOCKTOWER] },
];

export interface Landmass {
  uid: number;
  seed: number;
  theme: number;
  name: string;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  cx: number;
  cy: number;
  radius: number;
  tiles: number;
  /** packed coords of every plot tile on this landmass */
  plots: number[];
}

export interface Bridge {
  a: number;
  b: number;
  axis: 1 | 2; // 1 = runs along x, 2 = runs along y
  tiles: number[]; // packed coords
}

export const pack = (x: number, y: number) => (x + 32768) * 65536 + (y + 32768);
export const unpackX = (k: number) => Math.floor(k / 65536) - 32768;
export const unpackY = (k: number) => (k % 65536) - 32768;

export class World {
  x0 = 0;
  y0 = 0;
  w = 0;
  h = 0;
  terr = new Uint8Array(0);
  land = new Uint16Array(0);
  deco = new Uint8Array(0);
  bld = new Uint8Array(0);
  aux = new Uint8Array(0);
  /** >0 where a new landmass may not go (land/bridge + safety margin) */
  near = new Uint8Array(0);

  landmasses: Landmass[] = [];
  bridges: Bridge[] = [];
  nextUid = 1;
  /** share of plots filled with demo buildings (used when a landmass is regenerated) */
  density = 0;

  constructor(
    readonly seed: number,
    readonly preset: number,
  ) {}

  idx(x: number, y: number): number {
    const lx = x - this.x0, ly = y - this.y0;
    if (lx < 0 || ly < 0 || lx >= this.w || ly >= this.h) return -1;
    return ly * this.w + lx;
  }
  t(x: number, y: number): number {
    const i = this.idx(x, y);
    return i < 0 ? T.WATER : this.terr[i];
  }
  landAt(x: number, y: number): number {
    const i = this.idx(x, y);
    return i < 0 ? 0 : this.land[i];
  }
  isLand(x: number, y: number): boolean {
    const t = this.t(x, y);
    return t !== T.WATER && t !== T.BRIDGE;
  }

  /** Grow the arrays so that [minX..maxX]×[minY..maxY] fits. */
  ensure(minX: number, minY: number, maxX: number, maxY: number): void {
    if (this.w && minX >= this.x0 && minY >= this.y0 && maxX < this.x0 + this.w && maxY < this.y0 + this.h) return;
    const pad = 24;
    const nx0 = Math.min(this.w ? this.x0 : minX, minX) - pad;
    const ny0 = Math.min(this.w ? this.y0 : minY, minY) - pad;
    const nx1 = Math.max(this.w ? this.x0 + this.w - 1 : maxX, maxX) + pad;
    const ny1 = Math.max(this.w ? this.y0 + this.h - 1 : maxY, maxY) + pad;
    const nw = nx1 - nx0 + 1, nh = ny1 - ny0 + 1;
    const grow = <A extends Uint8Array | Uint16Array>(old: A, make: (n: number) => A): A => {
      const a = make(nw * nh);
      for (let y = 0; y < this.h; y++) {
        const src = y * this.w;
        const dst = (y + this.y0 - ny0) * nw + (this.x0 - nx0);
        a.set(old.subarray(src, src + this.w) as never, dst);
      }
      return a;
    };
    this.terr = grow(this.terr, (n) => new Uint8Array(n));
    this.land = grow(this.land, (n) => new Uint16Array(n));
    this.deco = grow(this.deco, (n) => new Uint8Array(n));
    this.bld = grow(this.bld, (n) => new Uint8Array(n));
    this.aux = grow(this.aux, (n) => new Uint8Array(n));
    this.near = grow(this.near, (n) => new Uint8Array(n));
    this.x0 = nx0;
    this.y0 = ny0;
    this.w = nw;
    this.h = nh;
  }

  getLandmass(uid: number): Landmass | undefined {
    return this.landmasses.find((l) => l.uid === uid);
  }

  /** Bounds of all land + bridges. */
  bounds(): { minX: number; minY: number; maxX: number; maxY: number } {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const l of this.landmasses) {
      minX = Math.min(minX, l.minX);
      minY = Math.min(minY, l.minY);
      maxX = Math.max(maxX, l.maxX);
      maxY = Math.max(maxY, l.maxY);
    }
    for (const b of this.bridges)
      for (const k of b.tiles) {
        const x = unpackX(k), y = unpackY(k);
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
    if (minX === Infinity) return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
    return { minX, minY, maxX, maxY };
  }

  stats() {
    let plots = 0, demo = 0;
    for (const l of this.landmasses) {
      plots += l.plots.length;
      for (const k of l.plots) if (this.bld[this.idx(unpackX(k), unpackY(k))]) demo++;
    }
    return { landmasses: this.landmasses.length, plots, demo, bridges: this.bridges.length };
  }

  landStats(l: Landmass) {
    let demo = 0;
    for (const k of l.plots) if (this.bld[this.idx(unpackX(k), unpackY(k))]) demo++;
    return { plots: l.plots.length, demo };
  }
}
