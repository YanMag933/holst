window.Cutout = (function () {
  function labFromRgb(r, g, b) {
    return ColorKit.rgbToLab(r, g, b);
  }

  function dist2(a, b) {
    const dL = a.L - b.L, da = a.a - b.a, db = a.b - b.b;
    return dL * dL + da * da + db * db;
  }

  function morph(mask, w, h, dilate) {
    const out = new Uint8Array(mask.length);
    const r = dilate ? 1 : 1;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let on = 0;
        for (let dy = -r; dy <= r; dy++) {
          for (let dx = -r; dx <= r; dx++) {
            const xx = x + dx, yy = y + dy;
            if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
            if (mask[yy * w + xx]) on = 1;
          }
        }
        if (dilate) out[y * w + x] = on;
        else {
          let all = 1;
          for (let dy = -r; dy <= r && all; dy++) {
            for (let dx = -r; dx <= r; dx++) {
              const xx = x + dx, yy = y + dy;
              if (xx < 0 || yy < 0 || xx >= w || yy >= h) { all = 0; break; }
              if (!mask[yy * w + xx]) { all = 0; break; }
            }
          }
          out[y * w + x] = all;
        }
      }
    }
    return out;
  }

  function fillHoles(mask, w, h) {
    const bg = new Uint8Array(w * h);
    const q = [];
    function push(x, y) {
      const i = y * w + x;
      if (bg[i] || mask[i]) return;
      bg[i] = 1;
      q.push(i);
    }
    for (let x = 0; x < w; x++) { push(x, 0); push(x, h - 1); }
    for (let y = 0; y < h; y++) { push(0, y); push(w - 1, y); }
    for (let n = 0; n < q.length; n++) {
      const i = q[n];
      const x = i % w, y = (i - x) / w;
      if (x > 0) push(x - 1, y);
      if (x + 1 < w) push(x + 1, y);
      if (y > 0) push(x, y - 1);
      if (y + 1 < h) push(x, y + 1);
    }
    const out = new Uint8Array(w * h);
    for (let i = 0; i < out.length; i++) out[i] = bg[i] ? 0 : 1;
    return out;
  }

  function feather(mask, w, h, px) {
    const dist = new Float32Array(w * h);
    dist.fill(1e6);
    const q = [];
    for (let i = 0; i < mask.length; i++) {
      if (!mask[i]) continue;
      const x = i % w, y = (i - x) / w;
      let edge = x === 0 || y === 0 || x === w - 1 || y === h - 1;
      if (!edge) {
        if (!mask[i - 1] || !mask[i + 1] || !mask[i - w] || !mask[i + w]) edge = true;
      }
      if (edge) {
        dist[i] = 0;
        q.push(i);
      }
    }
    for (let n = 0; n < q.length; n++) {
      const i = q[n];
      const x = i % w, y = (i - x) / w;
      const nd = dist[i] + 1;
      const neigh = [i - 1, i + 1, i - w, i + w];
      for (const j of neigh) {
        if (j < 0 || j >= mask.length) continue;
        if (!mask[j]) continue;
        if (dist[j] > nd) {
          dist[j] = nd;
          q.push(j);
        }
      }
    }
    const alpha = new Uint8Array(w * h);
    const f = Math.max(1, px);
    for (let i = 0; i < mask.length; i++) {
      if (!mask[i]) continue;
      alpha[i] = Math.round(255 * Math.min(1, dist[i] / f));
    }
    return alpha;
  }

  async function extract(image, scribbleCanvas, opts) {
    const maxW = (opts && opts.maxW) || 720;
    const scale = Math.min(1, maxW / Math.max(image.naturalWidth || image.width, 1));
    const w = Math.max(2, Math.round((image.naturalWidth || image.width) * scale));
    const h = Math.max(2, Math.round((image.naturalHeight || image.height) * scale));

    const src = document.createElement("canvas");
    src.width = w;
    src.height = h;
    const sctx = src.getContext("2d", { willReadFrequently: true });
    sctx.drawImage(image, 0, 0, w, h);
    const srcData = sctx.getImageData(0, 0, w, h);
    const scrData = (function () {
      const c = document.createElement("canvas");
      c.width = w;
      c.height = h;
      const x = c.getContext("2d", { willReadFrequently: true });
      x.drawImage(scribbleCanvas, 0, 0, w, h);
      return x.getImageData(0, 0, w, h);
    })();

    const seeds = [];
    const seedLabs = [];
    for (let i = 0; i < w * h; i++) {
      if (scrData.data[i * 4 + 3] > 40) {
        seeds.push(i);
        seedLabs.push(
          labFromRgb(srcData.data[i * 4], srcData.data[i * 4 + 1], srcData.data[i * 4 + 2])
        );
      }
    }
    if (seeds.length < 8) {
      throw new Error("Закрась предмет плотнее — маркером по самому объекту, не по фону.");
    }

    const samples = [];
    const step = Math.max(1, Math.floor(seedLabs.length / 80));
    for (let i = 0; i < seedLabs.length; i += step) samples.push(seedLabs[i]);

    let thresh = 22;
    let spread = 0;
    for (const lab of samples) {
      let md = 1e9;
      for (const o of samples) {
        const d = Math.sqrt(dist2(lab, o));
        if (d && d < md) md = d;
      }
      if (md < 1e8) spread += md;
    }
    spread /= samples.length || 1;
    thresh = Math.max(16, Math.min(34, 16 + spread * 0.8));

    const mask = new Uint8Array(w * h);
    const q = seeds.slice();
    for (const i of seeds) mask[i] = 1;

    const T2 = thresh * thresh;
    while (q.length) {
      const i = q.pop();
      const x = i % w, y = (i - x) / w;
      const neigh = [i - 1, i + 1, i - w, i + w];
      for (const j of neigh) {
        if (j < 0 || j >= mask.length) continue;
        if (mask[j]) continue;
        const jx = j % w;
        if (Math.abs(jx - x) + Math.abs(((j - jx) / w) - y) > 2) continue;
        if (j % w === 0 && i % w === w - 1) continue;
        if (i % w === 0 && j % w === w - 1) continue;
        const lab = labFromRgb(srcData.data[j * 4], srcData.data[j * 4 + 1], srcData.data[j * 4 + 2]);
        let ok = false;
        for (const s of samples) {
          if (dist2(lab, s) <= T2) { ok = true; break; }
        }
        if (ok) {
          mask[j] = 1;
          q.push(j);
        }
      }
    }

    let m = morph(mask, w, h, true);
    m = morph(m, w, h, false);
    m = morph(m, w, h, true);
    m = fillHoles(m, w, h);

    let minX = w, minY = h, maxX = 0, maxY = 0, count = 0;
    for (let i = 0; i < m.length; i++) {
      if (!m[i]) continue;
      count++;
      const x = i % w, y = (i - x) / w;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
    if (count < 40) throw new Error("Слишком мало пикселей. Обведи предмет щедрее.");

    const alpha = feather(m, w, h, 2);
    const pad = 4;
    minX = Math.max(0, minX - pad);
    minY = Math.max(0, minY - pad);
    maxX = Math.min(w - 1, maxX + pad);
    maxY = Math.min(h - 1, maxY + pad);
    const cw = maxX - minX + 1;
    const ch = maxY - minY + 1;

    const fullW = image.naturalWidth || image.width;
    const fullH = image.naturalHeight || image.height;
    const out = document.createElement("canvas");
    out.width = Math.round((cw / w) * fullW);
    out.height = Math.round((ch / h) * fullH);
    const octx = out.getContext("2d");
    octx.drawImage(
      image,
      (minX / w) * fullW,
      (minY / h) * fullH,
      (cw / w) * fullW,
      (ch / h) * fullH,
      0,
      0,
      out.width,
      out.height
    );
    const img = octx.getImageData(0, 0, out.width, out.height);
    for (let y = 0; y < out.height; y++) {
      for (let x = 0; x < out.width; x++) {
        const mx = minX + (x / out.width) * cw;
        const my = minY + (y / out.height) * ch;
        const mi = Math.round(my) * w + Math.round(mx);
        const a = alpha[mi] || 0;
        img.data[(y * out.width + x) * 4 + 3] = a;
      }
    }
    octx.putImageData(img, 0, 0);

    const blob = await new Promise((res) => out.toBlob(res, "image/png"));
    return { blob, width: out.width, height: out.height, preview: out.toDataURL("image/png") };
  }

  return { extract };
})();
