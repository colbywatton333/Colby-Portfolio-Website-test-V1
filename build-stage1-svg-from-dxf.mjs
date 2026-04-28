// Converts the 13 DXF frames in STAGE ONE VINYL ANIMATION/ into 13 SVG frames
// in the Stage Two canonical format — identical viewBox across every frame,
// all geometry as <path>, with a single <g transform="matrix(...)"> wrapper
// mapping CAD coordinates (y-up) into SVG coordinates (y-down).
//
// Output: STAGE ONE VINYL ANIMATION SVG/1.svg … 13.svg
//
// Usage: node build-stage1-svg-from-dxf.mjs

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const DxfParser = require('dxf-parser');

const SRC_DIR = 'STAGE ONE VINYL ANIMATION';
const OUT_DIR = 'STAGE ONE VINYL ANIMATION SVG';
const PAD = 20;           // CAD-unit padding around geometry
const ELLIPSE_SEG = 96;
const ARC_SEG = 64;
const SPLINE_SEG = 48;

// ── entity → sampled polyline points (CAD coords, y-up) ────────────────────
function sampleEllipse(e) {
  const cx = e.center.x, cy = e.center.y;
  const mx = e.majorAxisEndPoint.x, my = e.majorAxisEndPoint.y;
  const majorLen = Math.hypot(mx, my);
  const minorLen = majorLen * e.axisRatio;
  const rot = Math.atan2(my, mx);
  let a0 = e.startAngle ?? 0;
  let a1 = e.endAngle ?? Math.PI * 2;
  let sweep = a1 - a0;
  if (sweep <= 0) sweep += Math.PI * 2;
  const steps = Math.max(8, Math.ceil(ELLIPSE_SEG * sweep / (Math.PI * 2)));
  const cosR = Math.cos(rot), sinR = Math.sin(rot);
  const pts = [];
  for (let i = 0; i <= steps; i++) {
    const t = a0 + sweep * (i / steps);
    const ux = majorLen * Math.cos(t);
    const uy = minorLen * Math.sin(t);
    pts.push([cx + ux * cosR - uy * sinR, cy + ux * sinR + uy * cosR]);
  }
  return pts;
}

function sampleArc(e) {
  const cx = e.center.x, cy = e.center.y;
  const r = e.radius;
  let a0 = e.startAngle, a1 = e.endAngle;
  let sweep = a1 - a0;
  if (sweep <= 0) sweep += Math.PI * 2;
  const steps = Math.max(4, Math.ceil(ARC_SEG * sweep / (Math.PI * 2)));
  const pts = [];
  for (let i = 0; i <= steps; i++) {
    const t = a0 + sweep * (i / steps);
    pts.push([cx + r * Math.cos(t), cy + r * Math.sin(t)]);
  }
  if (e.extrusionDirectionZ === -1) for (const p of pts) p[0] = -p[0];
  return pts;
}

function deBoor(t, deg, cps, knots) {
  const n = cps.length - 1;
  let k = t >= knots[n + 1] ? n : deg;
  while (k < n && t >= knots[k + 1]) k++;
  const d = [];
  for (let j = 0; j <= deg; j++) {
    const idx = k - deg + j;
    d[j] = { x: cps[idx].x, y: cps[idx].y };
  }
  for (let r = 1; r <= deg; r++) {
    for (let j = deg; j >= r; j--) {
      const idx = k - deg + j;
      const denom = knots[idx + deg - r + 1] - knots[idx];
      const alpha = denom === 0 ? 0 : (t - knots[idx]) / denom;
      d[j] = { x: (1 - alpha) * d[j - 1].x + alpha * d[j].x, y: (1 - alpha) * d[j - 1].y + alpha * d[j].y };
    }
  }
  return [d[deg].x, d[deg].y];
}

function sampleSpline(e) {
  const deg = e.degreeOfSplineCurve;
  const cps = e.controlPoints;
  const knots = e.knotValues;
  const n = cps.length;
  const tMin = knots[deg], tMax = knots[n];
  const pts = [];
  for (let i = 0; i <= SPLINE_SEG; i++) {
    const t = tMin + (tMax - tMin) * (i / SPLINE_SEG);
    pts.push(deBoor(t, deg, cps, knots));
  }
  return pts;
}

function entityToPoints(e) {
  if (e.type === 'LINE') return [[e.vertices[0].x, e.vertices[0].y], [e.vertices[1].x, e.vertices[1].y]];
  if (e.type === 'ELLIPSE') return sampleEllipse(e);
  if (e.type === 'ARC') return sampleArc(e);
  if (e.type === 'SPLINE') return sampleSpline(e);
  if (e.type === 'CIRCLE') {
    const pts = [];
    const steps = ELLIPSE_SEG;
    for (let i = 0; i <= steps; i++) {
      const t = (i / steps) * Math.PI * 2;
      pts.push([e.center.x + e.radius * Math.cos(t), e.center.y + e.radius * Math.sin(t)]);
    }
    return pts;
  }
  if (e.type === 'LWPOLYLINE' || e.type === 'POLYLINE') {
    return (e.vertices || []).map((v) => [v.x, v.y]);
  }
  return null;
}

// ── pass 1: read every DXF, sample points, track global bounds ─────────────
const frames = [];
let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

for (let i = 1; i <= 13; i++) {
  const file = path.join(SRC_DIR, `${i}.dxf`);
  if (!fs.existsSync(file)) { console.error(`missing ${file}`); process.exit(1); }
  const dxf = new DxfParser().parseSync(fs.readFileSync(file, 'utf8'));
  const polys = [];
  for (const e of dxf.entities || []) {
    const pts = entityToPoints(e);
    if (!pts || pts.length < 2) continue;
    if (pts.some((p) => !Number.isFinite(p[0]) || !Number.isFinite(p[1]))) continue;
    for (const p of pts) {
      if (p[0] < minX) minX = p[0];
      if (p[1] < minY) minY = p[1];
      if (p[0] > maxX) maxX = p[0];
      if (p[1] > maxY) maxY = p[1];
    }
    polys.push(pts);
  }
  frames.push({ idx: i, polys });
  console.log(`  frame ${i}: ${polys.length} polylines`);
}

console.log(`global bounds x:[${minX.toFixed(1)}, ${maxX.toFixed(1)}] y:[${minY.toFixed(1)}, ${maxY.toFixed(1)}]`);

// Composition: world bounds + padding in CAD units. Flip y via matrix so CAD
// y-up maps to SVG y-down. SVG viewBox is in CAD units too.
const vbW = (maxX - minX) + PAD * 2;
const vbH = (maxY - minY) + PAD * 2;
// matrix(1, 0, 0, -1, tx, ty) with tx = -minX+PAD, ty = maxY+PAD — applied to
// (x,y) gives (x - minX + PAD, -y + maxY + PAD), which is the y-flipped
// translation in CAD units.
const tx = -minX + PAD;
const ty = maxY + PAD;
const matrix = `matrix(1,0,0,-1,${tx.toFixed(4)},${ty.toFixed(4)})`;
const viewBox = `0 0 ${vbW.toFixed(2)} ${vbH.toFixed(2)}`;

// ── pass 2: emit one SVG per frame ────────────────────────────────────────
fs.mkdirSync(OUT_DIR, { recursive: true });
for (const { idx, polys } of frames) {
  const lines = [];
  lines.push(`<?xml version="1.0" encoding="utf-8"?>`);
  lines.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}">`);
  for (const pts of polys) {
    // emit each polyline as a single <path> with the shared matrix transform.
    const d = pts.map(([x, y], i) => (i === 0 ? `M${x.toFixed(4)},${y.toFixed(4)}` : `L${x.toFixed(4)},${y.toFixed(4)}`)).join(' ');
    lines.push(`<path fill="none" transform="${matrix}" d="${d}"/>`);
  }
  lines.push(`</svg>`);
  const out = path.join(OUT_DIR, `${idx}.svg`);
  fs.writeFileSync(out, lines.join('\n'));
}
console.log(`\nWrote ${frames.length} SVGs to ${OUT_DIR}/  (viewBox ${viewBox})`);
