window.Cutout = (function () {
  let nn = null;
  let nnPromise = null;

  function countOn(mask) {
    let n = 0;
    for (let i = 0; i < mask.length; i++) if (mask[i]) n++;
    return n;
  }

  function bboxOf(mask, w, h, pad) {
    let minX = w, minY = h, maxX = 0, maxY = 0, n = 0;
    for (let i = 0; i < mask.length; i++) {
      if (!mask[i]) continue;
      n++;
      const x = i % w, y = (i - x) / w;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
    minX = Math.max(0, minX - pad);
    minY = Math.max(0, minY - pad);
    maxX = Math.min(w - 1, maxX + pad);
    maxY = Math.min(h - 1, maxY + pad);
    return { minX, minY, maxX, maxY, n };
  }

  function keepTouchingScribble(mask, scribble, w, h) {
    const seen = new Uint8Array(mask.length);
    const out = new Uint8Array(mask.length);
    const q = [];
    for (let i = 0; i < mask.length; i++) {
      if (mask[i] && scribble[i]) { q.push(i); seen[i] = 1; out[i] = 1; }
    }
    for (let n = 0; n < q.length; n++) {
      const i = q[n];
      const x = i % w;
      const neigh = [i - 1, i + 1, i - w, i + w];
      for (const j of neigh) {
        if (j < 0 || j >= mask.length || seen[j]) continue;
        if (x === 0 && j === i - 1) continue;
        if (x === w - 1 && j === i + 1) continue;
        if (!mask[j]) continue;
        seen[j] = 1;
        out[j] = 1;
        q.push(j);
      }
    }
    return out;
  }

  function fillHoles(mask, w, h, box) {
    const seen = new Uint8Array(mask.length);
    const q = [];
    const push = (i) => {
      if (i < 0 || i >= mask.length || seen[i] || mask[i]) return;
      seen[i] = 1;
      q.push(i);
    };
    for (let x = box.minX; x <= box.maxX; x++) {
      push(box.minY * w + x);
      push(box.maxY * w + x);
    }
    for (let y = box.minY; y <= box.maxY; y++) {
      push(y * w + box.minX);
      push(y * w + box.maxX);
    }
    for (let n = 0; n < q.length; n++) {
      const i = q[n];
      const x = i % w;
      if (x > box.minX) push(i - 1);
      if (x < box.maxX) push(i + 1);
      if (i - w >= box.minY * w) push(i - w);
      if (i + w < (box.maxY + 1) * w) push(i + w);
    }
    for (let y = box.minY; y <= box.maxY; y++) {
      for (let x = box.minX; x <= box.maxX; x++) {
        const i = y * w + x;
        if (!mask[i] && !seen[i]) mask[i] = 1;
      }
    }
    return mask;
  }

  function feather(mask, w, h, px) {
    const dist = new Float32Array(w * h);
    dist.fill(1e6);
    const q = [];
    for (let i = 0; i < mask.length; i++) {
      if (!mask[i]) continue;
      const x = i % w, y = (i - x) / w;
      let edge = x === 0 || y === 0 || x === w - 1 || y === h - 1;
      if (!edge && (!mask[i - 1] || !mask[i + 1] || !mask[i - w] || !mask[i + w])) edge = true;
      if (edge) { dist[i] = 0; q.push(i); }
    }
    for (let n = 0; n < q.length; n++) {
      const i = q[n];
      const nd = dist[i] + 1;
      const x = i % w;
      const neigh = [i - 1, i + 1, i - w, i + w];
      for (const j of neigh) {
        if (j < 0 || j >= mask.length) continue;
        if (x === 0 && j === i - 1) continue;
        if (x === w - 1 && j === i + 1) continue;
        if (!mask[j]) continue;
        if (dist[j] > nd) { dist[j] = nd; q.push(j); }
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

  function scribblePoints(scribble, w, h, maxPts) {
    const pts = [];
    let sx = 0, sy = 0, n = 0;
    const total = countOn(scribble);
    const step = Math.max(1, Math.floor(total / 16));
    for (let i = 0; i < scribble.length; i++) {
      if (!scribble[i]) continue;
      const x = i % w, y = (i - x) / w;
      sx += x; sy += y; n++;
      if (n % step === 0) pts.push({ x: x / w, y: y / h });
    }
    if (!n) return [];
    pts.unshift({ x: sx / n / w, y: sy / n / h });
    return pts.slice(0, maxPts || 8);
  }

  function copyMaskSync(result) {
    if (!result) return null;
    const confs = result.confidenceMasks;
    const cat = result.categoryMask;
    let src, sw, sh, kind;
    try {
      if (confs && confs[0]) {
        const m = confs[0];
        sw = m.width; sh = m.height;
        if (m.getAsFloat32Array) {
          src = Float32Array.from(m.getAsFloat32Array());
          kind = "f";
        } else {
          src = Uint8Array.from(m.getAsUint8Array());
          kind = "u";
        }
      } else if (cat) {
        src = Uint8Array.from(cat.getAsUint8Array());
        sw = cat.width; sh = cat.height;
        kind = "c";
      } else {
        return null;
      }
    } finally {
      try { if (cat && cat.close) cat.close(); } catch (e) {}
      try { if (confs) confs.forEach((m) => m.close && m.close()); } catch (e) {}
    }
    return { src, sw, sh, kind };
  }

  function packedToMask(packed, w, h, invert) {
    if (!packed) return null;
    const { src, sw, sh, kind } = packed;
    const out = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const sx = Math.min(sw - 1, Math.round((x / w) * sw));
        const sy = Math.min(sh - 1, Math.round((y / h) * sh));
        const v = src[sy * sw + sx];
        let on = kind === "f" ? v > 0.5 : v > 0;
        if (invert) on = !on;
        if (on) out[y * w + x] = 1;
      }
    }
    return out;
  }

  function invertMask(mask) {
    const out = new Uint8Array(mask.length);
    for (let i = 0; i < mask.length; i++) out[i] = mask[i] ? 0 : 1;
    return out;
  }

  function clampToNeighborhood(mask, scribble, w, h) {
    const box = bboxOf(scribble, w, h, 0);
    const bw = Math.max(1, box.maxX - box.minX + 1);
    const bh = Math.max(1, box.maxY - box.minY + 1);
    const pad = Math.max(24, Math.round(0.9 * Math.max(bw, bh)), Math.round(0.12 * Math.min(w, h)));
    const minX = Math.max(0, box.minX - pad);
    const minY = Math.max(0, box.minY - pad);
    const maxX = Math.min(w - 1, box.maxX + pad);
    const maxY = Math.min(h - 1, box.maxY + pad);
    const out = new Uint8Array(mask.length);
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const i = y * w + x;
        if (mask[i]) out[i] = 1;
      }
    }
    return out;
  }

  function scoreMask(mask, scribble, w, h) {
    let inter = 0, scribN = 0, maskN = 0;
    for (let i = 0; i < mask.length; i++) {
      if (scribble[i]) scribN++;
      if (mask[i]) {
        maskN++;
        if (scribble[i]) inter++;
      }
    }
    if (!scribN || !maskN) return 0;
    const coverage = inter / scribN;
    const areaRatio = maskN / scribN;
    if (coverage < 0.4) return 0;
    if (maskN / (w * h) > 0.55) return 0;
    if (areaRatio > 28) return 0;
    return coverage * coverage / Math.sqrt(Math.max(1, areaRatio));
  }

  function runSegment(seg, image, roi) {
    return new Promise((resolve, reject) => {
      let done = false;
      const finish = (result) => {
        if (done) return;
        done = true;
        try {
          resolve(copyMaskSync(result));
        } catch (e) {
          reject(e);
        }
      };
      try {
        if (typeof seg.setImage === "function" && Array.isArray(roi)) {
          seg.setImage(image);
          const ret = seg.segment(roi);
          if (ret) finish(ret);
          else setTimeout(() => { if (!done) reject(new Error("timeout")); }, 8000);
          return;
        }
        const ret = seg.segment(image, roi, finish);
        if (ret && (ret.categoryMask || ret.confidenceMasks)) finish(ret);
        setTimeout(() => { if (!done) reject(new Error("timeout")); }, 10000);
      } catch (e) {
        try {
          const ret = seg.segment(image, roi);
          finish(ret);
        } catch (e2) {
          if (!done) { done = true; reject(e2); }
        }
      }
    });
  }

  function modelUrls() {
    const local = new URL("./models/magic_touch.tflite", location.href).href;
    return [
      local,
      "https://storage.googleapis.com/mediapipe-models/interactive_segmenter/magic_touch/float32/1/magic_touch.tflite",
      "https://storage.googleapis.com/mediapipe-models/interactive_segmenter_v2/magic_touch/int8/latest/interactive_segmentation.task",
    ];
  }

  async function loadNN() {
    if (nn) return nn;
    if (nnPromise) return nnPromise;
    nnPromise = (async () => {
      const mod = await import("https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.21/+esm");
      const fileset = await mod.FilesetResolver.forVisionTasks(
        "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.21/wasm"
      );
      let last;
      for (const modelAssetPath of modelUrls()) {
        for (const delegate of ["GPU", "CPU"]) {
          try {
            const seg = await mod.InteractiveSegmenter.createFromOptions(fileset, {
              baseOptions: { modelAssetPath, delegate },
              outputCategoryMask: true,
              outputConfidenceMasks: true,
            });
            nn = { mod, seg };
            return nn;
          } catch (e) { last = e; }
        }
      }
      throw last || new Error("no-nn");
    })();
    try {
      return await nnPromise;
    } catch (e) {
      nnPromise = null;
      throw e;
    }
  }

  function consider(raw, scribble, w, h, best) {
    if (!raw) return best;
    const cands = [raw, invertMask(raw)];
    for (const cand of cands) {
      const clamped = clampToNeighborhood(cand, scribble, w, h);
      const kept = keepTouchingScribble(clamped, scribble, w, h);
      const sc = scoreMask(kept, scribble, w, h);
      if (sc > best.score) best = { score: sc, mask: kept };
    }
    return best;
  }

  async function nnMask(image, scribble, w, h) {
    const { seg } = await loadNN();
    const pts = scribblePoints(scribble, w, h, 5);
    if (!pts.length) throw new Error("empty");
    let best = { score: 0, mask: null };
    for (const pt of pts.slice(0, 3)) {
      try {
        const packed = await runSegment(seg, image, { keypoint: pt });
        best = consider(packedToMask(packed, w, h, false), scribble, w, h, best);
      } catch (e) {}
    }
    if (!best.mask || best.score < 0.06) throw new Error("tiny");
    return best.mask;
  }

  function geodesicMask(srcData, scribble, w, h) {
    const pad = Math.max(12, Math.round(Math.min(w, h) * 0.16));
    const box = bboxOf(scribble, w, h, pad);
    if (box.n < 8) throw new Error("Закрась предмет — хотя бы пятно по центру.");
    const bw = box.maxX - box.minX + 1;
    const bh = box.maxY - box.minY + 1;

    function idx(x, y) { return y * w + x; }
    function cost(i, j) {
      const dr = srcData[i * 4] - srcData[j * 4];
      const dg = srcData[i * 4 + 1] - srcData[j * 4 + 1];
      const db = srcData[i * 4 + 2] - srcData[j * 4 + 2];
      return 1 + Math.round((dr * dr + dg * dg + db * db) / 2200);
    }

    function dijkstra(seeds) {
      const dist = new Int32Array(w * h);
      dist.fill(1e8);
      const BUCKETS = 4096;
      const buckets = new Array(BUCKETS);
      for (let i = 0; i < BUCKETS; i++) buckets[i] = [];
      let bmin = 0, pending = 0;
      const push = (i, d) => {
        if (d >= dist[i]) return;
        dist[i] = d;
        buckets[d % BUCKETS].push(i);
        pending++;
      };
      for (const s of seeds) push(s, 0);
      while (pending) {
        while (buckets[bmin % BUCKETS].length === 0) bmin++;
        const bucket = buckets[bmin % BUCKETS];
        const i = bucket.pop();
        pending--;
        if (dist[i] !== bmin) continue;
        const x = i % w, y = (i - x) / w;
        const neigh = [];
        if (x > box.minX) neigh.push(i - 1);
        if (x < box.maxX) neigh.push(i + 1);
        if (y > box.minY) neigh.push(i - w);
        if (y < box.maxY) neigh.push(i + w);
        for (const j of neigh) push(j, bmin + cost(i, j));
      }
      return dist;
    }

    const fgSeeds = [];
    for (let i = 0; i < scribble.length; i++) if (scribble[i]) fgSeeds.push(i);
    const bgSeeds = [];
    for (let x = box.minX; x <= box.maxX; x++) {
      const top = idx(x, box.minY), bot = idx(x, box.maxY);
      if (!scribble[top]) bgSeeds.push(top);
      if (!scribble[bot]) bgSeeds.push(bot);
    }
    for (let y = box.minY; y <= box.maxY; y++) {
      const left = idx(box.minX, y), right = idx(box.maxX, y);
      if (!scribble[left]) bgSeeds.push(left);
      if (!scribble[right]) bgSeeds.push(right);
    }
    if (!bgSeeds.length) throw new Error("tiny");

    const fg = dijkstra(fgSeeds);
    const bg = dijkstra(bgSeeds);
    const mask = new Uint8Array(w * h);
    for (let y = box.minY; y <= box.maxY; y++) {
      for (let x = box.minX; x <= box.maxX; x++) {
        const i = idx(x, y);
        if (fg[i] < bg[i] * 1.08) mask[i] = 1;
      }
    }
    fillHoles(mask, w, h, box);
    const kept = keepTouchingScribble(clampToNeighborhood(mask, scribble, w, h), scribble, w, h);
    if (scoreMask(kept, scribble, w, h) < 0.05) throw new Error("Не нашла предмет. Закрась его щедрее.");
    if (countOn(kept) > bw * bh * 0.97) throw new Error("too-big");
    return kept;
  }

  function canvasFrom(image, w, h) {
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    c.getContext("2d").drawImage(image, 0, 0, w, h);
    return c;
  }

  function readScribble(canvas, w, h) {
    const c = canvasFrom(canvas, w, h);
    const sd = c.getContext("2d").getImageData(0, 0, w, h).data;
    const scribble = new Uint8Array(w * h);
    for (let i = 0; i < w * h; i++) if (sd[i * 4 + 3] > 18) scribble[i] = 1;
    return scribble;
  }

  function cropCanvas(image, box, nw, nh) {
    const sx = (box.minX / box.sw) * nw;
    const sy = (box.minY / box.sh) * nh;
    const sw = ((box.maxX - box.minX + 1) / box.sw) * nw;
    const sh = ((box.maxY - box.minY + 1) / box.sh) * nh;
    const maxSide = 768;
    const scale = Math.min(1, maxSide / Math.max(sw, sh, 1));
    const c = document.createElement("canvas");
    c.width = Math.max(2, Math.round(sw * scale));
    c.height = Math.max(2, Math.round(sh * scale));
    c.getContext("2d").drawImage(image, sx, sy, sw, sh, 0, 0, c.width, c.height);
    return { canvas: c, sx, sy, sw, sh };
  }

  function maskFromAlpha(canvas) {
    const w = canvas.width, h = canvas.height;
    const d = canvas.getContext("2d").getImageData(0, 0, w, h).data;
    const mask = new Uint8Array(w * h);
    for (let i = 0; i < w * h; i++) if (d[i * 4 + 3] > 28) mask[i] = 1;
    return mask;
  }

  async function blobToCanvas(blob) {
    const url = URL.createObjectURL(blob);
    try {
      const img = await new Promise((res, rej) => {
        const im = new Image();
        im.onload = () => res(im);
        im.onerror = rej;
        im.src = url;
      });
      return canvasFrom(img, img.naturalWidth || img.width, img.naturalHeight || img.height);
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  function finishWithMask(image, mask, mw, mh, nw, nh) {
    const box = bboxOf(mask, mw, mh, 3);
    if (box.n < 40) throw new Error("Не нашла предмет. Закрась его щедрее.");
    const alpha = feather(mask, mw, mh, 2);
    const cw = box.maxX - box.minX + 1;
    const ch = box.maxY - box.minY + 1;
    const out = document.createElement("canvas");
    out.width = Math.max(2, Math.round((cw / mw) * nw));
    out.height = Math.max(2, Math.round((ch / mh) * nh));
    const octx = out.getContext("2d");
    octx.drawImage(
      image,
      (box.minX / mw) * nw,
      (box.minY / mh) * nh,
      (cw / mw) * nw,
      (ch / mh) * nh,
      0, 0, out.width, out.height
    );
    const img = octx.getImageData(0, 0, out.width, out.height);
    for (let y = 0; y < out.height; y++) {
      for (let x = 0; x < out.width; x++) {
        const mx = Math.min(mw - 1, Math.round(box.minX + (x / out.width) * cw));
        const my = Math.min(mh - 1, Math.round(box.minY + (y / out.height) * ch));
        img.data[(y * out.width + x) * 4 + 3] = alpha[my * mw + mx] || 0;
      }
    }
    octx.putImageData(img, 0, 0);
    return out;
  }

  let bg = null;
  let bgPromise = null;

  async function loadBg(onProgress) {
    if (bg) return bg;
    if (bgPromise) return bgPromise;
    bgPromise = (async () => {
      const tell = (s) => { if (onProgress) onProgress(s); };
      tell("Загружаю модель снятия фона…");
      try {
        await import("https://cdn.jsdelivr.net/npm/onnxruntime-web@1.21.0/dist/ort.wasm.min.js");
      } catch (e) {}
      try {
        const mod = await import("https://cdn.jsdelivr.net/npm/@imgly/background-removal@1.5.5/+esm");
        const fn = mod.default || mod.removeBackground;
        if (typeof fn === "function") {
          bg = {
            kind: "imgly",
            run: async (input) => {
              const cfg = {
                model: "isnet_quint8",
                output: { format: "image/png", type: "foreground" },
                progress: (k, c, t) => tell("Снимаю фон… " + Math.round((c / Math.max(1, t)) * 100) + "%"),
              };
              try {
                return await fn(input, Object.assign({
                  publicPath: "https://cdn.jsdelivr.net/npm/@imgly/background-removal-data@1.5.5/dist/",
                }, cfg));
              } catch (e) {
                return await fn(input, cfg);
              }
            },
          };
          return bg;
        }
      } catch (e) {}
      const tf = await import("https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.5.1");
      const pipeline = tf.pipeline || (tf.default && tf.default.pipeline);
      const env = tf.env || (tf.default && tf.default.env);
      if (env) env.allowLocalModels = false;
      tell("Качаю сеть вырезания предметов…");
      const progress_callback = (p) => {
        if (p && p.status === "progress" && p.total) {
          tell("Качаю сеть… " + Math.round((p.loaded / p.total) * 100) + "%");
        }
      };
      let pipe;
      try {
        pipe = await pipeline("background-removal", "briaai/RMBG-1.4", { dtype: "q8", progress_callback });
      } catch (e) {
        pipe = await pipeline("image-segmentation", "Xenova/modnet", { dtype: "q8", progress_callback });
      }
      bg = {
        kind: "hf",
        run: async (input) => {
          const url = input.toDataURL ? input.toDataURL("image/jpeg", 0.92) : input;
          const out = await pipe(url);
          const first = Array.isArray(out) ? out[0] : out;
          if (first && first.toBlob) return first.toBlob();
          if (first && first.mask && first.mask.toBlob) return first.mask.toBlob();
          if (first instanceof Blob) return first;
          throw new Error("bad-hf");
        },
      };
      return bg;
    })();
    try {
      return await bgPromise;
    } catch (e) {
      bgPromise = null;
      throw e;
    }
  }

  async function bgMask(cropCanvas, scribble, w, h, onProgress) {
    const engine = await Promise.race([
      loadBg(onProgress),
      new Promise((_, rej) => setTimeout(() => rej(new Error("bg-timeout")), 45000)),
    ]);
    const blob = await Promise.race([
      engine.run(cropCanvas),
      new Promise((_, rej) => setTimeout(() => rej(new Error("bg-timeout")), 60000)),
    ]);
    const fg = await blobToCanvas(blob);
    const scaled = canvasFrom(fg, w, h);
    const raw = maskFromAlpha(scaled);
    const kept = keepTouchingScribble(raw, scribble, w, h);
    if (scoreMask(kept, scribble, w, h) < 0.08) throw new Error("bg-miss");
    return kept;
  }

  async function extract(image, scribbleCanvas, opts) {
    const onProgress = opts && opts.onProgress;
    const nw = image.naturalWidth || image.width;
    const nh = image.naturalHeight || image.height;
    const work = Math.min(640, Math.max(nw, nh));
    const scale = Math.min(1, work / Math.max(nw, 1));
    const w = Math.max(2, Math.round(nw * scale));
    const h = Math.max(2, Math.round(nh * scale));
    const scribble = readScribble(scribbleCanvas, w, h);
    if (countOn(scribble) < 12) {
      throw new Error("Закрась предмет пятном — сеть доведёт край сама.");
    }

    const tight = bboxOf(scribble, w, h, 0);
    const pad = Math.max(10, Math.round(0.18 * Math.max(tight.maxX - tight.minX + 1, tight.maxY - tight.minY + 1)));
    const loose = bboxOf(scribble, w, h, pad);
    loose.sw = w;
    loose.sh = h;
    const crop = cropCanvas(image, loose, nw, nh);
    const cw = crop.canvas.width;
    const ch = crop.canvas.height;
    const workScribble = canvasFrom(scribbleCanvas, w, h);
    const mapped = document.createElement("canvas");
    mapped.width = cw;
    mapped.height = ch;
    mapped.getContext("2d").drawImage(
      workScribble,
      loose.minX, loose.minY, loose.maxX - loose.minX + 1, loose.maxY - loose.minY + 1,
      0, 0, cw, ch
    );
    const scribCrop = readScribble(mapped, cw, ch);

    let mask = null;
    let score = 0;
    try {
      if (onProgress) onProgress("Снимаю фон, как в стикерах…");
      mask = await bgMask(crop.canvas, scribCrop, cw, ch, onProgress);
      score = scoreMask(mask, scribCrop, cw, ch);
    } catch (e) {
      mask = null;
    }
    try {
      const nn = await nnMask(crop.canvas, scribCrop, cw, ch);
      const sc = scoreMask(nn, scribCrop, cw, ch);
      if (!mask || sc > score) { mask = nn; score = sc; }
    } catch (e) {}
    try {
      const srcData = crop.canvas.getContext("2d", { willReadFrequently: true }).getImageData(0, 0, cw, ch).data;
      const geo = geodesicMask(srcData, scribCrop, cw, ch);
      const sc = scoreMask(geo, scribCrop, cw, ch);
      if (!mask || sc > score) mask = geo;
    } catch (e) {
      if (!mask) throw e;
    }

    const out = finishWithMask(crop.canvas, mask, cw, ch, cw, ch);
    const blob = await new Promise((res) => out.toBlob(res, "image/png"));
    return { blob, width: out.width, height: out.height };
  }

  return { extract, loadNN, loadBg };
})();
