/** Ground tiles: terrain, roads, plots, cliffs, bridges. */
import { CLIFF, HH, HW, P, S, Sprite, box, grain, hsl, makeSprite, poly, rngFor, shade, top, wallL, wallR } from './core';
import { Rng } from '../rng';
import { THEMES } from '../world/world';

type G = CanvasRenderingContext2D;
const W = HW * 2 + 4;
const C = CLIFF * S;
/** Tiles overlap a hair so no seams show between them. */
const E = 0.012;

function tile(paint: (g: G, w: number, h: number) => void, extra?: (g: G) => void): Sprite {
  return makeSprite(W, HH + 4, HH + 4, (g) => {
    top(g, -E, -E, 1 + E, 1 + E, 0, paint);
    extra?.(g);
  });
}

function grassTexture(q: G, w: number, h: number, hs: [number, number, number], rng: Rng, lush = 0) {
  const [H, Sa, L] = hs;
  q.fillStyle = hsl(H, Sa, L + lush);
  q.fillRect(0, 0, w, h);
  // soft mottling
  for (let i = 0; i < 7; i++) {
    const x = rng() * w, y = rng() * h, r = 8 + rng() * 14;
    const gr = q.createRadialGradient(x, y, 0, x, y, r);
    const dl = (rng() - 0.5) * 8;
    gr.addColorStop(0, hsl(H + (rng() - 0.5) * 10, Sa, L + lush + dl, 0.5));
    gr.addColorStop(1, hsl(H, Sa, L + lush + dl, 0));
    q.fillStyle = gr;
    q.fillRect(0, 0, w, h);
  }
  // blades
  for (let i = 0; i < 140; i++) {
    const x = rng() * w, y = rng() * h;
    const d = rng();
    q.fillStyle = d < 0.5 ? hsl(H + 4, Sa + 6, L + lush + 9, 0.7) : hsl(H - 4, Sa, L + lush - 9, 0.6);
    q.fillRect(x, y, 1.1, 2.2);
  }
  // clover / tiny flowers
  for (let i = 0; i < 4; i++) {
    q.fillStyle = rng.pick(['#fff7d6', '#ffe36e', '#ffc2dc', hsl(H, Sa, L + 16)]);
    q.fillRect(rng() * w, rng() * h, 1.3, 1.3);
  }
}

export interface GroundSet {
  grass: Sprite[][]; // [theme][variant]
  park: Sprite[][];
  plotFree: Sprite[];
  plotPad: Sprite[][]; // [theme][family]
  sand: Sprite[];
  plaza: Sprite[];
  road: Sprite[]; // by mask
  bridge: Sprite[]; // [axis-1]
  cliffL: Sprite[][]; // [theme][0=grass,1=sand]
  cliffR: Sprite[][];
}

function plotFree(t: number): Sprite {
  const rng = rngFor(301, t);
  const hs = THEMES[t].grass;
  return tile((q, w, h) => {
    grassTexture(q, w, h, [hs[0], hs[1] - 6, hs[2] + 6], rng);
    // mowed survey lot
    q.fillStyle = 'rgb(255 255 255 / 0.08)';
    q.fillRect(6, 6, w - 12, h - 12);
    q.strokeStyle = 'rgb(255 255 255 / 0.55)';
    q.lineWidth = 1.1;
    q.setLineDash([3, 3]);
    q.strokeRect(6.5, 6.5, w - 13, h - 13);
    q.setLineDash([]);
  }, (g) => {
    // corner stakes
    for (const [u, v] of [[0.12, 0.12], [0.88, 0.12], [0.12, 0.88], [0.88, 0.88]]) {
      const p = P(u, v);
      g.fillStyle = '#7a5332';
      g.fillRect(p.x - 0.8, p.y - 5, 1.6, 5);
      g.fillStyle = '#ff7a45';
      g.fillRect(p.x - 1.1, p.y - 5.5, 2.2, 2);
    }
  });
}

function plotPad(t: number, family: number): Sprite {
  const rng = rngFor(302, t, family);
  const hs = THEMES[t].grass;
  return tile((q, w, h) => {
    grassTexture(q, w, h, hs, rng);
    const m = 4;
    if (family === 1) {
      // garden beds
      q.fillStyle = '#7a5a3e';
      q.fillRect(m, m, w - 2 * m, h - 2 * m);
      grain(q, w, h, rng, 0.12, 200);
      q.fillStyle = '#d9cfbb';
      q.fillRect(w * 0.42, m, w * 0.16, h - 2 * m);
    } else if (family === 2) {
      // raked gravel
      q.fillStyle = '#e4dccb';
      q.fillRect(m, m, w - 2 * m, h - 2 * m);
      q.strokeStyle = 'rgb(140 120 90 / 0.35)';
      q.lineWidth = 0.7;
      for (let y = m + 3; y < h - m; y += 3) {
        q.beginPath();
        q.moveTo(m, y);
        q.lineTo(w - m, y);
        q.stroke();
      }
    } else {
      const base = family === 3 ? '#8d8a9a' : '#cdc6b8';
      q.fillStyle = shade(base, 0.85);
      q.fillRect(m, m, w - 2 * m, h - 2 * m);
      const s = 8;
      for (let y = m; y < h - m; y += s)
        for (let x = m; x < w - m; x += s) {
          q.fillStyle = shade(base, 0.92 + rng() * 0.16);
          q.fillRect(x + 0.5, y + 0.5, s - 1, s - 1);
        }
    }
    q.strokeStyle = 'rgb(0 0 0 / 0.18)';
    q.lineWidth = 1;
    q.strokeRect(m, m, w - 2 * m, h - 2 * m);
  });
}

function sand(v: number): Sprite {
  const rng = rngFor(303, v);
  return tile((q, w, h) => {
    q.fillStyle = '#e9d5a4';
    q.fillRect(0, 0, w, h);
    for (let i = 0; i < 5; i++) {
      const x = rng() * w, y = rng() * h, r = 10 + rng() * 14;
      const gr = q.createRadialGradient(x, y, 0, x, y, r);
      gr.addColorStop(0, `rgb(${rng() < 0.5 ? '245 228 185' : '214 190 140'} / 0.6)`);
      gr.addColorStop(1, 'rgb(233 213 164 / 0)');
      q.fillStyle = gr;
      q.fillRect(0, 0, w, h);
    }
    grain(q, w, h, rng, 0.1, 260);
    for (let i = 0; i < 3; i++) {
      q.fillStyle = rng.pick(['#fff4e6', '#c9a77a', '#f2b8a0']);
      q.fillRect(rng() * w, rng() * h, 1.5, 1.2);
    }
  });
}

function plaza(v: number): Sprite {
  const rng = rngFor(304, v);
  return tile((q, w, h) => {
    q.fillStyle = '#b9ab92';
    q.fillRect(0, 0, w, h);
    const s = 8;
    for (let y = 0; y < h; y += s)
      for (let x = (y / s) % 2 ? -s / 2 : 0; x < w; x += s) {
        q.fillStyle = shade(rng() < 0.15 ? '#c99e82' : '#ddd1ba', 0.9 + rng() * 0.15);
        q.fillRect(x + 0.6, y + 0.6, s - 1.2, s - 1.2);
      }
    grain(q, w, h, rng, 0.05, 120);
  });
}

function park(t: number, v: number): Sprite {
  const rng = rngFor(305, t, v);
  const hs = THEMES[t].grass;
  return tile((q, w, h) => {
    grassTexture(q, w, h, [hs[0] + 4, hs[1] + 6, hs[2]], rng, 3);
    // mowing stripes
    for (let x = 0; x < w; x += 16) {
      q.fillStyle = 'rgb(255 255 255 / 0.06)';
      q.fillRect(x, 0, 8, h);
    }
  });
}

/** Roads: mask bits 1 = −x, 2 = +x, 4 = −y, 8 = +y neighbour is road/bridge. */
function road(mask: number): Sprite {
  const rng = rngFor(306, mask);
  const SW = 10;
  return tile((q, w, h) => {
    q.fillStyle = '#4b4e5a';
    q.fillRect(0, 0, w, h);
    grain(q, w, h, rng, 0.07, 300);
    const side = '#cfc9bc';
    const curb = (x: number, y: number, ww: number, hh: number) => {
      q.fillStyle = side;
      q.fillRect(x, y, ww, hh);
      // paving joints
      q.fillStyle = 'rgb(0 0 0 / 0.08)';
      for (let k = 0; k < Math.max(ww, hh); k += 6) {
        if (ww > hh) q.fillRect(x + k, y, 0.7, hh);
        else q.fillRect(x, y + k, ww, 0.7);
      }
    };
    const n = (b: number) => (mask & b) !== 0;
    if (!n(1)) curb(0, 0, SW, h);
    if (!n(2)) curb(w - SW, 0, SW, h);
    if (!n(4)) curb(0, 0, w, SW);
    if (!n(8)) curb(0, h - SW, w, SW);
    // corner sidewalk squares where two road edges meet
    if (n(1) && n(4)) curb(0, 0, SW, SW);
    if (n(2) && n(4)) curb(w - SW, 0, SW, SW);
    if (n(1) && n(8)) curb(0, h - SW, SW, SW);
    if (n(2) && n(8)) curb(w - SW, h - SW, SW, SW);
    // kerb shadow lines
    q.fillStyle = 'rgb(0 0 0 / 0.25)';
    if (!n(1)) q.fillRect(SW, 0, 1, h);
    if (!n(2)) q.fillRect(w - SW - 1, 0, 1, h);
    if (!n(4)) q.fillRect(0, SW, w, 1);
    if (!n(8)) q.fillRect(0, h - SW - 1, w, 1);
    const deg = +n(1) + +n(2) + +n(4) + +n(8);
    q.fillStyle = 'rgb(255 236 170 / 0.85)';
    if (mask === 3) for (let x = 2; x < w; x += 12) q.fillRect(x, h / 2 - 0.7, 6, 1.4);
    else if (mask === 12) for (let y = 2; y < h; y += 12) q.fillRect(w / 2 - 0.7, y, 1.4, 6);
    if (deg >= 3) {
      q.fillStyle = 'rgb(245 245 240 / 0.8)';
      if (n(1)) for (let y = SW + 2; y < h - SW - 2; y += 4) q.fillRect(2, y, 6, 2);
      if (n(2)) for (let y = SW + 2; y < h - SW - 2; y += 4) q.fillRect(w - 8, y, 6, 2);
      if (n(4)) for (let x = SW + 2; x < w - SW - 2; x += 4) q.fillRect(x, 2, 2, 6);
      if (n(8)) for (let x = SW + 2; x < w - SW - 2; x += 4) q.fillRect(x, h - 8, 2, 6);
    }
  });
}

function bridge(axis: 1 | 2): Sprite {
  const rng = rngFor(307, axis);
  return makeSprite(W, HH + 30, HH + C + 8, (g) => {
    const a = axis === 1;
    // deck spans the tile along its axis; narrower across
    const [u0, u1, v0, v1] = a ? [-E, 1 + E, 0.22, 0.78] : [0.22, 0.78, -E, 1 + E];
    // stone pier under the deck
    const [pu0, pu1, pv0, pv1] = a ? [0.4, 0.6, 0.26, 0.74] : [0.26, 0.74, 0.4, 0.6];
    box(g, pu0, pv0, pu1, pv1, -C, -2, '#a9a294', '#857e72', '#b9b2a4', (q, w, h) => grain(q, w, h, rng, 0.1), (q, w, h) => grain(q, w, h, rng, 0.1));
    // deck side beam
    if (a) wallL(g, u0, u1, v1, -4, 0, (q, w, h) => { q.fillStyle = '#6e4a2c'; q.fillRect(0, 0, w, h); });
    else wallR(g, u1, v0, v1, -4, 0, (q, w, h) => { q.fillStyle = '#5a3b22'; q.fillRect(0, 0, w, h); });
    const rail = (along: number) => {
      // posts + top rail along the deck edge
      for (let k = 0; k <= 2; k++) {
        const t = k / 2;
        const [pu, pv] = a ? [t, along] : [along, t];
        const p0 = P(pu, pv, 0), p1 = P(pu, pv, 9);
        g.strokeStyle = '#f2ece0';
        g.lineWidth = 2;
        g.beginPath();
        g.moveTo(p0.x, p0.y);
        g.lineTo(p1.x, p1.y);
        g.stroke();
      }
      const r0 = a ? P(-E, along, 9) : P(along, -E, 9), r1 = a ? P(1 + E, along, 9) : P(along, 1 + E, 9);
      g.strokeStyle = '#f7f2e8';
      g.lineWidth = 2;
      g.beginPath();
      g.moveTo(r0.x, r0.y);
      g.lineTo(r1.x, r1.y);
      g.stroke();
      g.strokeStyle = 'rgb(40 30 50 / 0.4)';
      g.lineWidth = 0.8;
      g.beginPath();
      g.moveTo(r0.x, r0.y + 1.5);
      g.lineTo(r1.x, r1.y + 1.5);
      g.stroke();
    };
    rail(a ? v0 + 0.02 : u0 + 0.02);
    top(g, u0, v0, u1, v1, 0, (q, w, h) => {
      q.fillStyle = '#a8774a';
      q.fillRect(0, 0, w, h);
      const along = a ? w : h;
      for (let k = 0; k < along; k += 4) {
        q.fillStyle = shade('#a8774a', 0.85 + rng() * 0.3);
        if (a) q.fillRect(k + 0.4, 0, 3.2, h);
        else q.fillRect(0, k + 0.4, w, 3.2);
      }
      q.fillStyle = 'rgb(0 0 0 / 0.15)';
      if (a) {
        q.fillRect(0, 0, w, 1.5);
        q.fillRect(0, h - 1.5, w, 1.5);
      } else {
        q.fillRect(0, 0, 1.5, h);
        q.fillRect(w - 1.5, 0, 1.5, h);
      }
    });
    rail(a ? v1 - 0.02 : u1 - 0.02);
  });
}

function cliffPaint(q: G, w: number, h: number, rng: Rng, sandy: boolean, grass: [number, number, number], side: 'L' | 'R') {
  const gr = q.createLinearGradient(0, 0, 0, h);
  if (sandy) {
    gr.addColorStop(0, '#d9bf86');
    gr.addColorStop(1, '#a9895a');
  } else {
    gr.addColorStop(0, '#8a6a4a');
    gr.addColorStop(0.5, '#6e5440');
    gr.addColorStop(1, '#4c4040');
  }
  q.fillStyle = gr;
  q.fillRect(0, 0, w, h);
  // strata + stones
  for (let i = 0; i < 9; i++) {
    q.fillStyle = `rgb(${sandy ? '120 90 50' : '40 30 30'} / 0.22)`;
    q.fillRect(rng() * w, 5 + rng() * (h - 6), 4 + rng() * 10, 1);
  }
  for (let i = 0; i < 6; i++) {
    const x = rng() * w, y = 6 + rng() * (h - 8);
    q.fillStyle = sandy ? '#c8ae7a' : '#9a8e84';
    q.beginPath();
    q.ellipse(x, y, 2 + rng() * 2, 1.4 + rng(), 0, 0, Math.PI * 2);
    q.fill();
    q.fillStyle = 'rgb(255 255 255 / 0.25)';
    q.fillRect(x - 1, y - 1.2, 1.5, 0.8);
  }
  // grass / sand lip with drips
  if (!sandy) {
    q.fillStyle = hsl(grass[0], grass[1], grass[2] - 6);
    q.fillRect(0, 0, w, 3);
    for (let x = 0; x < w; x += 2.5) {
      const d = 2 + rng() * 4;
      q.fillRect(x, 2, 1.6, d);
    }
  }
  q.fillStyle = side === 'R' ? 'rgb(20 20 50 / 0.28)' : 'rgb(255 240 210 / 0.05)';
  q.fillRect(0, 0, w, h);
  // wet line near the water
  q.fillStyle = 'rgb(20 40 60 / 0.25)';
  q.fillRect(0, h - 3, w, 3);
}

function cliff(side: 'L' | 'R', t: number, sandy: boolean): Sprite {
  const rng = rngFor(308, t, +sandy, side === 'L' ? 1 : 2);
  const grass = THEMES[t].grass;
  return makeSprite(W, HH + 4, HH + C + 4, (g) => {
    if (side === 'L') wallL(g, -E, 1 + E, 1, -C, 0, (q, w, h) => cliffPaint(q, w, h, rng, sandy, grass, 'L'));
    else wallR(g, 1, -E, 1 + E, -C, 0, (q, w, h) => cliffPaint(q, w, h, rng, sandy, grass, 'R'));
  });
}

let cache: GroundSet | null = null;
export function groundSprites(): GroundSet {
  if (cache) return cache;
  const th = THEMES.map((_, i) => i);
  cache = {
    grass: th.map((t) => [0, 1, 2, 3].map((v) => tile((q, w, h) => grassTexture(q, w, h, THEMES[t].grass, rngFor(300, t, v))))),
    park: th.map((t) => [0, 1].map((v) => park(t, v))),
    plotFree: th.map((t) => plotFree(t)),
    plotPad: th.map((t) => [0, 1, 2, 3].map((f) => plotPad(t, f))),
    sand: [0, 1, 2].map(sand),
    plaza: [0, 1].map(plaza),
    road: Array.from({ length: 16 }, (_, m) => road(m)),
    bridge: [bridge(1), bridge(2)],
    cliffL: th.map((t) => [cliff('L', t, false), cliff('L', t, true)]),
    cliffR: th.map((t) => [cliff('R', t, false), cliff('R', t, true)]),
  };
  void poly;
  return cache;
}
