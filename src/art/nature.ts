/** Trees, props and landmarks. */
import { HH, HW, OUTLINE, P, Sprite, box, bricks, contactShadow, glow, grain, makeSprite, poly, rngFor, shade, top, wallL } from './core';
import { Rng } from '../rng';
import { D } from '../world/world';

type G = CanvasRenderingContext2D;
const W = HW * 2;
const DOWN = HH + 10;

function blob(g: G, x: number, y: number, r: number, col: string, hi = 1.35, lo = 0.62) {
  const gr = g.createRadialGradient(x - r * 0.45, y - r * 0.5, r * 0.08, x, y, r * 1.05);
  gr.addColorStop(0, shade(col, hi));
  gr.addColorStop(0.55, col);
  gr.addColorStop(1, shade(col, lo));
  g.fillStyle = gr;
  g.beginPath();
  g.arc(x, y, r, 0, Math.PI * 2);
  g.fill();
}

function leafSpeckle(g: G, x: number, y: number, r: number, col: string, rng: Rng, n = 40) {
  for (let i = 0; i < n; i++) {
    const a = rng() * Math.PI * 2, d = Math.sqrt(rng()) * r;
    const px = x + Math.cos(a) * d, py = y + Math.sin(a) * d * 0.9;
    const lit = px - x + (py - y) < 0;
    g.fillStyle = lit ? shade(col, 1.5 + rng() * 0.2) : shade(col, 0.55);
    g.globalAlpha = 0.55;
    g.beginPath();
    g.ellipse(px, py, 1.6, 1.1, rng() * 3, 0, Math.PI * 2);
    g.fill();
  }
  g.globalAlpha = 1;
}

function trunk(g: G, h: number, w = 3.2, col = '#6b4a32') {
  const gr = g.createLinearGradient(-w, 0, w, 0);
  gr.addColorStop(0, shade(col, 1.25));
  gr.addColorStop(1, shade(col, 0.7));
  g.fillStyle = gr;
  g.beginPath();
  g.moveTo(-w, 0);
  g.lineTo(-w * 0.6, -h);
  g.lineTo(w * 0.6, -h);
  g.lineTo(w, 0);
  g.closePath();
  g.fill();
}

function roundTree(variant: number, palette: string[]): Sprite {
  const rng = rngFor(101, variant, palette.length);
  const s = 0.85 + (variant % 3) * 0.14;
  const h = 34 * s;
  return makeSprite(W, 96, DOWN, (g) => {
    contactShadow(g, 20 * s, 9 * s, 8, 2, 0.32);
    trunk(g, h * 0.7);
    const col = rng.pick(palette);
    const blobs: [number, number, number][] = [];
    for (let i = 0; i < 6; i++) blobs.push([(rng() - 0.5) * 22 * s, -h - (rng() - 0.3) * 18 * s, (10 + rng() * 6) * s]);
    blobs.sort((a, b) => a[1] - b[1]);
    // dark under-layer for depth
    for (const [x, y, r] of blobs) blob(g, x + 1.5, y + 2, r, shade(col, 0.7), 1, 0.5);
    for (const [x, y, r] of blobs) blob(g, x, y, r * 0.92, col);
    leafSpeckle(g, 0, -h - 4, 20 * s, col, rng, 70);
    g.strokeStyle = 'rgb(20 30 20 / 0.25)';
    g.lineWidth = 1;
  });
}

function conifer(variant: number): Sprite {
  const rng = rngFor(102, variant);
  const s = 0.85 + (variant % 3) * 0.16;
  const col = rng.pick(['#2f6b45', '#2b5f48', '#3a7550']);
  return makeSprite(W, 100, DOWN, (g) => {
    contactShadow(g, 15 * s, 7 * s, 7, 2, 0.32);
    trunk(g, 10, 2.6);
    const layers = 4;
    for (let i = 0; i < layers; i++) {
      const y = -8 - i * 12 * s, w = (17 - i * 3.2) * s, hh = 22 * s;
      g.beginPath();
      g.moveTo(-w, y);
      g.quadraticCurveTo(0, y + 4, w, y);
      g.lineTo(0, y - hh);
      g.closePath();
      const gr = g.createLinearGradient(-w, 0, w, 0);
      gr.addColorStop(0, shade(col, 1.35));
      gr.addColorStop(0.45, col);
      gr.addColorStop(1, shade(col, 0.55));
      g.fillStyle = gr;
      g.fill();
      g.strokeStyle = 'rgb(10 30 20 / 0.35)';
      g.lineWidth = 0.8;
      g.stroke();
      leafSpeckle(g, -w * 0.3, y - hh * 0.3, w * 0.5, col, rng, 12);
    }
  });
}

function palm(variant: number): Sprite {
  const rng = rngFor(103, variant);
  const lean = (variant % 2 ? 1 : -1) * (5 + variant * 2);
  return makeSprite(W, 104, DOWN, (g) => {
    contactShadow(g, 14, 6, 10, 2, 0.3);
    // curved trunk with rings
    const h = 50 + variant * 4;
    for (let i = 0; i < 14; i++) {
      const t = i / 13;
      const x = lean * t * t, y = -h * t;
      g.fillStyle = i % 2 ? '#a07a4f' : '#8a6640';
      g.beginPath();
      g.ellipse(x, y, 3.2 - t, 2.2, 0, 0, Math.PI * 2);
      g.fill();
    }
    const tx = lean, ty = -h;
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + rng() * 0.3;
      const len = 20 + rng() * 6;
      const ex = tx + Math.cos(a) * len, ey = ty + Math.sin(a) * len * 0.45 + 8;
      g.strokeStyle = i % 2 ? '#3f8f3a' : '#57a843';
      g.lineWidth = 4;
      g.beginPath();
      g.moveTo(tx, ty);
      g.quadraticCurveTo((tx + ex) / 2, ty - 8, ex, ey);
      g.stroke();
      g.strokeStyle = 'rgb(255 255 200 / 0.25)';
      g.lineWidth = 1;
      g.stroke();
    }
    g.fillStyle = '#6b4a2a';
    for (let i = 0; i < 3; i++) {
      g.beginPath();
      g.arc(tx - 2 + i * 2, ty + 2, 1.8, 0, Math.PI * 2);
      g.fill();
    }
  });
}

function bushSprite(variant: number): Sprite {
  const rng = rngFor(104, variant);
  return makeSprite(W, 40, DOWN, (g) => {
    contactShadow(g, 12, 5, 4, 2, 0.28);
    const col = rng.pick(['#4f8f3e', '#5c9a46', '#3f7d45']);
    for (let i = 0; i < 5; i++) blob(g, (rng() - 0.5) * 14, -5 - rng() * 6, 5 + rng() * 2.5, col);
    leafSpeckle(g, 0, -7, 9, col, rng, 18);
    if (variant % 2) for (let i = 0; i < 6; i++) {
      g.fillStyle = rng.pick(['#ff8fb8', '#fff1a8', '#ffffff']);
      g.beginPath();
      g.arc((rng() - 0.5) * 14, -6 - rng() * 7, 1.2, 0, Math.PI * 2);
      g.fill();
    }
  });
}

function flowerBed(variant: number): Sprite {
  const rng = rngFor(105, variant);
  return makeSprite(W, 20, DOWN, (g) => {
    const cols = [['#ff6b8b', '#ffd34d', '#ffffff'], ['#b38bff', '#ff9ad5', '#fff'], ['#ff8a3d', '#ffd34d', '#ff4d4d']][variant % 3];
    for (let i = 0; i < 26; i++) {
      const u = 0.25 + rng() * 0.5, v = 0.25 + rng() * 0.5;
      const p = P(u, v);
      g.fillStyle = '#3f7d3a';
      g.fillRect(p.x - 0.5, p.y - 3, 1, 3);
      g.fillStyle = rng.pick(cols);
      g.beginPath();
      g.arc(p.x, p.y - 3.5, 1.6, 0, Math.PI * 2);
      g.fill();
    }
  });
}

function rock(variant: number): Sprite {
  const rng = rngFor(106, variant);
  return makeSprite(W, 30, DOWN, (g) => {
    contactShadow(g, 12, 5, 3, 2, 0.25);
    for (let k = 0; k < 2; k++) {
      const x = (k - 0.5) * 9 + rng() * 3, r = 6 + rng() * 4 - k * 2;
      g.beginPath();
      g.moveTo(x - r, 0);
      g.lineTo(x - r * 0.7, -r * 0.9);
      g.lineTo(x + r * 0.1, -r * 1.2);
      g.lineTo(x + r, -r * 0.4);
      g.lineTo(x + r * 0.8, 0);
      g.closePath();
      const gr = g.createLinearGradient(x - r, -r, x + r, 0);
      gr.addColorStop(0, '#c9c6bd');
      gr.addColorStop(1, '#6f6c68');
      g.fillStyle = gr;
      g.fill();
      g.strokeStyle = OUTLINE;
      g.lineWidth = 1;
      g.stroke();
    }
  });
}

/** Street lamp on the kerb: `alongU` = road runs along x, lamp sits on the +y sidewalk (else on the +x one). */
function lamp(alongU: boolean): Sprite {
  return makeSprite(W, 70, DOWN, (g) => {
    const at = alongU ? P(0.5, 0.93) : P(0.93, 0.5);
    g.translate(at.x, at.y);
    contactShadow(g, 5, 2, 2, 1, 0.3);
    g.fillStyle = '#2c3140';
    g.fillRect(-1.2, -42, 2.4, 42);
    g.fillRect(-3, -2, 6, 2);
    g.fillRect(-1, -44, 9, 1.8);
    glow(g, 7, -40, 16, 'rgb(255 214 140)', 0.55);
    g.fillStyle = '#fff1c4';
    g.beginPath();
    g.ellipse(7, -40, 3, 2, 0, 0, Math.PI * 2);
    g.fill();
  });
}

function bench(): Sprite {
  return makeSprite(W, 30, DOWN, (g) => {
    contactShadow(g, 12, 4, 2, 1, 0.25);
    box(g, 0.3, 0.45, 0.7, 0.55, 4, 6, '#a8703f', '#7f5230', '#c4874f');
    box(g, 0.3, 0.42, 0.7, 0.45, 6, 13, '#a8703f', '#7f5230', '#c4874f');
    box(g, 0.32, 0.47, 0.36, 0.53, 0, 4, '#333', '#222', '#444', undefined, undefined, undefined, false);
    box(g, 0.64, 0.47, 0.68, 0.53, 0, 4, '#333', '#222', '#444', undefined, undefined, undefined, false);
  });
}

// ------------------------------------------------------------ landmarks

function fountain(): Sprite {
  const rng = rngFor(201);
  return makeSprite(W + 20, 80, DOWN, (g) => {
    // octagonal-ish basin as a ring of stone
    const ring = (r: number, z: number, col: string) => {
      g.beginPath();
      g.ellipse(0, -z, r * HW * 1.0, r * HH * 1.0, 0, 0, Math.PI * 2);
      g.fillStyle = col;
      g.fill();
    };
    contactShadow(g, 50, 22, 6, 4, 0.3);
    ring(0.42, 0, '#9d968a');
    ring(0.42, 6, '#d8d0c0');
    ring(0.36, 6, '#4aa3c4');
    // water ripples
    g.strokeStyle = 'rgb(255 255 255 / 0.45)';
    g.lineWidth = 1;
    for (let i = 1; i < 4; i++) {
      g.beginPath();
      g.ellipse(0, -6, 0.1 * i * HW, 0.1 * i * HH, 0, 0, Math.PI * 2);
      g.stroke();
    }
    // column + upper bowl
    g.fillStyle = '#cfc7b6';
    g.fillRect(-3, -28, 6, 22);
    g.beginPath();
    g.ellipse(0, -28, 12, 5, 0, 0, Math.PI * 2);
    g.fillStyle = '#e1d9c9';
    g.fill();
    g.beginPath();
    g.ellipse(0, -29, 10, 3.8, 0, 0, Math.PI * 2);
    g.fillStyle = '#5ab4d4';
    g.fill();
    // spray
    for (let i = 0; i < 26; i++) {
      const a = rng() * Math.PI * 2, d = rng() * 14;
      g.fillStyle = `rgb(220 245 255 / ${0.4 + rng() * 0.5})`;
      g.beginPath();
      g.arc(Math.cos(a) * d, -30 - (14 - d) * 1.4 - rng() * 6, 1 + rng(), 0, Math.PI * 2);
      g.fill();
    }
    g.strokeStyle = 'rgb(230 250 255 / 0.8)';
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(0, -30);
    g.lineTo(0, -52);
    g.stroke();
  });
}

function lighthouse(): Sprite {
  return makeSprite(W, 200, DOWN, (g) => {
    contactShadow(g, 30, 13, 10, 3, 0.3);
    box(g, 0.22, 0.22, 0.78, 0.78, 0, 8, '#8f8a82', '#6f6a64', '#a8a39a');
    // tapered striped tower drawn as stacked frusta
    const segs = 6;
    for (let i = 0; i < segs; i++) {
      const z0 = 8 + i * 22, z1 = z0 + 22;
      const r0 = 0.2 - i * 0.012, r1 = 0.2 - (i + 1) * 0.012;
      const col = i % 2 ? '#d9433a' : '#f6f2ea';
      const l0 = P(0.5 - r0, 0.5 + r0, z0), m0 = P(0.5 + r0, 0.5 + r0, z0), k0 = P(0.5 + r0, 0.5 - r0, z0);
      const l1 = P(0.5 - r1, 0.5 + r1, z1), m1 = P(0.5 + r1, 0.5 + r1, z1), k1 = P(0.5 + r1, 0.5 - r1, z1);
      g.fillStyle = col;
      poly(g, [l0, m0, m1, l1]);
      g.fill();
      g.fillStyle = shade(col === '#d9433a' ? '#d9433a' : '#f6f2ea', 0.72);
      poly(g, [m0, k0, k1, m1]);
      g.fill();
    }
    const zt = 8 + segs * 22;
    box(g, 0.33, 0.33, 0.67, 0.67, zt, zt + 4, '#3a3d4a', '#2a2c36', '#4a4d5a');
    // lantern room
    const lp = P(0.5, 0.5, zt + 14);
    glow(g, lp.x, lp.y, 34, 'rgb(255 236 160)', 0.55);
    box(g, 0.38, 0.38, 0.62, 0.62, zt + 4, zt + 22, '#fff4c2', '#f0d78a', '#ffe9a0', (q, w, h) => {
      q.fillStyle = '#2a2c36';
      for (let x = 0; x < w; x += w / 3) q.fillRect(x, 0, 1.2, h);
    }, (q, w, h) => {
      q.fillStyle = '#2a2c36';
      for (let x = 0; x < w; x += w / 3) q.fillRect(x, 0, 1.2, h);
    });
    // dome
    const d = P(0.5, 0.5, zt + 22);
    g.fillStyle = '#c4382f';
    g.beginPath();
    g.ellipse(d.x, d.y, 16, 8, 0, Math.PI, 0);
    g.quadraticCurveTo(d.x, d.y - 20, d.x - 16, d.y);
    g.fill();
    g.fillStyle = '#2a2c36';
    g.fillRect(d.x - 0.8, d.y - 22, 1.6, 8);
  });
}

function clocktower(): Sprite {
  const rng = rngFor(203);
  return makeSprite(W, 200, DOWN, (g) => {
    contactShadow(g, 30, 13, 10, 3, 0.3);
    box(g, 0.18, 0.18, 0.82, 0.82, 0, 8, '#bdb5a5', '#9b9385', '#d6cebe');
    const H = 120;
    const face = (q: CanvasRenderingContext2D, w: number, h: number) => {
      bricks(q, w, h, '#b6644a', rng, 7, 3.4);
      q.fillStyle = '#efe4cc';
      q.fillRect(0, 0, w, 4);
      q.fillRect(0, h * 0.42, w, 3);
      // clock
      const cx = w / 2, cy = 16;
      q.fillStyle = '#efe4cc';
      q.beginPath();
      q.arc(cx, cy, 11, 0, Math.PI * 2);
      q.fill();
      q.fillStyle = '#fffaf0';
      q.beginPath();
      q.arc(cx, cy, 9, 0, Math.PI * 2);
      q.fill();
      q.strokeStyle = '#222';
      q.lineWidth = 1.2;
      q.beginPath();
      q.moveTo(cx, cy);
      q.lineTo(cx, cy - 6.5);
      q.moveTo(cx, cy);
      q.lineTo(cx + 4.5, cy + 1.5);
      q.stroke();
      for (let k = 0; k < 12; k++) {
        const a = (k / 12) * Math.PI * 2;
        q.fillStyle = '#333';
        q.fillRect(cx + Math.cos(a) * 7.5 - 0.5, cy + Math.sin(a) * 7.5 - 0.5, 1, 1);
      }
      for (let y = 40; y < h - 20; y += 22) {
        q.fillStyle = '#efe4cc';
        q.fillRect(w / 2 - 4, y - 1, 8, 13);
        q.fillStyle = '#41577a';
        q.fillRect(w / 2 - 3, y, 6, 11);
      }
      q.fillStyle = '#5a3a2a';
      q.fillRect(w / 2 - 5, h - 16, 10, 16);
    };
    box(g, 0.3, 0.3, 0.7, 0.7, 8, H, '#b6644a', '#b6644a', '#8a4a3a', face, face);
    // spire
    const c = 0.5, e = 0.23, z = H, t = P(c, c, z + 48);
    const E = (du: number, dv: number) => P(c + du * e, c + dv * e, z);
    g.fillStyle = '#3a5a6b';
    poly(g, [E(-1, 1), E(1, 1), t]);
    g.fill();
    g.fillStyle = '#2a4352';
    poly(g, [E(1, 1), E(1, -1), t]);
    g.fill();
    g.strokeStyle = OUTLINE;
    g.lineWidth = 1.2;
    poly(g, [E(-1, 1), E(1, 1), E(1, -1), t]);
    g.stroke();
    g.fillStyle = '#e8b84a';
    g.beginPath();
    g.arc(t.x, t.y - 2, 2.2, 0, Math.PI * 2);
    g.fill();
  });
}

function statue(): Sprite {
  return makeSprite(W, 130, DOWN, (g) => {
    contactShadow(g, 26, 11, 8, 3, 0.3);
    box(g, 0.25, 0.25, 0.75, 0.75, 0, 6, '#c8c0b0', '#a59d8e', '#ddd5c6');
    box(g, 0.36, 0.36, 0.64, 0.64, 6, 26, '#e7e1d6', '#bdb6a9', '#f2ede4', (q, w, h) => {
      q.fillStyle = '#e8b84a';
      q.fillRect(4, h / 2 - 2, w - 8, 4);
    });
    // obelisk with glowing inlay
    const c = 0.5, e = 0.08, z0 = 26, z1 = 100;
    const B = (du: number, dv: number) => P(c + du * e, c + dv * e, z0);
    const T2 = (du: number, dv: number) => P(c + du * e * 0.6, c + dv * e * 0.6, z1);
    const apex = P(c, c, z1 + 12);
    g.fillStyle = '#ece6da';
    poly(g, [B(-1, 1), B(1, 1), T2(1, 1), T2(-1, 1)]);
    g.fill();
    g.fillStyle = '#bfb8ab';
    poly(g, [B(1, 1), B(1, -1), T2(1, -1), T2(1, 1)]);
    g.fill();
    g.fillStyle = '#e8b84a';
    poly(g, [T2(-1, 1), T2(1, 1), apex]);
    g.fill();
    g.fillStyle = '#b88a2a';
    poly(g, [T2(1, 1), T2(1, -1), apex]);
    g.fill();
    g.strokeStyle = OUTLINE;
    g.lineWidth = 1.1;
    poly(g, [B(-1, 1), B(1, 1), B(1, -1), T2(1, -1), apex, T2(-1, 1)]);
    g.stroke();
    const m = P(c - e * 0.4, c + e, 60);
    g.save();
    g.globalCompositeOperation = 'lighter';
    glow(g, m.x, m.y, 10, 'rgb(120 220 255)', 0.5);
    g.restore();
  });
}

function windmill(): Sprite {
  return makeSprite(W + 30, 170, DOWN, (g) => {
    contactShadow(g, 28, 12, 8, 3, 0.3);
    // tapered tower
    const c = 0.5;
    const z1 = 78;
    const B = (du: number, dv: number) => P(c + du * 0.24, c + dv * 0.24, 0);
    const T2 = (du: number, dv: number) => P(c + du * 0.15, c + dv * 0.15, z1);
    g.fillStyle = '#efe6d4';
    poly(g, [B(-1, 1), B(1, 1), T2(1, 1), T2(-1, 1)]);
    g.fill();
    g.fillStyle = '#c9bfab';
    poly(g, [B(1, 1), B(1, -1), T2(1, -1), T2(1, 1)]);
    g.fill();
    g.strokeStyle = OUTLINE;
    g.lineWidth = 1.2;
    poly(g, [B(-1, 1), B(1, 1), B(1, -1), T2(1, -1), T2(1, 1), T2(-1, 1)]);
    g.stroke();
    const d = P(c - 0.05, c + 0.24, 0);
    g.fillStyle = '#6b4a32';
    g.fillRect(d.x - 4, d.y - 14, 8, 14);
    const w1 = P(c - 0.02, c + 0.2, 40);
    g.fillStyle = '#41577a';
    g.fillRect(w1.x - 3, w1.y - 6, 6, 8);
    // cap
    const cap = P(c, c, z1);
    g.fillStyle = '#7a3b2a';
    g.beginPath();
    g.moveTo(cap.x - 22, cap.y + 4);
    g.quadraticCurveTo(cap.x, cap.y - 26, cap.x + 22, cap.y + 4);
    g.closePath();
    g.fill();
    g.stroke();
    // sails
    const hub = { x: cap.x - 8, y: cap.y - 4 };
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + 0.5;
      g.save();
      g.translate(hub.x, hub.y);
      g.transform(0.75, 0.35, 0, 1, 0, 0);
      g.rotate(a);
      g.fillStyle = '#5a3d28';
      g.fillRect(-1, 0, 2, 58);
      g.fillStyle = 'rgb(245 240 228 / 0.92)';
      g.fillRect(1, 12, 11, 44);
      g.strokeStyle = '#5a3d28';
      g.lineWidth = 0.8;
      for (let y = 12; y < 56; y += 7) {
        g.beginPath();
        g.moveTo(1, y);
        g.lineTo(12, y);
        g.stroke();
      }
      g.restore();
    }
    g.fillStyle = '#3a2a1a';
    g.beginPath();
    g.arc(hub.x, hub.y, 3, 0, Math.PI * 2);
    g.fill();
  });
}

function gazebo(): Sprite {
  return makeSprite(W, 110, DOWN, (g) => {
    contactShadow(g, 34, 15, 8, 3, 0.3);
    box(g, 0.15, 0.15, 0.85, 0.85, 0, 5, '#d8d0c0', '#b2aa9b', '#e9e2d4');
    const posts: [number, number][] = [[0.22, 0.22], [0.78, 0.22], [0.22, 0.78], [0.78, 0.78], [0.5, 0.82], [0.82, 0.5]];
    posts.sort((a, b) => a[0] + a[1] - (b[0] + b[1]));
    for (const [u, v] of posts) box(g, u - 0.025, v - 0.025, u + 0.025, v + 0.025, 5, 42, '#fbf7ee', '#d9d2c4', '#fff', undefined, undefined, undefined, false);
    // pyramid roof
    const c = 0.5, e = 0.42, z = 42, t = P(c, c, z + 34);
    const E = (du: number, dv: number) => P(c + du * e, c + dv * e, z);
    g.fillStyle = '#3e6e6c';
    poly(g, [E(-1, 1), E(1, 1), t]);
    g.fill();
    g.fillStyle = '#2c5150';
    poly(g, [E(1, 1), E(1, -1), t]);
    g.fill();
    g.strokeStyle = OUTLINE;
    g.lineWidth = 1.2;
    poly(g, [E(-1, 1), E(1, 1), E(1, -1), t]);
    g.stroke();
    g.strokeStyle = 'rgb(255 255 255 / 0.25)';
    g.beginPath();
    g.moveTo(E(1, 1).x, E(1, 1).y);
    g.lineTo(t.x, t.y);
    g.stroke();
    g.fillStyle = '#e8b84a';
    g.beginPath();
    g.arc(t.x, t.y - 2, 2.4, 0, Math.PI * 2);
    g.fill();
    top(g, 0.2, 0.2, 0.8, 0.8, 5.2, (q, w, h) => {
      q.fillStyle = 'rgb(0 0 0 / 0.08)';
      q.fillRect(0, 0, w, h);
    });
    void wallL;
    void grain;
  });
}

// ------------------------------------------------------------ registry

let cache: Map<number, Sprite[]> | null = null;

/** Sprite variants per deco code. */
export function decoSprites(): Map<number, Sprite[]> {
  if (cache) return cache;
  const m = new Map<number, Sprite[]>();
  const round = ['#4f9a3e', '#5aa843', '#438a3f', '#6aaa3a'];
  m.set(D.TREE_ROUND, [0, 1, 2, 3, 4].map((v) => roundTree(v, round)));
  m.set(D.TREE_CONIFER, [0, 1, 2, 3].map((v) => conifer(v)));
  m.set(D.TREE_SAKURA, [0, 1, 2, 3].map((v) => roundTree(v, ['#f2a7c3', '#f7bcd2', '#eb93b5'])));
  m.set(D.TREE_PALM, [0, 1, 2, 3].map((v) => palm(v)));
  m.set(D.TREE_AUTUMN, [0, 1, 2, 3, 4].map((v) => roundTree(v, ['#e0782e', '#d9542b', '#e8a23a', '#c9452f'])));
  m.set(D.BUSH, [0, 1, 2, 3].map((v) => bushSprite(v)));
  m.set(D.FLOWERS, [0, 1, 2].map((v) => flowerBed(v)));
  m.set(D.ROCK, [0, 1, 2].map((v) => rock(v)));
  m.set(D.LAMP, [lamp(true)]);
  m.set(D.LAMP_V, [lamp(false)]);
  m.set(D.BENCH, [bench()]);
  m.set(D.LM_FOUNTAIN, [fountain()]);
  m.set(D.LM_LIGHTHOUSE, [lighthouse()]);
  m.set(D.LM_CLOCKTOWER, [clocktower()]);
  m.set(D.LM_STATUE, [statue()]);
  m.set(D.LM_WINDMILL, [windmill()]);
  m.set(D.LM_GAZEBO, [gazebo()]);
  cache = m;
  return m;
}

export const DECO_NAMES: Record<number, string> = {
  [D.TREE_ROUND]: 'Tree', [D.TREE_CONIFER]: 'Pine', [D.TREE_SAKURA]: 'Cherry blossom', [D.TREE_PALM]: 'Palm', [D.TREE_AUTUMN]: 'Maple',
  [D.BUSH]: 'Shrubs', [D.FLOWERS]: 'Flower bed', [D.ROCK]: 'Rocks', [D.LAMP]: 'Street lamp', [D.LAMP_V]: 'Street lamp', [D.BENCH]: 'Bench',
  [D.LM_FOUNTAIN]: 'Fountain', [D.LM_LIGHTHOUSE]: 'Lighthouse', [D.LM_CLOCKTOWER]: 'Clock tower', [D.LM_STATUE]: 'Obelisk', [D.LM_WINDMILL]: 'Windmill', [D.LM_GAZEBO]: 'Gazebo',
};
