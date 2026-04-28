// Converts the SVG frames in STAGE ONE and STAGE TWO VINYL ANIMATION/ into
// Lottie JSON files (white 1px stroke, 24fps, plays once). Both stages share
// the same parser; their SVGs are Adobe Illustrator exports with consistent
// viewBoxes and no per-element transforms.
//
// Earlier Stage Two exports used per-element `transform="matrix(...)"` with
// CAD-scale raw coordinates — the parser still handles that via the matrix
// application below, so the script works for both the old and new export
// styles without branching.

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const svgpath = require('svgpath');

const DEFAULT_FPS = 24;
const STROKE_WIDTH = 0.8;

// Each stage: input folder → output JSON. `pattern` matches the frame files
// and captures the 1-based frame index in group 1.
// Stage 2 is built first so stage 1 can be aligned to it. Stage 2's first
// frame turntable bbox becomes the world-coord reference — stage 1's final
// frame (disc landed) is translated to sit at the exact same world coords,
// and its comp is sized to match stage 2 horizontally with extra height
// above to fit the disc dropping from overhead. Paired with matching CSS
// positioning, this makes the stage 1 → stage 2 handoff visually seamless.
const STAGES = [
  {
    name: 'stage2',
    srcDir: 'STAGE TWO VINYL ANIMATION',
    pattern: /^STAGE TWO\s+\((\d+)\)\.svg$/i,
    out: 'MUSIC-ASSETS/vinyl-lottie-stage2.json',
  },
  {
    name: 'stage1',
    srcDir: 'STAGE ONE VINYL ANIMATION',
    pattern: /^(\d+)\.svg$/i,
    out: 'MUSIC-ASSETS/vinyl-lottie-stage1.json',
    // Source frames 1→33 already go disc-up → disc-on-platter, so forward
    // playback is the natural drop direction. No reverse needed.
    reverse: false,
    subdivide: 0, // Play native 33 frames as authored.
    // Source SVGs have ~0.01–0.3 unit frame-to-frame coord drift on the
    // SAME geometry. Snap collapses near-identical paths to identical
    // comp coords so the static turntable doesn't shimmer between frames.
    snapGrid: 1.0,
    snapAfterAlign: true,
    fr: 60, // 33 native frames at 60fps → ~0.55s drop, persistence-of-vision smooths the step boundaries.
  },
];

// Shared build state so later stages can read earlier stages' metadata.
const stageMeta = {};

const round = (n) => Math.round(n * 100) / 100;

function listFrames(srcDir, pattern) {
  const entries = fs.readdirSync(srcDir);
  const frames = [];
  for (const f of entries) {
    const m = f.match(pattern);
    if (m) frames.push({ idx: parseInt(m[1], 10), file: f });
  }
  return frames.sort((a, b) => a.idx - b.idx);
}

function parseViewBox(src) {
  const m = src.match(/viewBox\s*=\s*["']([^"']+)["']/);
  if (!m) return null;
  const [minX, minY, w, h] = m[1].trim().split(/\s+/).map(Number);
  return { minX, minY, w, h };
}

// Parse "matrix(a,b,c,d,e,f)" → [a,b,c,d,e,f] (SVG transform matrix).
// SVG matrix means point [x,y] → [a*x + c*y + e, b*x + d*y + f].
function parseMatrix(str) {
  if (!str) return [1, 0, 0, 1, 0, 0];
  const m = str.match(/matrix\s*\(\s*([-\d.eE+,\s]+)\s*\)/);
  if (!m) return [1, 0, 0, 1, 0, 0];
  const nums = m[1].split(/[\s,]+/).map(Number).filter(Number.isFinite);
  return nums.length === 6 ? nums : [1, 0, 0, 1, 0, 0];
}

function applyMatrixPoint(M, x, y) {
  const [a, b, c, d, e, f] = M;
  return [a * x + c * y + e, b * x + d * y + f];
}
function applyMatrixVector(M, x, y) {
  // Tangent vectors (relative to vertex) use the linear part only — no translation.
  const [a, b, c, d] = M;
  return [a * x + c * y, b * x + d * y];
}

function emptyPoint(x, y) {
  return { x, y, inX: 0, inY: 0, outX: 0, outY: 0 };
}

function subpathToShape(sub, closed) {
  const v = sub.map((p) => [round(p.x), round(p.y)]);
  const i = sub.map((p) => [round(p.inX), round(p.inY)]);
  const o = sub.map((p) => [round(p.outX), round(p.outY)]);
  return { ty: 'sh', ks: { a: 0, k: { v, i, o, c: closed } } };
}

// Convert a normalized path d-attribute into Lottie shape paths with the given
// transform matrix applied to every coordinate (and to tangents as vectors).
function pathDToShapes(d, M) {
  const shapes = [];
  let cur = null;
  let startX = 0, startY = 0; // start of current subpath (raw, pre-matrix)
  let cx = 0, cy = 0; // current pen position (raw, pre-matrix)

  const xformPoint = (x, y) => applyMatrixPoint(M, x, y);
  const xformVec = (x, y) => applyMatrixVector(M, x, y);

  const closeSub = (closed) => {
    if (cur && cur.length >= 2) {
      if (closed && cur.length > 2) {
        const first = cur[0];
        const last = cur[cur.length - 1];
        if (Math.abs(last.x - first.x) < 1e-6 && Math.abs(last.y - first.y) < 1e-6) {
          first.inX = last.inX;
          first.inY = last.inY;
          cur.pop();
        }
      }
      shapes.push(subpathToShape(cur, !!closed));
    }
    cur = null;
  };

  const normalized = svgpath(d).abs().unarc().unshort();
  normalized.iterate((seg) => {
    const cmd = seg[0];
    if (cmd === 'M') {
      closeSub(false);
      startX = seg[1]; startY = seg[2];
      cx = startX; cy = startY;
      const [tx, ty] = xformPoint(cx, cy);
      cur = [emptyPoint(tx, ty)];
    } else if (cmd === 'L') {
      if (!cur) cur = [emptyPoint(...xformPoint(cx, cy))];
      cx = seg[1]; cy = seg[2];
      cur.push(emptyPoint(...xformPoint(cx, cy)));
    } else if (cmd === 'H') {
      if (!cur) cur = [emptyPoint(...xformPoint(cx, cy))];
      cx = seg[1];
      cur.push(emptyPoint(...xformPoint(cx, cy)));
    } else if (cmd === 'V') {
      if (!cur) cur = [emptyPoint(...xformPoint(cx, cy))];
      cy = seg[1];
      cur.push(emptyPoint(...xformPoint(cx, cy)));
    } else if (cmd === 'C') {
      if (!cur) cur = [emptyPoint(...xformPoint(cx, cy))];
      const [, x1, y1, x2, y2, x, y] = seg;
      const last = cur[cur.length - 1];
      // out-tangent of previous vertex = (c1 - p0), transformed as vector
      const [oX, oY] = xformVec(x1 - cx, y1 - cy);
      last.outX = oX;
      last.outY = oY;
      const [tx, ty] = xformPoint(x, y);
      const [iX, iY] = xformVec(x2 - x, y2 - y);
      cur.push({ x: tx, y: ty, inX: iX, inY: iY, outX: 0, outY: 0 });
      cx = x; cy = y;
    } else if (cmd === 'Q') {
      if (!cur) cur = [emptyPoint(...xformPoint(cx, cy))];
      const [, qx, qy, x, y] = seg;
      const last = cur[cur.length - 1];
      // Convert quad→cubic: C1 = P0 + 2/3*(Q-P0), C2 = P2 + 2/3*(Q-P2)
      const c1x = cx + (2 / 3) * (qx - cx);
      const c1y = cy + (2 / 3) * (qy - cy);
      const c2x = x + (2 / 3) * (qx - x);
      const c2y = y + (2 / 3) * (qy - y);
      const [oX, oY] = xformVec(c1x - cx, c1y - cy);
      last.outX = oX;
      last.outY = oY;
      const [tx, ty] = xformPoint(x, y);
      const [iX, iY] = xformVec(c2x - x, c2y - y);
      cur.push({ x: tx, y: ty, inX: iX, inY: iY, outX: 0, outY: 0 });
      cx = x; cy = y;
    } else if (cmd === 'Z' || cmd === 'z') {
      if (cur && cur.length) {
        if (Math.abs(cx - startX) > 1e-6 || Math.abs(cy - startY) > 1e-6) {
          cur.push(emptyPoint(...xformPoint(startX, startY)));
        }
        closeSub(true);
        cx = startX; cy = startY;
      }
    }
  });
  closeSub(false);
  return shapes;
}

// Axis-aligned ellipse → 4 cubic béziers (closed). Transform is applied to
// each vertex (as point) and to each tangent (as vector).
const KAPPA = 0.5522847498307936;
function ellipseToShape(cx, cy, rx, ry, M) {
  const kx = KAPPA * rx;
  const ky = KAPPA * ry;
  const raw = [
    { x: cx + rx, y: cy,      inX: 0,   inY: -ky, outX: 0,   outY: ky },
    { x: cx,      y: cy + ry, inX: kx,  inY: 0,   outX: -kx, outY: 0 },
    { x: cx - rx, y: cy,      inX: 0,   inY: ky,  outX: 0,   outY: -ky },
    { x: cx,      y: cy - ry, inX: -kx, inY: 0,   outX: kx,  outY: 0 },
  ];
  const transformed = raw.map((p) => {
    const [tx, ty] = applyMatrixPoint(M, p.x, p.y);
    const [iX, iY] = applyMatrixVector(M, p.inX, p.inY);
    const [oX, oY] = applyMatrixVector(M, p.outX, p.outY);
    return { x: tx, y: ty, inX: iX, inY: iY, outX: oX, outY: oY };
  });
  return subpathToShape(transformed, true);
}

function attrs(tag) {
  const out = {};
  const re = /([a-zA-Z_:][\w:.-]*)\s*=\s*"([^"]*)"/g;
  let m;
  while ((m = re.exec(tag))) out[m[1]] = m[2];
  return out;
}

function svgToShapes(src) {
  const viewBox = parseViewBox(src);
  const shapes = [];
  const tagRe = /<(path|line|polyline|ellipse|circle)\b([^>]*)\/?>/g;
  let m;
  while ((m = tagRe.exec(src))) {
    const tag = m[1];
    const a = attrs(m[0]);
    const M = parseMatrix(a.transform);
    if (tag === 'path' && a.d) {
      try {
        shapes.push(...pathDToShapes(a.d, M));
      } catch (err) {
        console.warn('path parse fail:', err.message);
      }
    } else if (tag === 'line') {
      const x1 = parseFloat(a.x1), y1 = parseFloat(a.y1);
      const x2 = parseFloat(a.x2), y2 = parseFloat(a.y2);
      if ([x1, y1, x2, y2].every(Number.isFinite)) {
        const [tx1, ty1] = applyMatrixPoint(M, x1, y1);
        const [tx2, ty2] = applyMatrixPoint(M, x2, y2);
        shapes.push(subpathToShape([emptyPoint(tx1, ty1), emptyPoint(tx2, ty2)], false));
      }
    } else if (tag === 'polyline') {
      const nums = (a.points || '').trim().split(/[\s,]+/).map(Number).filter(Number.isFinite);
      const pts = [];
      for (let k = 0; k + 1 < nums.length; k += 2) {
        const [tx, ty] = applyMatrixPoint(M, nums[k], nums[k + 1]);
        pts.push(emptyPoint(tx, ty));
      }
      if (pts.length >= 2) shapes.push(subpathToShape(pts, false));
    } else if (tag === 'ellipse') {
      const cx = parseFloat(a.cx), cy = parseFloat(a.cy);
      const rx = parseFloat(a.rx), ry = parseFloat(a.ry);
      if ([cx, cy, rx, ry].every(Number.isFinite) && rx > 0 && ry > 0) {
        shapes.push(ellipseToShape(cx, cy, rx, ry, M));
      }
    } else if (tag === 'circle') {
      const cx = parseFloat(a.cx), cy = parseFloat(a.cy);
      const r = parseFloat(a.r);
      if ([cx, cy, r].every(Number.isFinite) && r > 0) {
        shapes.push(ellipseToShape(cx, cy, r, r, M));
      }
    }
  }
  return { shapes, viewBox };
}

// Linear interpolate between two frames' shape arrays. Shapes at the same
// index with matching vertex count lerp smoothly; anything else falls back
// to the A-frame shape (the small unmatched portion just "holds" for this
// sub-frame, which is invisible in practice).
//
// Safety check — Illustrator re-exports can add/drop geometry between frames
// (e.g. 32 → 30 ellipses) so shape[i] in A and shape[i] in B sometimes have
// matching vertex counts but represent entirely different elements. Blindly
// lerping those produces "warp": the disc collapses because its ellipse is
// being lerped with some unrelated shape on the turntable body. If the first
// vertex of A and B are too far apart to plausibly be the same element,
// skip the lerp and hold A's shape.
// Consider two shapes "the same element" only if every vertex pair is within
// this distance AND their bounding-box extents are close in size. 60 CAD units
// ~= 2.8% of the 2160-unit viewBox, wider than frame-to-frame motion of any
// single element but tight enough to catch identity swaps between the big disc
// ellipse and small detail ellipses.
const MAX_VERTEX_DRIFT = 60;
const MAX_BBOX_SIZE_RATIO = 1.6;
function shapesMatch(sa, sb) {
  const va = sa.ks.k.v, vb = sb.ks.k.v;
  let aMinX = Infinity, aMaxX = -Infinity, aMinY = Infinity, aMaxY = -Infinity;
  let bMinX = Infinity, bMaxX = -Infinity, bMinY = Infinity, bMaxY = -Infinity;
  for (let k = 0; k < va.length; k++) {
    const dx = va[k][0] - vb[k][0];
    const dy = va[k][1] - vb[k][1];
    if (dx * dx + dy * dy > MAX_VERTEX_DRIFT * MAX_VERTEX_DRIFT) return false;
    if (va[k][0] < aMinX) aMinX = va[k][0]; if (va[k][0] > aMaxX) aMaxX = va[k][0];
    if (va[k][1] < aMinY) aMinY = va[k][1]; if (va[k][1] > aMaxY) aMaxY = va[k][1];
    if (vb[k][0] < bMinX) bMinX = vb[k][0]; if (vb[k][0] > bMaxX) bMaxX = vb[k][0];
    if (vb[k][1] < bMinY) bMinY = vb[k][1]; if (vb[k][1] > bMaxY) bMaxY = vb[k][1];
  }
  const aw = aMaxX - aMinX, ah = aMaxY - aMinY;
  const bw = bMaxX - bMinX, bh = bMaxY - bMinY;
  if (aw > 1 && bw > 1 && (Math.max(aw, bw) / Math.min(aw, bw)) > MAX_BBOX_SIZE_RATIO) return false;
  if (ah > 1 && bh > 1 && (Math.max(ah, bh) / Math.min(ah, bh)) > MAX_BBOX_SIZE_RATIO) return false;
  return true;
}
function lerpFrameShapes(a, b, t) {
  const out = [];
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const sa = a[i], sb = b[i];
    if (!sa?.ks?.k?.v || !sb?.ks?.k?.v || sa.ks.k.v.length !== sb.ks.k.v.length) {
      out.push(sa);
      continue;
    }
    if (!shapesMatch(sa, sb)) {
      out.push(sa);
      continue;
    }
    const lerped = JSON.parse(JSON.stringify(sa));
    for (let j = 0; j < sa.ks.k.v.length; j++) {
      lerped.ks.k.v[j][0] = round(sa.ks.k.v[j][0] * (1 - t) + sb.ks.k.v[j][0] * t);
      lerped.ks.k.v[j][1] = round(sa.ks.k.v[j][1] * (1 - t) + sb.ks.k.v[j][1] * t);
      lerped.ks.k.i[j][0] = round(sa.ks.k.i[j][0] * (1 - t) + sb.ks.k.i[j][0] * t);
      lerped.ks.k.i[j][1] = round(sa.ks.k.i[j][1] * (1 - t) + sb.ks.k.i[j][1] * t);
      lerped.ks.k.o[j][0] = round(sa.ks.k.o[j][0] * (1 - t) + sb.ks.k.o[j][0] * t);
      lerped.ks.k.o[j][1] = round(sa.ks.k.o[j][1] * (1 - t) + sb.ks.k.o[j][1] * t);
    }
    out.push(lerped);
  }
  for (let i = n; i < a.length; i++) out.push(a[i]);
  return out;
}

// Compute axis-aligned bounding box of all vertices across a frame's shapes.
function shapesBBox(shapes) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const s of shapes) {
    const v = s?.ks?.k?.v;
    if (!v) continue;
    for (const [x, y] of v) {
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
    }
  }
  return { minX, minY, maxX, maxY };
}

function buildStage(stage) {
  console.log(`\n── ${stage.name} ── reading ${stage.srcDir}`);
  const frameList = listFrames(stage.srcDir, stage.pattern);
  if (!frameList.length) {
    console.error(`  No SVG frames found in ${stage.srcDir}`);
    return;
  }
  console.log(`  Found ${frameList.length} frame SVGs`);

  const frameShapes = [];
  const frameViewBoxes = [];
  for (const { idx, file } of frameList) {
    const src = fs.readFileSync(path.join(stage.srcDir, file), 'utf8');
    const { shapes, viewBox } = svgToShapes(src);
    if (!viewBox) { console.error(`  Frame ${idx} (${file}) has no viewBox`); process.exit(1); }
    frameShapes.push(shapes);
    frameViewBoxes.push(viewBox);
  }

  if (stage.reverse) {
    console.log('  reversing frame order (source is numbered backwards)');
    frameShapes.reverse();
    frameViewBoxes.reverse();
  }

  if (stage.snapGrid && stage.snapGrid > 0 && !stage.snapAfterAlign) {
    const g = stage.snapGrid;
    const snap = (n) => Math.round(n / g) * g;
    let touched = 0;
    for (const shapes of frameShapes) {
      for (const s of shapes) {
        const v = s?.ks?.k?.v, i = s?.ks?.k?.i, o = s?.ks?.k?.o;
        if (!v) continue;
        for (let k = 0; k < v.length; k++) {
          v[k][0] = snap(v[k][0]);
          v[k][1] = snap(v[k][1]);
          if (i && i[k]) { i[k][0] = snap(i[k][0]); i[k][1] = snap(i[k][1]); }
          if (o && o[k]) { o[k][0] = snap(o[k][0]); o[k][1] = snap(o[k][1]); }
          touched++;
        }
      }
    }
    console.log(`  snapped ${touched} vertices to ${g}-unit grid (pre-align)`);
  }

  // Replace a contiguous run of native frames with interpolated frames built
  // from the two frames bracketing the run. Stage 1 uses this to hide the
  // "detail flicker" caused by Illustrator exporting frames 11-20 with a
  // completely different path encoding (~360 fewer stroked paths) than
  // frames 1-10 and 21-33. Since the bracketing frames (10 and 21) share the
  // same export style, shape identity is stable between them and the lerp
  // is clean.
  if (stage.replaceRange) {
    const { startIdx, endIdx } = stage.replaceRange; // inclusive, 0-based
    const before = frameShapes[startIdx - 1];
    const after = frameShapes[endIdx + 1];
    const N = endIdx - startIdx + 1;
    const replaced = [];
    for (let k = 1; k <= N; k++) {
      const t = k / (N + 1);
      replaced.push(lerpFrameShapes(before, after, t));
    }
    frameShapes.splice(startIdx, N, ...replaced);
    frameViewBoxes.splice(startIdx, N, ...Array(N).fill(frameViewBoxes[startIdx - 1]));
    console.log(`  replaced native frames [${startIdx}..${endIdx}] with ${N} lerp frames between ${startIdx - 1} and ${endIdx + 1}`);
  }

  if (stage.subdivide && stage.subdivide > 0) {
    const N = stage.subdivide;
    const skip = new Set(stage.noSubdivideAcross || []);
    const expanded = [frameShapes[0]];
    for (let i = 0; i < frameShapes.length - 1; i++) {
      const a = frameShapes[i];
      const b = frameShapes[i + 1];
      const steps = skip.has(i) ? 0 : N;
      for (let k = 1; k <= steps; k++) {
        const t = k / (steps + 1);
        expanded.push(lerpFrameShapes(a, b, t));
      }
      expanded.push(b);
    }
    console.log(`  subdividing — ${N} interp frames between each pair (skipping at ${[...skip].join(',') || 'none'}): ${frameShapes.length} → ${expanded.length}`);
    frameShapes.length = 0;
    frameShapes.push(...expanded);
  }

  const ref = frameViewBoxes[0];
  const sameVB = frameViewBoxes.every((vb) => vb.w === ref.w && vb.h === ref.h && vb.minX === ref.minX && vb.minY === ref.minY);
  if (!sameVB) console.warn(`  WARNING: ${stage.name} frame viewBoxes differ — alignment may jitter`);

  let COMP_W = Math.round(ref.w);
  let COMP_H = Math.round(ref.h);
  let shiftX = -ref.minX;
  let shiftY = -ref.minY;
  let scaleX = 1, scaleY = 1;

  // Alignment: translate + scale this stage's last-frame turntable so it
  // exactly overlays the target stage's first-frame turntable (both corners
  // of the bbox match). Adds top padding so the overhead disc still fits
  // above the turntable. Both corners must match — matching just the
  // top-left leaves sub-pixel drift at the bottom-right that reads as
  // jitter when Lottie swaps layers.
  if (stage.alignLastFrameTo) {
    const target = stageMeta[stage.alignLastFrameTo];
    if (!target) {
      console.error(`  align target "${stage.alignLastFrameTo}" not yet built`);
    } else {
      const lastBB = shapesBBox(frameShapes[frameShapes.length - 1]);
      const firstBB = shapesBBox(frameShapes[0]);
      const targetW = target.firstBB.maxX - target.firstBB.minX;
      const targetH = target.firstBB.maxY - target.firstBB.minY;
      const lastW = lastBB.maxX - lastBB.minX;
      const lastH = lastBB.maxY - lastBB.minY;
      scaleX = targetW / lastW;
      scaleY = targetH / lastH;
      // After scaling by (scaleX, scaleY) about the origin, vertex (x, y)
      // lands at (scaleX*x + dx, scaleY*y + dy). Solve dx so lastBB.minX
      // maps to target.firstBB.minX (top padding adds to dy below).
      const dx = target.firstBB.minX - scaleX * lastBB.minX;
      const dyToTarget = target.firstBB.minY - scaleY * lastBB.minY;
      const firstNewMinY = scaleY * firstBB.minY + dyToTarget;
      const topPadding = Math.max(0, Math.ceil(target.firstBB.minY - firstNewMinY));
      const dy = dyToTarget + topPadding;
      COMP_W = target.w;
      COMP_H = target.h + topPadding;
      shiftX = dx;
      shiftY = dy;
      console.log(`  aligning to ${stage.alignLastFrameTo}: dx=${round(dx)} dy=${round(dy)} scale=(${round(scaleX * 1000) / 1000}, ${round(scaleY * 1000) / 1000}) topPadding=${topPadding} → comp ${COMP_W}×${COMP_H}`);
    }
  }

  console.log(`  composition: ${COMP_W}×${COMP_H}  (consistent: ${sameVB})`);

  // Optionally bake the alignment transform into the vertex coords and snap
  // the result to a pixel grid. With separate Illustrator exports re-emitting
  // the same geometry at sub-pixel offsets each frame, baking + snapping
  // collapses near-identical paths to identical comp coords so the static
  // turntable doesn't shimmer across frames.
  let bakeIntoVerts = false;
  if (stage.snapGrid && stage.snapGrid > 0 && stage.snapAfterAlign) {
    const g = stage.snapGrid;
    const snap = (n) => Math.round(n / g) * g;
    let touched = 0;
    for (const shapes of frameShapes) {
      for (const s of shapes) {
        const v = s?.ks?.k?.v, ii = s?.ks?.k?.i, oo = s?.ks?.k?.o;
        if (!v) continue;
        for (let k = 0; k < v.length; k++) {
          v[k][0] = snap(scaleX * v[k][0] + shiftX);
          v[k][1] = snap(scaleY * v[k][1] + shiftY);
          if (ii && ii[k]) { ii[k][0] = snap(scaleX * ii[k][0]); ii[k][1] = snap(scaleY * ii[k][1]); }
          if (oo && oo[k]) { oo[k][0] = snap(scaleX * oo[k][0]); oo[k][1] = snap(scaleY * oo[k][1]); }
          touched++;
        }
      }
    }
    bakeIntoVerts = true;
    console.log(`  baked alignment + snapped ${touched} vertices to ${g}-unit comp grid`);
  }

  const layerShiftX = bakeIntoVerts ? 0 : shiftX;
  const layerShiftY = bakeIntoVerts ? 0 : shiftY;
  const layerScaleX = bakeIntoVerts ? 1 : scaleX;
  const layerScaleY = bakeIntoVerts ? 1 : scaleY;

  const layers = frameShapes.map((shapes, i) => {
    const items = [...shapes];
    items.push({
      ty: 'st',
      c: { a: 0, k: [1, 1, 1, 1] },
      o: { a: 0, k: 100 },
      w: { a: 0, k: STROKE_WIDTH },
      lc: 2, lj: 2,
    });
    items.push({
      ty: 'tr',
      p: { a: 0, k: [layerShiftX, layerShiftY] },
      a: { a: 0, k: [0, 0] },
      s: { a: 0, k: [layerScaleX * 100, layerScaleY * 100] },
      r: { a: 0, k: 0 },
      o: { a: 0, k: 100 },
    });
    return {
      ddd: 0,
      ind: i + 1,
      ty: 4,
      nm: `frame ${i + 1}`,
      sr: 1,
      ks: {
        p: { a: 0, k: [0, 0, 0] },
        a: { a: 0, k: [0, 0, 0] },
        s: { a: 0, k: [100, 100, 100] },
        r: { a: 0, k: 0 },
        o: { a: 0, k: 100 },
      },
      ao: 0,
      ip: i,
      op: i + 1,
      st: 0,
      bm: 0,
      shapes: [{ ty: 'gr', it: items, nm: `g${i + 1}` }],
    };
  });

  const animation = {
    v: '5.7.14',
    fr: stage.fr || DEFAULT_FPS,
    ip: 0,
    op: frameShapes.length,
    w: COMP_W,
    h: COMP_H,
    nm: stage.name,
    ddd: 0,
    assets: [],
    layers,
  };

  fs.mkdirSync(path.dirname(stage.out), { recursive: true });
  fs.writeFileSync(stage.out, JSON.stringify(animation));
  const bytes = fs.statSync(stage.out).size;
  console.log(`  wrote ${stage.out} (${(bytes / 1024).toFixed(1)} KB, ${layers.length} layers)`);

  // Record metadata so later stages can align to this one. bboxes are in
  // world coords AFTER this stage's shiftX/shiftY have been applied — i.e.
  // the on-screen coords inside the emitted comp.
  const firstBBraw = shapesBBox(frameShapes[0]);
  const lastBBraw = shapesBBox(frameShapes[frameShapes.length - 1]);
  // If alignment was baked into vertex coords, the bbox we just measured is
  // already in comp coords; otherwise apply the layer transform to get there.
  const sx = bakeIntoVerts ? 1 : scaleX;
  const sy = bakeIntoVerts ? 1 : scaleY;
  const tx = bakeIntoVerts ? 0 : shiftX;
  const ty = bakeIntoVerts ? 0 : shiftY;
  stageMeta[stage.name] = {
    w: COMP_W,
    h: COMP_H,
    shiftX,
    shiftY,
    scaleX,
    scaleY,
    firstBB: { minX: sx * firstBBraw.minX + tx, minY: sy * firstBBraw.minY + ty, maxX: sx * firstBBraw.maxX + tx, maxY: sy * firstBBraw.maxY + ty },
    lastBB:  { minX: sx * lastBBraw.minX  + tx, minY: sy * lastBBraw.minY  + ty, maxX: sx * lastBBraw.maxX  + tx, maxY: sy * lastBBraw.maxY  + ty },
  };
}

for (const stage of STAGES) buildStage(stage);
