// Text -> outline path. Draws the text on a canvas, extracts the glyph outlines with marching squares
// (sub-pixel accurate, using the anti-aliased alpha), and resamples all contours into one point list.
// Separate contours are joined by "gap" points (b = 1) so the renderer lifts the pen between them.
// Coordinates: x in [-1, 1] across the text, y up; aspect ratio preserved.

export function buildTextPath(str, budget = 1500) {
  str = (str || '').trim().slice(0, 24) || ' ';
  const c = document.createElement('canvas');
  const g = c.getContext('2d', { willReadFrequently: true });
  const font = (s) => `900 ${s}px "Helvetica Neue", Helvetica, Arial, sans-serif`;
  let size = 200;
  g.font = font(size);
  let w = g.measureText(str).width;
  if (w > 1800) { size *= 1800 / w; g.font = font(size); w = g.measureText(str).width; }
  const pad = 12, W = Math.ceil(w) + pad * 2, H = Math.ceil(size * 1.4) + pad * 2;
  c.width = W; c.height = H;
  g.font = font(size); g.textBaseline = 'middle'; g.fillStyle = '#fff';
  g.fillText(str, pad, H / 2);
  const px = g.getImageData(0, 0, W, H).data;
  const val = (x, y) => px[(y * W + x) * 4 + 3];

  // --- marching squares on the alpha channel; vertices live on grid edges ---
  const pos = new Map();                         // edge id -> [x, y]
  const edge = (id) => {
    let p = pos.get(id);
    if (p) return p;
    if ((id & 1) === 0) {                        // horizontal edge (x,y)-(x+1,y)
      const i = id >> 1, y = (i / W) | 0, x = i - y * W, v0 = val(x, y), v1 = val(x + 1, y);
      p = [x + (127.5 - v0) / (v1 - v0), y];
    } else {                                     // vertical edge (x,y)-(x,y+1)
      const i = (id - 1) >> 1, y = (i / W) | 0, x = i - y * W, v0 = val(x, y), v1 = val(x, y + 1);
      p = [x, y + (127.5 - v0) / (v1 - v0)];
    }
    pos.set(id, p);
    return p;
  };
  const adj = new Map();
  const link = (a, b) => {
    (adj.get(a) || adj.set(a, []).get(a)).push(b);
    (adj.get(b) || adj.set(b, []).get(b)).push(a);
  };
  for (let y = 0; y < H - 1; y++) {
    for (let x = 0; x < W - 1; x++) {
      const a = val(x, y) > 127, b = val(x + 1, y) > 127, cc = val(x + 1, y + 1) > 127, d = val(x, y + 1) > 127;
      if (a === b && b === cc && cc === d) continue;
      const T = (y * W + x) * 2, B = ((y + 1) * W + x) * 2, L = (y * W + x) * 2 + 1, R = (y * W + x + 1) * 2 + 1;
      switch ((a << 3) | (b << 2) | (cc << 1) | d) {
        case 1: case 14: link(L, B); break;
        case 2: case 13: link(B, R); break;
        case 3: case 12: link(L, R); break;
        case 4: case 11: link(T, R); break;
        case 5: link(T, L); link(B, R); break;
        case 6: case 9: link(T, B); break;
        case 7: case 8: link(T, L); break;
        case 10: link(T, R); link(L, B); break;
      }
    }
  }
  // --- chain edge vertices into closed loops ---
  const loops = [], seen = new Set();
  for (const start of adj.keys()) {
    if (seen.has(start)) continue;
    const ids = []; let prev = -1, cur = start;
    for (;;) {
      seen.add(cur); ids.push(cur);
      let nxt = -1;
      for (const n of adj.get(cur)) if (n !== prev && !seen.has(n)) { nxt = n; break; }
      if (nxt < 0) break;
      prev = cur; cur = nxt;
    }
    if (ids.length >= 16) loops.push(ids.map(edge));
  }
  if (!loops.length) return { n: 2, x: new Float32Array(2), y: new Float32Array(2), b: new Uint8Array(2) };

  return finalizePath(loops, loops.map(() => true), budget);
}

// Shared by text and SVG import: normalise (centre, width -> [-1, 1], keep aspect, flip y) and resample all polylines
// by arc length into one point list. `closed[i]` says whether polyline i is a closed loop. Gap points (b = 1) lift the pen.
export function finalizePath(loops, closed, budget) {
  const empty = { n: 2, x: new Float32Array(2), y: new Float32Array(2), b: new Uint8Array(2) };
  if (!loops.length) return empty;
  let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
  for (const l of loops) for (const [x, y] of l) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, k = 2 / (Math.max(x1 - x0, (y1 - y0) * 1.2) || 1);
  const polys = loops.map((l, i) => (closed[i] ? [...l, l[0]] : l));
  const cums = polys.map((P) => { const c = [0]; for (let i = 1; i < P.length; i++) c.push(c[i - 1] + Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1])); return c; });
  const total = cums.reduce((s, c) => s + c[c.length - 1], 0) || 1;
  const X = [], Y = [], Bk = [];
  polys.forEach((P, li) => {
    const cum = cums[li], len = cum[cum.length - 1];
    if (P.length < 2 || len <= 0) return;
    const n = Math.max(10, Math.round(budget * len / total));
    let seg = 0;
    for (let j = 0; j <= n; j++) {
      const d = (j / n) * len;
      while (seg < P.length - 2 && cum[seg + 1] < d) seg++;
      const a = P[seg], b = P[seg + 1], span = cum[seg + 1] - cum[seg] || 1, u = Math.min(1, Math.max(0, (d - cum[seg]) / span));
      X.push((a[0] + (b[0] - a[0]) * u - cx) * k); Y.push(-(a[1] + (b[1] - a[1]) * u - cy) * k); Bk.push(0);
    }
    X.push(X[X.length - 1]); Y.push(Y[Y.length - 1]); Bk.push(1);   // gap point: pen up
  });
  if (!X.length) return empty;
  return { n: X.length, x: Float32Array.from(X), y: Float32Array.from(Y), b: Uint8Array.from(Bk) };
}
