/**
 * Iso drawing toolkit. All art is painted procedurally once at startup into
 * offscreen canvases at 2× resolution (S = 2), then mip-mapped for zoomed-out
 * rendering. Light comes from the upper left: +y faces (screen-left) are lit,
 * +x faces (screen-right) are in shade.
 */
import { mulberry32, Rng } from '../rng';

/** Source-art scale relative to zoom 1. */
export const S = 2;
/** Tile size at zoom 1 (world px). */
export const TW = 64;
export const TH = 32;
/** Half tile in source px. */
export const HW = (TW * S) / 2; // 64
export const HH = (TH * S) / 2; // 32
/** Height of the coastal cliff, world px. */
export const CLIFF = 12;

export interface Pt {
  x: number;
  y: number;
}

export interface Sprite {
  c: HTMLCanvasElement;
  /** anchor (tile ground centre) inside the canvas, source px */
  ox: number;
  oy: number;
  /** height above ground, source px (for picking / labels) */
  top: number;
  mips?: Map<number, Sprite>;
}

export function canvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.ceil(w));
  c.height = Math.max(1, Math.ceil(h));
  return c;
}

export function ctx2d(c: HTMLCanvasElement): CanvasRenderingContext2D {
  return c.getContext('2d')!;
}

/** Make a sprite: `draw` paints with the origin at the tile's ground centre. */
export function makeSprite(w: number, up: number, down: number, draw: (g: CanvasRenderingContext2D) => void, top = up): Sprite {
  const c = canvas(w, up + down);
  const g = ctx2d(c);
  g.translate(w / 2, up);
  g.lineJoin = 'round';
  g.lineCap = 'round';
  draw(g);
  return { c, ox: w / 2, oy: up, top };
}

/** Sprite downscaled to `bucket` (world zoom). Built by successive halving for quality. */
export function mip(s: Sprite, bucket: number): Sprite {
  const f = bucket / S;
  if (f >= 1) return s;
  if (!s.mips) s.mips = new Map();
  const hit = s.mips.get(bucket);
  if (hit) return hit;
  const parent = mip(s, bucket * 2);
  const c = canvas(parent.c.width / 2, parent.c.height / 2);
  const g = ctx2d(c);
  g.imageSmoothingEnabled = true;
  g.imageSmoothingQuality = 'high';
  g.drawImage(parent.c, 0, 0, c.width, c.height);
  const m: Sprite = { c, ox: s.ox * f, oy: s.oy * f, top: s.top * f };
  s.mips.set(bucket, m);
  return m;
}

// ---------------------------------------------------------------- iso geometry

/** Screen point of tile-local (u, v) ∈ [0,1]² at height z (source px); origin = tile centre. */
export const P = (u: number, v: number, z = 0): Pt => ({ x: (u - v) * HW, y: (u + v - 1) * HH - z });

export function poly(g: CanvasRenderingContext2D, pts: Pt[]) {
  g.beginPath();
  g.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) g.lineTo(pts[i].x, pts[i].y);
  g.closePath();
}

/**
 * Paint inside a parallelogram: local (0,0) → p0, (w,0) → pa, (0,h) → pb.
 * `paint` draws in a plain w×h rectangle (y down) and is clipped to it.
 */
export function plane(g: CanvasRenderingContext2D, p0: Pt, pa: Pt, pb: Pt, w: number, h: number, paint: (g: CanvasRenderingContext2D) => void) {
  g.save();
  g.transform((pa.x - p0.x) / w, (pa.y - p0.y) / w, (pb.x - p0.x) / h, (pb.y - p0.y) / h, p0.x, p0.y);
  g.beginPath();
  g.rect(0, 0, w, h);
  g.clip();
  paint(g);
  g.restore();
}

/** Wall facing +y (screen-left, lit). Local x: u0→u1 (px), y: top (z1) → bottom (z0). */
export function wallL(g: CanvasRenderingContext2D, u0: number, u1: number, v: number, z0: number, z1: number, paint: (g: CanvasRenderingContext2D, w: number, h: number) => void) {
  const w = (u1 - u0) * HW, h = z1 - z0;
  plane(g, P(u0, v, z1), P(u1, v, z1), P(u0, v, z0), w, h, (q) => paint(q, w, h));
}

/** Wall facing +x (screen-right, shaded). Local x: v1→v0 (left→right on screen). */
export function wallR(g: CanvasRenderingContext2D, u: number, v0: number, v1: number, z0: number, z1: number, paint: (g: CanvasRenderingContext2D, w: number, h: number) => void) {
  const w = (v1 - v0) * HW, h = z1 - z0;
  plane(g, P(u, v1, z1), P(u, v0, z1), P(u, v1, z0), w, h, (q) => paint(q, w, h));
}

/** Horizontal surface at height z. Local x: u0→u1, y: v0→v1. */
export function top(g: CanvasRenderingContext2D, u0: number, v0: number, u1: number, v1: number, z: number, paint: (g: CanvasRenderingContext2D, w: number, h: number) => void) {
  const w = (u1 - u0) * HW, h = (v1 - v0) * HW;
  plane(g, P(u0, v0, z), P(u1, v0, z), P(u0, v1, z), w, h, (q) => paint(q, w, h));
}

// ---------------------------------------------------------------- colour

export function hsl(h: number, s: number, l: number, a = 1) {
  return a === 1 ? `hsl(${h} ${s}% ${l}%)` : `hsl(${h} ${s}% ${l}% / ${a})`;
}

function parseHex(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
/** Lighten (f > 1) / darken (f < 1) a #rrggbb colour. */
export function shade(hex: string, f: number): string {
  const [r, g, b] = parseHex(hex);
  const m = (v: number) => Math.max(0, Math.min(255, Math.round(f >= 1 ? v + (255 - v) * (f - 1) : v * f)));
  return `rgb(${m(r)} ${m(g)} ${m(b)})`;
}
export function mixHex(a: string, b: string, t: number): string {
  const A = parseHex(a), B = parseHex(b);
  const m = (i: number) => Math.round(A[i] + (B[i] - A[i]) * t);
  return `rgb(${m(0)} ${m(1)} ${m(2)})`;
}
export function rgba(hex: string, a: number): string {
  const [r, g, b] = parseHex(hex);
  return `rgb(${r} ${g} ${b} / ${a})`;
}

export const OUTLINE = 'rgb(28 22 44 / 0.55)';
export const SHADE_R = 'rgb(24 22 64 / 0.30)';

/** Darken the shaded side + ambient occlusion at the foot of a wall (call inside a wall painter). */
export function faceLight(g: CanvasRenderingContext2D, w: number, h: number, side: 'L' | 'R', ao = true) {
  if (side === 'R') {
    g.fillStyle = SHADE_R;
    g.fillRect(0, 0, w, h);
  } else {
    const gr = g.createLinearGradient(0, 0, w, 0);
    gr.addColorStop(0, 'rgb(255 245 220 / 0.10)');
    gr.addColorStop(1, 'rgb(255 245 220 / 0)');
    g.fillStyle = gr;
    g.fillRect(0, 0, w, h);
  }
  if (ao) {
    const a = g.createLinearGradient(0, h - Math.min(18, h * 0.5), 0, h);
    a.addColorStop(0, 'rgb(20 16 40 / 0)');
    a.addColorStop(1, 'rgb(20 16 40 / 0.28)');
    g.fillStyle = a;
    g.fillRect(0, 0, w, h);
  }
}

/** Box with optional painters per face. */
export function box(
  g: CanvasRenderingContext2D,
  u0: number, v0: number, u1: number, v1: number, z0: number, z1: number,
  colL: string, colR: string, colT: string,
  paintL?: (g: CanvasRenderingContext2D, w: number, h: number) => void,
  paintR?: (g: CanvasRenderingContext2D, w: number, h: number) => void,
  paintT?: (g: CanvasRenderingContext2D, w: number, h: number) => void,
  outline = true,
) {
  wallL(g, u0, u1, v1, z0, z1, (q, w, h) => {
    q.fillStyle = colL;
    q.fillRect(0, 0, w, h);
    paintL?.(q, w, h);
    faceLight(q, w, h, 'L');
  });
  wallR(g, u1, v0, v1, z0, z1, (q, w, h) => {
    q.fillStyle = colR;
    q.fillRect(0, 0, w, h);
    paintR?.(q, w, h);
    faceLight(q, w, h, 'R');
  });
  top(g, u0, v0, u1, v1, z1, (q, w, h) => {
    q.fillStyle = colT;
    q.fillRect(0, 0, w, h);
    paintT?.(q, w, h);
  });
  if (outline) {
    g.strokeStyle = OUTLINE;
    g.lineWidth = 1.4;
    poly(g, [P(u0, v1, z1), P(u0, v0, z1), P(u1, v0, z1), P(u1, v0, z0), P(u1, v1, z0), P(u0, v1, z0)]);
    g.stroke();
    g.strokeStyle = 'rgb(255 255 255 / 0.22)';
    g.lineWidth = 1;
    g.beginPath();
    const a = P(u0, v1, z1), b = P(u1, v1, z1), c = P(u1, v0, z1);
    g.moveTo(a.x, a.y);
    g.lineTo(b.x, b.y);
    g.lineTo(c.x, c.y);
    g.moveTo(b.x, b.y);
    const d = P(u1, v1, z0);
    g.lineTo(d.x, d.y);
    g.stroke();
  }
}

// ---------------------------------------------------------------- textures

export function rngFor(...k: number[]): Rng {
  let s = 2166136261;
  for (const v of k) s = Math.imul(s ^ (v | 0), 16777619);
  return mulberry32(s >>> 0);
}

/** Running-bond bricks with colour jitter. */
export function bricks(g: CanvasRenderingContext2D, w: number, h: number, base: string, rng: Rng, bw = 7, bh = 3.2) {
  g.fillStyle = shade(base, 0.72);
  g.fillRect(0, 0, w, h);
  for (let y = 0, row = 0; y < h; y += bh, row++) {
    for (let x = row % 2 ? -bw / 2 : 0; x < w; x += bw) {
      g.fillStyle = shade(base, 0.9 + rng() * 0.22);
      g.fillRect(x + 0.4, y + 0.4, bw - 0.8, bh - 0.8);
    }
  }
}

/** Horizontal clapboard siding. */
export function siding(g: CanvasRenderingContext2D, w: number, h: number, base: string, step = 4) {
  g.fillStyle = base;
  g.fillRect(0, 0, w, h);
  for (let y = step; y < h; y += step) {
    g.fillStyle = 'rgb(0 0 0 / 0.13)';
    g.fillRect(0, y - 1, w, 1);
    g.fillStyle = 'rgb(255 255 255 / 0.1)';
    g.fillRect(0, y, w, 0.8);
  }
}

/** Fine stucco / concrete grain. */
export function grain(g: CanvasRenderingContext2D, w: number, h: number, rng: Rng, amt = 0.06, n = 0) {
  const count = n || Math.round((w * h) / 10);
  for (let i = 0; i < count; i++) {
    g.fillStyle = rng() < 0.5 ? `rgb(0 0 0 / ${amt})` : `rgb(255 255 255 / ${amt})`;
    g.fillRect(rng() * w, rng() * h, 1, 1);
  }
}

export interface WinOpts {
  frame?: string;
  lit?: number; // chance a window is lit
  litColor?: string;
  sill?: boolean;
  arch?: boolean;
  shutters?: string;
  mullion?: boolean;
}

/** A single glazed window with frame, reflection and optional warm interior light. */
export function windowAt(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, rng: Rng, o: WinOpts = {}) {
  const frame = o.frame ?? '#f2ead8';
  g.fillStyle = frame;
  if (o.arch) {
    g.beginPath();
    g.moveTo(x - 1, y + h + 1);
    g.lineTo(x - 1, y + w / 2);
    g.arc(x + w / 2, y + w / 2, w / 2 + 1, Math.PI, 0);
    g.lineTo(x + w + 1, y + h + 1);
    g.closePath();
    g.fill();
  } else g.fillRect(x - 1, y - 1, w + 2, h + 2);
  const lit = rng() < (o.lit ?? 0.3);
  const gr = g.createLinearGradient(x, y, x + w * 0.4, y + h);
  if (lit) {
    gr.addColorStop(0, o.litColor ?? '#ffe7a6');
    gr.addColorStop(1, '#f2a65a');
  } else {
    gr.addColorStop(0, '#bfe3f2');
    gr.addColorStop(0.45, '#5d8fb0');
    gr.addColorStop(1, '#2a3f63');
  }
  g.fillStyle = gr;
  if (o.arch) {
    g.beginPath();
    g.moveTo(x, y + h);
    g.lineTo(x, y + w / 2);
    g.arc(x + w / 2, y + w / 2, w / 2, Math.PI, 0);
    g.lineTo(x + w, y + h);
    g.closePath();
    g.fill();
  } else g.fillRect(x, y, w, h);
  // reflection streak
  if (!lit) {
    g.fillStyle = 'rgb(255 255 255 / 0.35)';
    g.beginPath();
    g.moveTo(x + w * 0.15, y + h);
    g.lineTo(x + w * 0.55, y);
    g.lineTo(x + w * 0.75, y);
    g.lineTo(x + w * 0.35, y + h);
    g.closePath();
    g.fill();
  }
  if (o.mullion !== false && w > 4) {
    g.fillStyle = frame;
    g.fillRect(x + w / 2 - 0.5, y, 1, h);
    if (h > 7) g.fillRect(x, y + h * 0.45, w, 1);
  }
  if (o.shutters) {
    g.fillStyle = o.shutters;
    g.fillRect(x - 3.5, y - 1, 2.5, h + 2);
    g.fillRect(x + w + 1, y - 1, 2.5, h + 2);
  }
  if (o.sill !== false) {
    g.fillStyle = 'rgb(255 255 255 / 0.85)';
    g.fillRect(x - 2, y + h + 1, w + 4, 1.6);
    g.fillStyle = 'rgb(0 0 0 / 0.25)';
    g.fillRect(x - 2, y + h + 2.6, w + 4, 0.8);
  }
}

/** Soft contact shadow under an object (ellipse on the ground). */
export function contactShadow(g: CanvasRenderingContext2D, rx: number, ry: number, dx = 0, dy = 0, a = 0.28) {
  const gr = g.createRadialGradient(dx, dy, 0, dx, dy, rx);
  gr.addColorStop(0, `rgb(16 24 48 / ${a})`);
  gr.addColorStop(1, 'rgb(16 24 48 / 0)');
  g.save();
  g.scale(1, ry / rx);
  g.fillStyle = gr;
  g.beginPath();
  g.arc(dx, dy * (rx / ry), rx, 0, Math.PI * 2);
  g.fill();
  g.restore();
}

/** Glow halo (for lamps, neon). */
export function glow(g: CanvasRenderingContext2D, x: number, y: number, r: number, color: string, a = 0.5) {
  const gr = g.createRadialGradient(x, y, 0, x, y, r);
  gr.addColorStop(0, color.replace(')', ` / ${a})`).replace('rgb(', 'rgb('));
  gr.addColorStop(1, color.replace(')', ' / 0)'));
  g.fillStyle = gr;
  g.beginPath();
  g.arc(x, y, r, 0, Math.PI * 2);
  g.fill();
}
