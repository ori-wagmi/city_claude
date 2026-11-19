/**
 * The four reusable building families × 6 variants each. Shared by demo
 * buildings and real `.hl` name buildings.
 */
import {
  HH, HW, OUTLINE, P, Pt, Sprite, box, bricks, faceLight, glow, grain, makeSprite, plane, poly, rngFor, shade, siding, top, wallL, wallR, windowAt,
} from './core';
import { Rng } from '../rng';

type G = CanvasRenderingContext2D;
const W = HW * 2 + 40;
const DOWN = HH + 14;

// ------------------------------------------------------------ shared bits

function bush(g: G, x: number, y: number, r: number, col: string, rng: Rng) {
  g.fillStyle = 'rgb(20 30 40 / 0.25)';
  g.beginPath();
  g.ellipse(x + r * 0.3, y + r * 0.35, r * 1.1, r * 0.45, 0, 0, Math.PI * 2);
  g.fill();
  for (let i = 0; i < 4; i++) {
    const bx = x + (rng() - 0.5) * r * 1.1, by = y - r * 0.4 - rng() * r * 0.5;
    const rr = r * (0.55 + rng() * 0.3);
    const gr = g.createRadialGradient(bx - rr * 0.4, by - rr * 0.5, rr * 0.1, bx, by, rr);
    gr.addColorStop(0, shade(col, 1.35));
    gr.addColorStop(0.6, col);
    gr.addColorStop(1, shade(col, 0.6));
    g.fillStyle = gr;
    g.beginPath();
    g.arc(bx, by, rr, 0, Math.PI * 2);
    g.fill();
  }
}

function flowers(g: G, x: number, y: number, n: number, rng: Rng, cols = ['#ff7aa8', '#ffd34d', '#ffffff', '#c78bff']) {
  for (let i = 0; i < n; i++) {
    g.fillStyle = rng.pick(cols);
    g.beginPath();
    g.arc(x + (rng() - 0.5) * 10, y + (rng() - 0.5) * 4, 1.1, 0, Math.PI * 2);
    g.fill();
  }
}

/** Parallelogram slope helper for roofs: p0 → pa along the ridge, p0 → pb down to the eave. */
function slope(g: G, p0: Pt, pa: Pt, pb: Pt, base: string, rows: number, kind: 'shingle' | 'tile' | 'glass' | 'metal') {
  const w = Math.hypot(pa.x - p0.x, pa.y - p0.y), h = Math.hypot(pb.x - p0.x, pb.y - p0.y);
  plane(g, p0, pa, pb, w, h, (q) => {
    const gr = q.createLinearGradient(0, 0, 0, h);
    gr.addColorStop(0, shade(base, 1.18));
    gr.addColorStop(1, shade(base, 0.86));
    q.fillStyle = gr;
    q.fillRect(0, 0, w, h);
    const step = h / rows;
    if (kind === 'shingle' || kind === 'tile') {
      for (let r = 0; r < rows; r++) {
        const y = r * step;
        q.fillStyle = 'rgb(0 0 0 / 0.22)';
        q.fillRect(0, y + step - 1.1, w, 1.1);
        q.fillStyle = 'rgb(255 255 255 / 0.12)';
        q.fillRect(0, y, w, 0.8);
        const cw = kind === 'tile' ? 3.2 : 5.5;
        for (let x = (r % 2) * cw * 0.5; x < w; x += cw) {
          q.fillStyle = 'rgb(0 0 0 / 0.16)';
          q.fillRect(x, y, 0.8, step);
        }
      }
    } else if (kind === 'metal') {
      for (let x = 0; x < w; x += 4) {
        q.fillStyle = 'rgb(255 255 255 / 0.18)';
        q.fillRect(x, 0, 1, h);
        q.fillStyle = 'rgb(0 0 0 / 0.15)';
        q.fillRect(x + 1, 0, 0.8, h);
      }
    }
  });
  g.strokeStyle = OUTLINE;
  g.lineWidth = 1.3;
  poly(g, [p0, pa, { x: pa.x + pb.x - p0.x, y: pa.y + pb.y - p0.y }, pb]);
  g.stroke();
}

function frontDoor(q: G, x: number, h: number, col: string, w = 9, dh = 15) {
  q.fillStyle = '#efe6d2';
  q.fillRect(x - 1.5, h - dh - 1.5, w + 3, dh + 1.5);
  const gr = q.createLinearGradient(x, 0, x + w, 0);
  gr.addColorStop(0, shade(col, 1.15));
  gr.addColorStop(1, shade(col, 0.8));
  q.fillStyle = gr;
  q.fillRect(x, h - dh, w, dh);
  q.fillStyle = 'rgb(0 0 0 / 0.25)';
  q.fillRect(x + 1.5, h - dh + 2, w - 3, 4);
  q.fillRect(x + 1.5, h - dh + 8, w - 3, 5);
  q.fillStyle = '#ffd77a';
  q.fillRect(x + w - 2.5, h - dh * 0.5, 1.2, 1.2);
}

// ------------------------------------------------------------ townhouse

const TOWN = [
  { wall: '#b5523b', kind: 'brick', trim: '#f1e8d4', roof: '#4b5166', door: '#2f4a6b', awning: ['#2f6f5e', '#f4efe2'] },
  { wall: '#eadcc0', kind: 'stucco', trim: '#ffffff', roof: '#b9593a', door: '#7a3b2a', awning: ['#c84b3c', '#fff4e4'] },
  { wall: '#86a58c', kind: 'siding', trim: '#f6f1e6', roof: '#5a3b2e', door: '#7a4a2a', awning: null },
  { wall: '#a6493a', kind: 'brick', trim: '#f2ede2', roof: '#2f3346', door: '#3a5fa0', awning: null, flat: true },
  { wall: '#b07a43', kind: 'timber', trim: '#ecc98e', roof: '#6d3c27', door: '#4a2c1a', awning: ['#d9a441', '#6d3c27'] },
  { wall: '#de9783', kind: 'stucco', trim: '#fff6ea', roof: '#3e6e6c', door: '#2f5d5a', awning: ['#3e6e6c', '#fff6ea'] },
] as const;

function wallTexture(q: G, w: number, h: number, m: (typeof TOWN)[number], rng: Rng) {
  if (m.kind === 'brick') bricks(q, w, h, m.wall, rng);
  else if (m.kind === 'siding') siding(q, w, h, m.wall, 3.6);
  else if (m.kind === 'timber') {
    q.fillStyle = m.wall;
    q.fillRect(0, 0, w, h);
    for (let x = 0; x < w; x += 3.4) {
      q.fillStyle = `rgb(60 30 10 / ${0.1 + rng() * 0.12})`;
      q.fillRect(x, 0, 0.9, h);
      q.fillStyle = 'rgb(255 230 180 / 0.08)';
      q.fillRect(x + 1, 0, 1, h);
    }
  } else {
    q.fillStyle = m.wall;
    q.fillRect(0, 0, w, h);
    grain(q, w, h, rng, 0.05);
  }
}

export function townhouse(variant: number): Sprite {
  const m = TOWN[variant % TOWN.length];
  const rng = rngFor(11, variant);
  const floors = [2, 3, 3, 5, 2, 3][variant % 6];
  const FH = 25, BASE = 5;
  const H = BASE + floors * FH;
  const u0 = 0.17, u1 = 0.83, v0 = 0.2, v1 = 0.83;
  const flat = 'flat' in m && m.flat;
  const R = flat ? 0 : 26;
  const up = H + R + 30;
  return makeSprite(W, up, DOWN, (g) => {
    // plinth
    box(g, u0 - 0.02, v0 - 0.02, u1 + 0.02, v1 + 0.02, 0, BASE, '#b9b2a6', '#9a9388', '#cfc8bb');
    const paintFace = (side: 'L' | 'R') => (q: G, w: number, h: number) => {
      wallTexture(q, w, h, m, rng);
      const cols = side === 'L' ? 3 : 2;
      for (let f = 0; f < floors; f++) {
        const fy = h - (f + 1) * FH; // top of this floor (face coords; y=0 at roof)
        // belt course between floors
        if (f > 0) {
          q.fillStyle = m.trim;
          q.fillRect(0, fy + FH - 2.2, w, 2.2);
          q.fillStyle = 'rgb(0 0 0 / 0.18)';
          q.fillRect(0, fy + FH, w, 0.8);
        }
        if (f === 0 && side === 'L') {
          frontDoor(q, w * 0.16, h, m.door);
          // shop window
          const sx = w * 0.42, sw = w * 0.46;
          q.fillStyle = m.trim;
          q.fillRect(sx - 1.5, h - 18.5, sw + 3, 15);
          const gr = q.createLinearGradient(sx, h - 17, sx, h - 5);
          gr.addColorStop(0, '#ffe9b0');
          gr.addColorStop(1, '#e49a52');
          q.fillStyle = gr;
          q.fillRect(sx, h - 17, sw, 12);
          q.fillStyle = 'rgb(80 40 20 / 0.35)';
          for (let i = 0; i < 4; i++) q.fillRect(sx + 2 + i * (sw / 4), h - 10, sw / 6, 5);
          q.fillStyle = m.trim;
          q.fillRect(sx + sw / 2 - 0.5, h - 17, 1, 12);
          continue;
        }
        const ww = 6.5, wh = 11;
        const gap = w / cols;
        for (let c = 0; c < cols; c++) {
          const wx = gap * (c + 0.5) - ww / 2;
          windowAt(q, wx, fy + 7, ww, wh, rng, { frame: m.trim, lit: 0.25, arch: m.kind === 'stucco' && f === floors - 1, shutters: m.kind === 'siding' ? '#3f5f4a' : undefined });
          if (f === 1 && side === 'L' && rng() < 0.7) {
            q.fillStyle = '#5b3a24';
            q.fillRect(wx - 2, fy + 19.5, ww + 4, 2.5);
            flowers(q, wx + ww / 2, fy + 19, 5, rng);
          }
        }
      }
      // cornice
      q.fillStyle = m.trim;
      q.fillRect(0, 0, w, 3);
      q.fillStyle = 'rgb(0 0 0 / 0.2)';
      q.fillRect(0, 3, w, 1);
    };
    box(g, u0, v0, u1, v1, BASE, H, m.wall, m.wall, shade(m.wall, 1.1), paintFace('L'), paintFace('R'));

    // awning over the shop window
    if (m.awning) {
      const [a, b] = m.awning;
      const ua = u0 + (u1 - u0) * 0.4, ub = u1 - 0.03;
      const z1 = BASE + FH - 2;
      const p0 = P(ua, v1, z1), pa = P(ub, v1, z1), pb = P(ua, v1 + 0.1, z1 - 8);
      plane(g, p0, pa, pb, 40, 10, (q) => {
        for (let x = 0; x < 40; x += 5) {
          q.fillStyle = (x / 5) % 2 ? b : a;
          q.fillRect(x, 0, 5, 10);
        }
        q.fillStyle = 'rgb(0 0 0 / 0.15)';
        q.fillRect(0, 8, 40, 2);
      });
      g.strokeStyle = OUTLINE;
      g.lineWidth = 1;
      poly(g, [p0, pa, { x: pa.x + pb.x - p0.x, y: pa.y + pb.y - p0.y }, pb]);
      g.stroke();
    }

    if (flat) {
      // parapet + roof terrace (ref: brick apartment)
      const pz = H, ph = 6;
      top(g, u0, v0, u1, v1, pz, (q, w, h) => {
        q.fillStyle = '#e8c9a0';
        q.fillRect(0, 0, w, h);
        grain(q, w, h, rng, 0.08);
      });
      box(g, u0, v0, u1, v0 + 0.05, pz, pz + ph, '#f1ede4', '#d9d3c7', '#ffffff');
      box(g, u0, v0, u0 + 0.05, v1, pz, pz + ph, '#f1ede4', '#d9d3c7', '#ffffff');
      for (let i = 0; i < 5; i++) bush(g, P(u0 + 0.12 + i * 0.1, v0 + 0.12, pz).x, P(u0 + 0.12 + i * 0.1, v0 + 0.12, pz).y, 3.2, '#5c9a4a', rng);
      box(g, u1 - 0.05, v0, u1, v1, pz, pz + ph, '#f1ede4', '#d9d3c7', '#ffffff');
      box(g, u0, v1 - 0.05, u1, v1, pz, pz + ph, '#f1ede4', '#d9d3c7', '#ffffff');
      box(g, 0.55, 0.45, 0.68, 0.58, pz, pz + 9, '#c9ccd2', '#a4a8b0', '#dfe2e6');
    } else {
      const o = 0.045, vm = (v0 + v1) / 2;
      // chimney (behind the ridge)
      box(g, u1 - 0.2, v0 + 0.06, u1 - 0.1, v0 + 0.16, H, H + R + 10, shade(m.wall, 0.95), shade(m.wall, 0.8), '#555');
      // back slope
      slope(g, P(u0 - o, vm, H + R), P(u1 + o, vm, H + R), P(u0 - o, v0 - o, H), shade(m.roof, 0.75), 6, 'shingle');
      // gable end (+x side)
      g.save();
      poly(g, [P(u1, v0, H), P(u1, v1, H), P(u1, vm, H + R)]);
      g.clip();
      wallR(g, u1, v0, v1, H, H + R, (q, w, h) => {
        wallTexture(q, w, h, m, rng);
        windowAt(q, w / 2 - 3.5, h - 15, 7, 8, rng, { frame: m.trim, arch: true, sill: false, mullion: false, lit: 0.4 });
        faceLight(q, w, h, 'R', false);
      });
      g.restore();
      // front slope
      slope(g, P(u0 - o, vm, H + R), P(u1 + o, vm, H + R), P(u0 - o, v1 + o, H - 1), m.roof, 7, m.kind === 'stucco' ? 'tile' : 'shingle');
      // dormer
      if (floors >= 3 || variant % 2 === 0) {
        const du = (u0 + u1) / 2 - 0.08;
        const dz = H + R * 0.35;
        const dv = v1 - (v1 - vm) * 0.35;
        box(g, du, dv - 0.08, du + 0.16, dv, dz - 4, dz + 10, shade(m.wall, 1.05), shade(m.wall, 0.8), m.roof, (q, w, h) => {
          q.fillStyle = m.wall;
          q.fillRect(0, 0, w, h);
          windowAt(q, w / 2 - 3.5, 3, 7, h - 6, rng, { frame: m.trim, sill: false, lit: 0.5 });
        });
      }
      // ridge cap
      g.strokeStyle = shade(m.roof, 0.6);
      g.lineWidth = 2.2;
      g.beginPath();
      const r0 = P(u0 - o, vm, H + R), r1 = P(u1 + o, vm, H + R);
      g.moveTo(r0.x, r0.y);
      g.lineTo(r1.x, r1.y);
      g.stroke();
    }

    // front garden shrubs
    const b1 = P(u0 + 0.02, v1 + 0.08), b2 = P(u1 + 0.08, v1 - 0.05);
    bush(g, b1.x, b1.y, 5, '#4f8f3e', rng);
    bush(g, b2.x, b2.y, 4.5, '#5a9a45', rng);
  });
}

// ------------------------------------------------------------ greenhouse

const GREEN = [
  { frame: '#f3f3ec', base: '#a89d8c' },
  { frame: '#2f5d50', base: '#b55a41' },
  { frame: '#2a2a33', base: '#8d8a84' },
  { frame: '#ece3cc', base: '#7c6a5a' },
  { frame: '#4a6d8d', base: '#bfb6a5' },
  { frame: '#f3f3ec', base: '#9a5a3c' },
];

function plantsInside(g: G, u0: number, v0: number, u1: number, v1: number, z: number, hmax: number, rng: Rng) {
  const pts: { u: number; v: number }[] = [];
  for (let i = 0; i < 14; i++) pts.push({ u: u0 + 0.04 + rng() * (u1 - u0 - 0.08), v: v0 + 0.04 + rng() * (v1 - v0 - 0.08) });
  pts.sort((a, b) => a.u + a.v - (b.u + b.v));
  for (const p of pts) {
    const s = P(p.u, p.v, z);
    const hh = 6 + rng() * (hmax - 6);
    const col = rng.pick(['#3f8f3a', '#2f7a45', '#6db04a', '#4a9e5c', '#2e6b3a']);
    // stem
    g.strokeStyle = '#3b5a2a';
    g.lineWidth = 1.2;
    g.beginPath();
    g.moveTo(s.x, s.y);
    g.lineTo(s.x, s.y - hh * 0.7);
    g.stroke();
    for (let k = 0; k < 3; k++) {
      const r = 3 + rng() * 4;
      const x = s.x + (rng() - 0.5) * 6, y = s.y - hh + rng() * hh * 0.4;
      const gr = g.createRadialGradient(x - r * 0.4, y - r * 0.4, 0.5, x, y, r);
      gr.addColorStop(0, shade(col, 1.4));
      gr.addColorStop(1, shade(col, 0.75));
      g.fillStyle = gr;
      g.beginPath();
      g.arc(x, y, r, 0, Math.PI * 2);
      g.fill();
    }
    if (rng() < 0.4) flowers(g, s.x, s.y - hh, 3, rng, ['#ff6b6b', '#ffb347', '#ff8fd1']);
  }
}

function glassFace(q: G, w: number, h: number, frame: string, side: 'L' | 'R', cols: number, rows: number) {
  q.fillStyle = side === 'L' ? 'rgb(190 235 245 / 0.22)' : 'rgb(120 170 200 / 0.34)';
  q.fillRect(0, 0, w, h);
  // reflections
  q.fillStyle = 'rgb(255 255 255 / 0.22)';
  for (let i = 0; i < 3; i++) {
    const x = (w / 3) * i + 3;
    q.beginPath();
    q.moveTo(x, h);
    q.lineTo(x + 8, 0);
    q.lineTo(x + 13, 0);
    q.lineTo(x + 5, h);
    q.closePath();
    q.fill();
  }
  q.fillStyle = frame;
  for (let c = 0; c <= cols; c++) q.fillRect((w / cols) * c - 0.8, 0, 1.6, h);
  for (let r = 0; r <= rows; r++) q.fillRect(0, (h / rows) * r - 0.6, w, 1.2);
}

export function greenhouse(variant: number): Sprite {
  const m = GREEN[variant % GREEN.length];
  const rng = rngFor(22, variant);
  const u0 = 0.12, u1 = 0.88, v0 = 0.16, v1 = 0.86;
  const BASE = 8, GH = 30 + (variant % 3) * 4, R = 22;
  const H = BASE + GH;
  const vm = (v0 + v1) / 2;
  return makeSprite(W, H + R + 26, DOWN, (g) => {
    // floor + low wall
    box(g, u0, v0, u1, v1, 0, BASE, m.base, m.base, '#7d6a52', (q, w, h) => bricks(q, w, h, m.base, rng, 6, 3), (q, w, h) => bricks(q, w, h, m.base, rng, 6, 3), (q, w, h) => {
      q.fillStyle = '#6f5b45';
      q.fillRect(0, 0, w, h);
      grain(q, w, h, rng, 0.1);
    });
    // back glass (seen through the front) — tinted
    wallL(g, u0, u1, v0, BASE, H, (q, w, h) => glassFace(q, w, h, shade(m.frame, 0.8), 'R', 6, 3));
    wallR(g, u0, v0, v1, BASE, H, (q, w, h) => glassFace(q, w, h, shade(m.frame, 0.8), 'R', 6, 3));
    plantsInside(g, u0, v0, u1, v1, BASE, GH + R * 0.6, rng);
    // back roof slope (glass)
    const o = 0.03;
    const glassSlope = (p0: Pt, pa: Pt, pb: Pt, alpha: number) => {
      const w = Math.hypot(pa.x - p0.x, pa.y - p0.y), h = Math.hypot(pb.x - p0.x, pb.y - p0.y);
      plane(g, p0, pa, pb, w, h, (q) => {
        q.fillStyle = `rgb(200 240 250 / ${alpha})`;
        q.fillRect(0, 0, w, h);
        q.fillStyle = 'rgb(255 255 255 / 0.3)';
        q.beginPath();
        q.moveTo(w * 0.2, 0);
        q.lineTo(w * 0.35, 0);
        q.lineTo(w * 0.25, h);
        q.lineTo(w * 0.1, h);
        q.closePath();
        q.fill();
        q.fillStyle = m.frame;
        for (let x = 0; x <= w; x += w / 7) q.fillRect(x - 0.8, 0, 1.6, h);
        q.fillRect(0, 0, w, 1.6);
        q.fillRect(0, h - 1.6, w, 1.6);
      });
    };
    glassSlope(P(u0 - o, vm, H + R), P(u1 + o, vm, H + R), P(u0 - o, v0 - o, H), 0.18);
    // front walls (glass)
    wallL(g, u0, u1, v1, BASE, H, (q, w, h) => {
      glassFace(q, w, h, m.frame, 'L', 6, 3);
      // door
      q.fillStyle = m.frame;
      q.fillRect(w * 0.42 - 1, h - 20, 12, 20);
      q.fillStyle = 'rgb(210 245 250 / 0.5)';
      q.fillRect(w * 0.42 + 1, h - 18, 8, 18);
    });
    wallR(g, u1, v0, v1, BASE, H, (q, w, h) => glassFace(q, w, h, m.frame, 'R', 6, 3));
    // gable glass triangle
    g.save();
    poly(g, [P(u1, v0, H), P(u1, v1, H), P(u1, vm, H + R)]);
    g.clip();
    wallR(g, u1, v0, v1, H, H + R, (q, w, h) => glassFace(q, w, h, m.frame, 'R', 6, 2));
    g.restore();
    glassSlope(P(u0 - o, vm, H + R), P(u1 + o, vm, H + R), P(u0 - o, v1 + o, H), 0.3);
    // ridge vent
    box(g, u0 + 0.05, vm - 0.03, u1 - 0.05, vm + 0.03, H + R - 1, H + R + 3, m.frame, shade(m.frame, 0.8), shade(m.frame, 1.1));
    g.strokeStyle = OUTLINE;
    g.lineWidth = 1.2;
    poly(g, [P(u0, v1, BASE), P(u1, v1, BASE), P(u1, v0, BASE), P(u1, v0, H), P(u1, vm, H + R), P(u0 - o, vm, H + R), P(u0 - o, v1 + o, H)]);
    g.stroke();
    // planters outside
    for (let i = 0; i < 3; i++) {
      const p = P(u0 + 0.1 + i * 0.28, v1 + 0.08);
      g.fillStyle = '#8a5a3a';
      g.fillRect(p.x - 5, p.y - 4, 10, 5);
      bush(g, p.x, p.y - 3, 3.5, rng.pick(['#4f9a3e', '#6ab04c']), rng);
      flowers(g, p.x, p.y - 7, 4, rng);
    }
  });
}

// ------------------------------------------------------------ pagoda

const PAGODA = [
  { roof: '#2f5d58', wall: '#efe2c4', pillar: '#b8322a' },
  { roof: '#2a2e45', wall: '#f1e6cc', pillar: '#a82c2c' },
  { roof: '#4d8a6c', wall: '#efe0bd', pillar: '#c0412e' },
  { roof: '#8e2f2b', wall: '#f3e9d2', pillar: '#3d2a22' },
  { roof: '#3a4a6e', wall: '#efe2c4', pillar: '#b8322a' },
  { roof: '#5a3a6b', wall: '#f1e4c8', pillar: '#a8352e' },
];

function hipRoof(g: G, c: number, e: number, t: number, z: number, rh: number, col: string, flare = 5) {
  const E = (du: number, dv: number) => P(c + du * e, c + dv * e, z);
  const Tt = (du: number, dv: number) => P(c + du * t, c + dv * t, z + rh);
  const face = (a: Pt, b: Pt, bt: Pt, at: Pt, fill: string | CanvasGradient, curve: boolean) => {
    g.beginPath();
    g.moveTo(a.x, a.y - flare);
    if (curve) g.quadraticCurveTo((a.x + b.x) / 2, (a.y + b.y) / 2 + 2, b.x, b.y - flare);
    else g.lineTo(b.x, b.y - flare);
    g.lineTo(bt.x, bt.y);
    g.lineTo(at.x, at.y);
    g.closePath();
    g.fillStyle = fill;
    g.fill();
    g.strokeStyle = OUTLINE;
    g.lineWidth = 1.2;
    g.stroke();
  };
  // back faces
  face(E(-1, -1), E(1, -1), Tt(1, -1), Tt(-1, -1), shade(col, 0.7), true);
  face(E(-1, -1), E(-1, 1), Tt(-1, 1), Tt(-1, -1), shade(col, 0.8), true);
  // right (+u) face — shade
  const gr1 = g.createLinearGradient(0, E(1, 1).y, 0, Tt(1, 1).y);
  gr1.addColorStop(0, shade(col, 0.62));
  gr1.addColorStop(1, shade(col, 0.85));
  face(E(1, -1), E(1, 1), Tt(1, 1), Tt(1, -1), gr1, true);
  // front (+v) face — lit, with tile ribs
  const gr2 = g.createLinearGradient(0, E(-1, 1).y, 0, Tt(-1, 1).y);
  gr2.addColorStop(0, shade(col, 0.95));
  gr2.addColorStop(1, shade(col, 1.25));
  face(E(-1, 1), E(1, 1), Tt(1, 1), Tt(-1, 1), gr2, true);
  g.strokeStyle = 'rgb(0 0 0 / 0.18)';
  g.lineWidth = 0.8;
  for (let i = 1; i < 8; i++) {
    const f = i / 8;
    const a = P(c - e + 2 * e * f, c + e, z), b = P(c - t + 2 * t * f, c + t, z + rh);
    g.beginPath();
    g.moveTo(a.x, a.y - flare + Math.sin(f * Math.PI) * 2);
    g.lineTo(b.x, b.y);
    g.stroke();
  }
  // upturned eave tips
  g.strokeStyle = shade(col, 0.5);
  g.lineWidth = 2;
  for (const [du, dv, sx] of [[-1, 1, -1], [1, 1, 0], [1, -1, 1]] as const) {
    const p = E(du, dv);
    g.beginPath();
    g.moveTo(p.x, p.y - flare);
    g.quadraticCurveTo(p.x + sx * 4, p.y - flare - 1, p.x + sx * 6, p.y - flare - 6);
    g.stroke();
  }
  // gold trim line on the eave
  g.strokeStyle = '#e8b84a';
  g.lineWidth = 1;
  g.beginPath();
  const a = E(-1, 1), b = E(1, 1), d = E(1, -1);
  g.moveTo(a.x, a.y - flare);
  g.quadraticCurveTo((a.x + b.x) / 2, (a.y + b.y) / 2 + 2, b.x, b.y - flare);
  g.quadraticCurveTo((b.x + d.x) / 2, (b.y + d.y) / 2 + 2, d.x, d.y - flare);
  g.stroke();
}

export function pagoda(variant: number): Sprite {
  const m = PAGODA[variant % PAGODA.length];
  const rng = rngFor(33, variant);
  const tiers = 3 + (variant % 3);
  const c = 0.5;
  let H = 9;
  for (let i = 0; i < tiers; i++) H += 22 - i * 2 + 10;
  return makeSprite(W, H + 50, DOWN, (g) => {
    // stone platform with steps
    box(g, 0.1, 0.1, 0.9, 0.9, 0, 6, '#c9c1b2', '#a8a092', '#ddd5c6', (q, w, h) => grain(q, w, h, rng, 0.08), (q, w, h) => grain(q, w, h, rng, 0.08));
    box(g, 0.4, 0.9, 0.6, 0.98, 0, 3, '#c9c1b2', '#a8a092', '#ddd5c6');
    let z = 6;
    for (let i = 0; i < tiers; i++) {
      const half = 0.27 - i * 0.04;
      const th = 22 - i * 2;
      const u0 = c - half, u1 = c + half;
      const paint = (side: 'L' | 'R') => (q: G, w: number, h: number) => {
        q.fillStyle = m.wall;
        q.fillRect(0, 0, w, h);
        // dark wooden beams + lattice windows
        q.fillStyle = '#4a2a1e';
        q.fillRect(0, 0, w, 3);
        q.fillRect(0, h - 2.5, w, 2.5);
        const n = i === 0 ? 3 : 2;
        for (let k = 0; k < n; k++) {
          const x = (w / n) * (k + 0.5) - 5;
          if (i === 0 && side === 'L' && k === 1) {
            q.fillStyle = '#5a2a1a';
            q.fillRect(x - 1, h - 15, 12, 12.5);
            q.fillStyle = '#e8b84a';
            q.fillRect(x + 4.5, h - 15, 1, 12.5);
            continue;
          }
          q.fillStyle = '#ffdca0';
          q.fillRect(x, 5, 10, h - 10);
          q.strokeStyle = '#5a3020';
          q.lineWidth = 0.8;
          for (let l = 0; l <= 10; l += 2.5) {
            q.beginPath();
            q.moveTo(x + l, 5);
            q.lineTo(x + l, h - 5);
            q.stroke();
          }
          for (let l = 5; l <= h - 5; l += 3) {
            q.beginPath();
            q.moveTo(x, l);
            q.lineTo(x + 10, l);
            q.stroke();
          }
        }
        // red pillars at the edges
        q.fillStyle = m.pillar;
        q.fillRect(0, 0, 3, h);
        q.fillRect(w - 3, 0, 3, h);
        q.fillStyle = 'rgb(255 255 255 / 0.2)';
        q.fillRect(0.6, 0, 0.8, h);
      };
      box(g, u0, u0, u1, u1, z, z + th, m.wall, m.wall, m.wall, paint('L'), paint('R'));
      z += th;
      const last = i === tiers - 1;
      hipRoof(g, c, half + 0.11, last ? 0.015 : half - 0.03, z, last ? 26 : 10, m.roof);
      // lanterns hanging from the front eave corners
      if (i === 0 || i === 1) {
        for (const [du, dv] of [[-1, 1], [1, 1]] as const) {
          const p = P(c + du * (half + 0.09), c + dv * (half + 0.09), z - 6);
          glow(g, p.x, p.y, 7, 'rgb(255 120 60)', 0.45);
          g.fillStyle = '#e0412e';
          g.beginPath();
          g.ellipse(p.x, p.y, 2.2, 3, 0, 0, Math.PI * 2);
          g.fill();
          g.fillStyle = '#ffd36a';
          g.fillRect(p.x - 0.5, p.y - 1, 1, 2);
        }
      }
      z += last ? 26 : 10;
    }
    // finial
    const tp = P(c, c, z - 2);
    g.strokeStyle = '#c9952e';
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(tp.x, tp.y);
    g.lineTo(tp.x, tp.y - 18);
    g.stroke();
    g.fillStyle = '#f2c65a';
    for (let k = 0; k < 4; k++) {
      g.beginPath();
      g.ellipse(tp.x, tp.y - 4 - k * 4, 3 - k * 0.5, 1.2, 0, 0, Math.PI * 2);
      g.fill();
    }
    g.beginPath();
    g.arc(tp.x, tp.y - 19, 2, 0, Math.PI * 2);
    g.fill();
    // stone lanterns + small pine
    const l1 = P(0.2, 0.92);
    g.fillStyle = '#b8b0a2';
    g.fillRect(l1.x - 2, l1.y - 9, 4, 9);
    g.fillStyle = '#ffd98a';
    g.fillRect(l1.x - 1.5, l1.y - 8, 3, 3);
    g.fillStyle = '#8e877b';
    g.fillRect(l1.x - 3.5, l1.y - 10.5, 7, 2);
    bush(g, P(0.92, 0.3).x, P(0.92, 0.3).y, 4.5, '#3f7d4a', rng);
  });
}

// ------------------------------------------------------------ cyber tower

const NEON = ['#c04cff', '#29e3ff', '#ff3fa4', '#5dff8a', '#ffb340', '#6d7bff'];
const TOWER_H = [190, 250, 215, 290, 170, 265];

function curtainWall(q: G, w: number, h: number, rng: Rng, side: 'L' | 'R', neon: string) {
  const gr = q.createLinearGradient(0, 0, w * 0.3, h);
  if (side === 'L') {
    gr.addColorStop(0, '#5c6fa8');
    gr.addColorStop(0.5, '#33406e');
    gr.addColorStop(1, '#232a4d');
  } else {
    gr.addColorStop(0, '#3a3f74');
    gr.addColorStop(1, '#1b1d3a');
  }
  q.fillStyle = gr;
  q.fillRect(0, 0, w, h);
  const fh = 9;
  for (let y = 0; y < h; y += fh) {
    for (let x = 1.5; x < w - 2; x += 5) {
      const r = rng();
      if (r < 0.22) q.fillStyle = r < 0.08 ? 'rgb(255 214 140 / 0.9)' : 'rgb(140 230 255 / 0.75)';
      else q.fillStyle = 'rgb(20 24 60 / 0.35)';
      q.fillRect(x, y + 2, 3.6, fh - 4);
    }
    q.fillStyle = 'rgb(220 225 255 / 0.18)';
    q.fillRect(0, y, w, 1);
  }
  // sky reflection band
  q.fillStyle = 'rgb(200 220 255 / 0.13)';
  q.beginPath();
  q.moveTo(0, h * 0.25);
  q.lineTo(w, h * 0.05);
  q.lineTo(w, h * 0.18);
  q.lineTo(0, h * 0.4);
  q.closePath();
  q.fill();
  void neon;
}

function neonLine(g: G, a: Pt, b: Pt, col: string, wdt = 1.6) {
  g.save();
  g.globalCompositeOperation = 'lighter';
  g.strokeStyle = col;
  g.globalAlpha = 0.35;
  g.lineWidth = wdt * 4;
  g.beginPath();
  g.moveTo(a.x, a.y);
  g.lineTo(b.x, b.y);
  g.stroke();
  g.globalAlpha = 1;
  g.lineWidth = wdt;
  g.strokeStyle = shade(col, 1.5);
  g.stroke();
  g.restore();
}

function glyph(q: G, w: number, h: number, col: string, kind: number) {
  q.save();
  q.translate(w / 2, h / 2);
  q.strokeStyle = shade(col, 1.6);
  q.fillStyle = col;
  q.lineWidth = 1.6;
  q.shadowColor = col;
  q.shadowBlur = 6;
  const s = Math.min(w, h) * 0.32;
  q.beginPath();
  if (kind === 0) {
    q.moveTo(0, -s);
    q.lineTo(s, 0);
    q.lineTo(0, s);
    q.lineTo(-s, 0);
    q.closePath();
    q.moveTo(0, -s * 0.45);
    q.lineTo(s * 0.45, 0);
    q.lineTo(0, s * 0.45);
    q.lineTo(-s * 0.45, 0);
    q.closePath();
  } else if (kind === 1) {
    q.arc(0, 0, s, 0, Math.PI * 2);
    q.moveTo(s * 0.5, 0);
    q.arc(0, 0, s * 0.5, 0, Math.PI * 2);
  } else if (kind === 2) {
    for (let i = -1; i <= 1; i++) {
      q.moveTo(-s, i * s * 0.6 + s * 0.3);
      q.lineTo(0, i * s * 0.6 - s * 0.2);
      q.lineTo(s, i * s * 0.6 + s * 0.3);
    }
  } else {
    q.moveTo(-s, s);
    q.lineTo(-s * 0.3, -s);
    q.lineTo(s * 0.3, s * 0.2);
    q.lineTo(s, -s);
  }
  q.stroke();
  q.restore();
}

export function tower(variant: number): Sprite {
  const neon = NEON[variant % NEON.length];
  const neon2 = NEON[(variant + 2) % NEON.length];
  const rng = rngFor(44, variant);
  const H = TOWER_H[variant % TOWER_H.length];
  const setback = variant % 2 === 1;
  const POD = 22;
  return makeSprite(W, H + 50, DOWN, (g) => {
    // podium: glassy lobby with neon canopy
    box(g, 0.1, 0.1, 0.9, 0.9, 0, POD, '#e9e6ef', '#c9c4d6', '#d8d4e2', (q, w, h) => {
      q.fillStyle = '#ece9f2';
      q.fillRect(0, 0, w, h);
      const gr = q.createLinearGradient(0, 4, 0, h);
      gr.addColorStop(0, '#ffe6a8');
      gr.addColorStop(1, '#e8a25a');
      q.fillStyle = gr;
      q.fillRect(4, 6, w - 8, h - 6);
      q.fillStyle = 'rgb(70 50 90 / 0.5)';
      for (let x = 4; x < w - 4; x += 8) q.fillRect(x, 6, 1.2, h - 6);
    }, (q, w, h) => {
      q.fillStyle = '#d4cfe0';
      q.fillRect(0, 0, w, h);
      q.fillStyle = '#3b3f6e';
      q.fillRect(4, 6, w - 8, h - 9);
      q.fillStyle = 'rgb(140 230 255 / 0.5)';
      for (let x = 6; x < w - 6; x += 7) q.fillRect(x, 8, 3, h - 13);
    });
    neonLine(g, P(0.1, 0.9, POD - 4), P(0.9, 0.9, POD - 4), neon2, 2);
    neonLine(g, P(0.9, 0.9, POD - 4), P(0.9, 0.1, POD - 4), neon2, 2);
    // shaft
    const a0 = 0.2, a1 = 0.8;
    const H1 = setback ? Math.round(H * 0.68) : H;
    box(g, a0, a0, a1, a1, POD, H1, '#33406e', '#1f2346', '#4a4f7a', (q, w, h) => curtainWall(q, w, h, rng, 'L', neon), (q, w, h) => curtainWall(q, w, h, rng, 'R', neon), (q, w, h) => {
      q.fillStyle = '#4b507c';
      q.fillRect(0, 0, w, h);
    });
    // white structural frame on the lit side (ref: neon cat tower)
    box(g, a0 - 0.03, a1 - 0.06, a0 + 0.06, a1 + 0.03, POD, H1 - 6, '#f4f2f8', '#d2cfdc', '#ffffff');
    for (let z = POD + 36; z < H1 - 20; z += 46) box(g, a0 - 0.02, a1, a1 + 0.02, a1 + 0.06, z, z + 3.5, '#f4f2f8', '#d2cfdc', '#ffffff', undefined, undefined, undefined, false);
    // billboard on the lit face
    const bz = POD + 30 + (variant % 3) * 14;
    wallL(g, a0 + 0.12, a1 - 0.06, a1 + 0.005, bz, bz + 38, (q, w, h) => {
      q.fillStyle = '#120c26';
      q.fillRect(0, 0, w, h);
      const gr = q.createRadialGradient(w / 2, h / 2, 2, w / 2, h / 2, w * 0.7);
      gr.addColorStop(0, neon.replace('#', '#') + '55');
      gr.addColorStop(1, '#00000000');
      q.fillStyle = gr;
      q.fillRect(0, 0, w, h);
      glyph(q, w, h, neon, variant % 4);
      q.strokeStyle = neon;
      q.lineWidth = 1.2;
      q.strokeRect(1, 1, w - 2, h - 2);
    });
    // neon corner strips
    neonLine(g, P(a1, a1, POD), P(a1, a1, H1), neon, 1.6);
    neonLine(g, P(a0, a1, H1), P(a1, a1, H1), neon, 1.4);
    neonLine(g, P(a1, a1, H1), P(a1, a0, H1), neon, 1.4);
    let ztop = H1;
    if (setback) {
      const b0 = 0.3, b1 = 0.7;
      box(g, b0, b0, b1, b1, H1, H, '#3a4677', '#20244a', '#4a4f7a', (q, w, h) => curtainWall(q, w, h, rng, 'L', neon), (q, w, h) => curtainWall(q, w, h, rng, 'R', neon));
      neonLine(g, P(b1, b1, H1), P(b1, b1, H), neon2, 1.4);
      neonLine(g, P(b0, b1, H), P(b1, b1, H), neon2, 1.2);
      neonLine(g, P(b1, b1, H), P(b1, b0, H), neon2, 1.2);
      // terrace garden on the setback
      for (let i = 0; i < 4; i++) {
        const p = P(a0 + 0.06 + i * 0.13, a1 - 0.05, H1);
        bush(g, p.x, p.y, 3.2, '#4fae5a', rng);
      }
      ztop = H;
    }
    // roof: garden or antenna
    const c0 = setback ? 0.3 : a0, c1 = setback ? 0.7 : a1;
    if (variant % 3 === 0) {
      top(g, c0 + 0.03, c0 + 0.03, c1 - 0.03, c1 - 0.03, ztop + 0.5, (q, w, h) => {
        q.fillStyle = '#5e8f4c';
        q.fillRect(0, 0, w, h);
        grain(q, w, h, rng, 0.12);
      });
      for (let i = 0; i < 5; i++) {
        const p = P(c0 + 0.08 + rng() * (c1 - c0 - 0.16), c0 + 0.08 + rng() * (c1 - c0 - 0.16), ztop);
        bush(g, p.x, p.y, 3.5, rng.pick(['#4fae5a', '#3f8f4a', '#e88fc0']), rng);
      }
    } else {
      box(g, 0.44, 0.44, 0.56, 0.56, ztop, ztop + 10, '#c9c6d6', '#9a97ab', '#dedbe8');
      const ap = P(0.5, 0.5, ztop + 10);
      g.strokeStyle = '#d8d6e4';
      g.lineWidth = 1.5;
      g.beginPath();
      g.moveTo(ap.x, ap.y);
      g.lineTo(ap.x, ap.y - 28);
      g.stroke();
      glow(g, ap.x, ap.y - 29, 6, 'rgb(255 60 80)', 0.7);
      g.fillStyle = '#ff5a6a';
      g.beginPath();
      g.arc(ap.x, ap.y - 29, 1.6, 0, Math.PI * 2);
      g.fill();
    }
    // street-level details
    const s1 = P(0.05, 0.95);
    bush(g, s1.x, s1.y, 4, '#4f9a4a', rng);
    const s2 = P(0.95, 0.6);
    bush(g, s2.x, s2.y, 4, '#4f9a4a', rng);
  });
}

export const BUILDERS = [townhouse, greenhouse, pagoda, tower];

/** Footprint (u0, v0, u1, v1) and height (world px) per family/variant — used for shadows & picking. */
export function buildingMetrics(family: number, variant: number): { fp: [number, number, number, number]; h: number } {
  if (family === 0) {
    const floors = [2, 3, 3, 5, 2, 3][variant % 6];
    return { fp: [0.17, 0.2, 0.83, 0.83], h: (5 + floors * 25 + (variant % 6 === 3 ? 6 : 26)) / 2 };
  }
  if (family === 1) return { fp: [0.12, 0.16, 0.88, 0.86], h: (8 + 30 + (variant % 3) * 4 + 22) / 2 };
  if (family === 2) {
    const tiers = 3 + (variant % 3);
    let H = 9;
    for (let i = 0; i < tiers; i++) H += 22 - i * 2 + 10;
    return { fp: [0.22, 0.22, 0.78, 0.78], h: (H + 16) / 2 };
  }
  return { fp: [0.2, 0.2, 0.8, 0.8], h: TOWER_H[variant % 6] / 2 };
}
