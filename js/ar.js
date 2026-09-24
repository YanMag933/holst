window.HolstAR = (function () {
  "use strict";

  const CORNER_LABELS = ["левый верх", "правый верх", "правый низ", "левый низ"];

  function solveHomography(src, dst) {
    // src/dst: 4 points {x,y}. Returns 3x3 row-major H mapping src -> dst.
    const A = [];
    const b = [];
    for (let i = 0; i < 4; i++) {
      const x = src[i].x, y = src[i].y;
      const u = dst[i].x, v = dst[i].y;
      A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]);
      b.push(u);
      A.push([0, 0, 0, x, y, 1, -v * x, -v * y]);
      b.push(v);
    }
    const h = solve8(A, b);
    if (!h) return null;
    return [h[0], h[1], h[2], h[3], h[4], h[5], h[6], h[7], 1];
  }

  function solve8(A, b) {
    const n = 8;
    const M = A.map((row, i) => row.concat([b[i]]));
    for (let col = 0; col < n; col++) {
      let piv = col;
      for (let r = col + 1; r < n; r++) {
        if (Math.abs(M[r][col]) > Math.abs(M[piv][col])) piv = r;
      }
      if (Math.abs(M[piv][col]) < 1e-10) return null;
      if (piv !== col) {
        const t = M[col];
        M[col] = M[piv];
        M[piv] = t;
      }
      const div = M[col][col];
      for (let c = col; c <= n; c++) M[col][c] /= div;
      for (let r = 0; r < n; r++) {
        if (r === col) continue;
        const f = M[r][col];
        for (let c = col; c <= n; c++) M[r][c] -= f * M[col][c];
      }
    }
    return M.map((row) => row[n]);
  }

  function applyH(H, p) {
    const w = H[6] * p.x + H[7] * p.y + H[8];
    if (Math.abs(w) < 1e-9) return { x: p.x, y: p.y };
    return {
      x: (H[0] * p.x + H[1] * p.y + H[2]) / w,
      y: (H[3] * p.x + H[4] * p.y + H[5]) / w,
    };
  }

  function getAffine(s0, s1, s2, d0, d1, d2) {
    // Map triangle s -> d as canvas setTransform(a,b,c,d,e,f)
    const den = s0.x * (s1.y - s2.y) + s1.x * (s2.y - s0.y) + s2.x * (s0.y - s1.y);
    if (Math.abs(den) < 1e-9) return null;
    const a = (d0.x * (s1.y - s2.y) + d1.x * (s2.y - s0.y) + d2.x * (s0.y - s1.y)) / den;
    const c = (d0.x * (s2.x - s1.x) + d1.x * (s0.x - s2.x) + d2.x * (s1.x - s0.x)) / den;
    const e = (d0.x * (s1.x * s2.y - s2.x * s1.y) + d1.x * (s2.x * s0.y - s0.x * s2.y) + d2.x * (s0.x * s1.y - s1.x * s0.y)) / den;
    const b = (d0.y * (s1.y - s2.y) + d1.y * (s2.y - s0.y) + d2.y * (s0.y - s1.y)) / den;
    const d = (d0.y * (s2.x - s1.x) + d1.y * (s0.x - s2.x) + d2.y * (s1.x - s0.x)) / den;
    const f = (d0.y * (s1.x * s2.y - s2.x * s1.y) + d1.y * (s2.x * s0.y - s0.x * s2.y) + d2.y * (s0.x * s1.y - s1.x * s0.y)) / den;
    return [a, b, c, d, e, f];
  }

  function drawTriangle(ctx, img, s0, s1, s2, d0, d1, d2) {
    const t = getAffine(s0, s1, s2, d0, d1, d2);
    if (!t) return;
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(d0.x, d0.y);
    ctx.lineTo(d1.x, d1.y);
    ctx.lineTo(d2.x, d2.y);
    ctx.closePath();
    ctx.clip();
    ctx.setTransform(t[0], t[1], t[2], t[3], t[4], t[5]);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(img, 0, 0);
    ctx.restore();
  }

  function drawWarped(ctx, img, corners, opacity) {
    if (!img || !corners || corners.length !== 4) return;
    const w = img.width || img.naturalWidth;
    const h = img.height || img.naturalHeight;
    if (!w || !h) return;
    const s = [
      { x: 0, y: 0 },
      { x: w, y: 0 },
      { x: w, y: h },
      { x: 0, y: h },
    ];
    const d = corners;
    ctx.save();
    ctx.globalAlpha = opacity == null ? 0.32 : opacity;
    // two triangles: 0-1-2 and 0-2-3
    drawTriangle(ctx, img, s[0], s[1], s[2], d[0], d[1], d[2]);
    drawTriangle(ctx, img, s[0], s[2], s[3], d[0], d[2], d[3]);
    ctx.restore();
  }

  function drawPinGuides(ctx, corners, nextIdx, W, H) {
    ctx.save();
    corners.forEach((p, i) => {
      ctx.beginPath();
      ctx.arc(p.x, p.y, Math.max(10, W / 55), 0, Math.PI * 2);
      ctx.fillStyle = i === nextIdx ? "rgba(224,196,122,0.95)" : "rgba(244,236,225,0.85)";
      ctx.fill();
      ctx.strokeStyle = "rgba(0,0,0,0.55)";
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.fillStyle = "#140f0a";
      ctx.font = "bold " + Math.max(12, Math.round(W / 40)) + "px Palatino, serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(String(i + 1), p.x, p.y + 1);
    });
    if (corners.length >= 2) {
      ctx.strokeStyle = "rgba(224,196,122,0.75)";
      ctx.lineWidth = Math.max(2, W / 280);
      ctx.beginPath();
      corners.forEach((p, i) => {
        if (i === 0) ctx.moveTo(p.x, p.y);
        else ctx.lineTo(p.x, p.y);
      });
      if (corners.length === 4) ctx.closePath();
      ctx.stroke();
    }
    if (nextIdx < 4) {
      ctx.fillStyle = "rgba(0,0,0,0.45)";
      ctx.fillRect(0, 0, W, Math.max(48, H * 0.08));
      ctx.fillStyle = "#f6ead6";
      ctx.font = Math.max(14, Math.round(W / 28)) + "px Palatino, serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(
        "Точка " + (nextIdx + 1) + " из 4 — " + CORNER_LABELS[nextIdx],
        W / 2,
        Math.max(24, H * 0.04)
      );
    }
    ctx.restore();
  }

  function drawCellHighlights(ctx, corners, cells, gridN, opacity) {
    if (!corners || corners.length !== 4 || !cells || !cells.length) return;
    const n = gridN || 4;
    const src = [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 1, y: 1 },
      { x: 0, y: 1 },
    ];
    const H = solveHomography(src, corners);
    if (!H) return;
    const hot = new Set(cells.map((c) => c.col + ":" + c.row));
    const subset = hot.size > 0 && hot.size < n * n;
    ctx.save();
    if (subset) {
      ctx.fillStyle = "rgba(4,2,0,0.42)";
      for (let row = 0; row < n; row++) {
        for (let col = 0; col < n; col++) {
          if (hot.has(col + ":" + row)) continue;
          const q = [
            applyH(H, { x: col / n, y: row / n }),
            applyH(H, { x: (col + 1) / n, y: row / n }),
            applyH(H, { x: (col + 1) / n, y: (row + 1) / n }),
            applyH(H, { x: col / n, y: (row + 1) / n }),
          ];
          ctx.beginPath();
          ctx.moveTo(q[0].x, q[0].y);
          q.slice(1).forEach((p) => ctx.lineTo(p.x, p.y));
          ctx.closePath();
          ctx.fill();
        }
      }
    }
    ctx.strokeStyle = "rgba(232,204,126,0.95)";
    ctx.lineWidth = 2.4;
    cells.forEach((c) => {
      const q = [
        applyH(H, { x: c.col / n, y: c.row / n }),
        applyH(H, { x: (c.col + 1) / n, y: c.row / n }),
        applyH(H, { x: (c.col + 1) / n, y: (c.row + 1) / n }),
        applyH(H, { x: c.col / n, y: (c.row + 1) / n }),
      ];
      ctx.beginPath();
      ctx.moveTo(q[0].x, q[0].y);
      q.slice(1).forEach((p) => ctx.lineTo(p.x, p.y));
      ctx.closePath();
      ctx.fillStyle = "rgba(224,196,122,0.16)";
      ctx.fill();
      ctx.stroke();
    });
    ctx.restore();
  }

  function defaultCorners(W, H, aspect) {
    const pad = Math.min(W, H) * 0.12;
    let fw = W - pad * 2;
    let fh = fw / aspect;
    if (fh > H - pad * 2) {
      fh = H - pad * 2;
      fw = fh * aspect;
    }
    const left = (W - fw) / 2;
    const top = (H - fh) / 2;
    return [
      { x: left, y: top },
      { x: left + fw, y: top },
      { x: left + fw, y: top + fh },
      { x: left, y: top + fh },
    ];
  }

  // ---- Pin session (iPhone / everywhere) ----
  function createPinSession(opts) {
    const canvas = opts.canvas;
    const getSource = opts.getSource; // () => HTMLCanvasElement|Image
    const getOpacity = opts.getOpacity || (() => 0.32);
    const getHighlight = opts.getHighlight || (() => ({ cells: [], gridN: 4 }));
    let corners = (opts.corners || []).map((p) => ({ x: p.x, y: p.y }));
    let placing = corners.length < 4;
    let dragIdx = -1;
    let aspect = opts.aspect || 1;

    function paint() {
      const ctx = canvas.getContext("2d");
      const W = canvas.width;
      const H = canvas.height;
      ctx.clearRect(0, 0, W, H);
      const src = getSource();
      if (corners.length === 4 && src) {
        drawWarped(ctx, src, corners, getOpacity());
        const hi = getHighlight();
        drawCellHighlights(ctx, corners, hi.cells || [], hi.gridN || 4);
        // corner handles
        corners.forEach((p, i) => {
          ctx.beginPath();
          ctx.arc(p.x, p.y, 9, 0, Math.PI * 2);
          ctx.fillStyle = "rgba(224,196,122,0.9)";
          ctx.fill();
          ctx.strokeStyle = "rgba(20,15,10,0.7)";
          ctx.lineWidth = 2;
          ctx.stroke();
        });
      } else {
        drawPinGuides(ctx, corners, corners.length, W, H);
        if (!corners.length) {
          const ghost = defaultCorners(W, H, aspect);
          ctx.strokeStyle = "rgba(224,196,122,0.25)";
          ctx.setLineDash([8, 8]);
          ctx.lineWidth = 2;
          ctx.beginPath();
          ghost.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
          ctx.closePath();
          ctx.stroke();
          ctx.setLineDash([]);
        }
      }
    }

    function hitCorner(x, y) {
      const r = 28 * (window.devicePixelRatio || 1);
      let best = -1, bestD = r * r;
      corners.forEach((p, i) => {
        const d = (p.x - x) * (p.x - x) + (p.y - y) * (p.y - y);
        if (d < bestD) { bestD = d; best = i; }
      });
      return best;
    }

    function toLocal(e) {
      const r = canvas.getBoundingClientRect();
      const touch = e.touches && e.touches[0];
      const cx = touch ? touch.clientX : e.clientX;
      const cy = touch ? touch.clientY : e.clientY;
      return {
        x: ((cx - r.left) / Math.max(1, r.width)) * canvas.width,
        y: ((cy - r.top) / Math.max(1, r.height)) * canvas.height,
      };
    }

    function onDown(e) {
      e.preventDefault();
      const p = toLocal(e);
      if (placing && corners.length < 4) {
        corners.push(p);
        if (corners.length === 4) placing = false;
        paint();
        if (opts.onChange) opts.onChange(snapshot());
        return;
      }
      dragIdx = hitCorner(p.x, p.y);
    }
    function onMove(e) {
      if (dragIdx < 0) return;
      e.preventDefault();
      const p = toLocal(e);
      corners[dragIdx] = p;
      paint();
    }
    function onUp() {
      if (dragIdx >= 0 && opts.onChange) opts.onChange(snapshot());
      dragIdx = -1;
    }

    canvas.addEventListener("pointerdown", onDown, { passive: false });
    canvas.addEventListener("pointermove", onMove, { passive: false });
    canvas.addEventListener("pointerup", onUp);
    canvas.addEventListener("pointercancel", onUp);

    function snapshot() {
      return {
        mode: "pin",
        corners: corners.map((p) => ({ x: p.x, y: p.y })),
        placing,
        ready: corners.length === 4,
      };
    }

    return {
      paint,
      reset() {
        corners = [];
        placing = true;
        paint();
        if (opts.onChange) opts.onChange(snapshot());
      },
      setAspect(a) { aspect = a || 1; },
      setCorners(list) {
        corners = (list || []).map((p) => ({ x: p.x, y: p.y }));
        placing = corners.length < 4;
        paint();
      },
      getCorners() { return corners.map((p) => ({ x: p.x, y: p.y })); },
      snapshot,
      destroy() {
        canvas.removeEventListener("pointerdown", onDown);
        canvas.removeEventListener("pointermove", onMove);
        canvas.removeEventListener("pointerup", onUp);
        canvas.removeEventListener("pointercancel", onUp);
      },
    };
  }

  // ---- WebXR space mode (Android Chrome) ----
  async function xrSupported() {
    if (!navigator.xr || !navigator.xr.isSessionSupported) return false;
    try {
      return await navigator.xr.isSessionSupported("immersive-ar");
    } catch (e) {
      return false;
    }
  }

  function createXrSession(opts) {
    let session = null;
    let gl = null;
    let refSpace = null;
    let hitTestSource = null;
    let viewerSpace = null;
    let placed = null; // { matrix: Float32Array }
    let texture = null;
    let program = null;
    let buf = null;
    let raf = 0;
    let running = false;
    let texDirty = true;
    let lastTexKey = "";
    const widthM = (opts.widthCm || 40) / 100;
    const heightM = (opts.heightCm || 50) / 100;

    function compile(type, src) {
      const s = gl.createShader(type);
      gl.shaderSource(s, src);
      gl.compileShader(s);
      return s;
    }

    async function initGl() {
      const canvas = opts.canvas;
      gl = canvas.getContext("webgl", { xrCompatible: true, alpha: true, premultipliedAlpha: true });
      if (!gl) throw new Error("WebGL недоступен");
      if (gl.makeXRCompatible) await gl.makeXRCompatible();
      session.updateRenderState({ baseLayer: new XRWebGLLayer(session, gl) });

      const vs = compile(gl.VERTEX_SHADER, `
        attribute vec3 aPos;
        attribute vec2 aUv;
        uniform mat4 uMVP;
        varying vec2 vUv;
        void main(){
          vUv = aUv;
          gl_Position = uMVP * vec4(aPos, 1.0);
        }
      `);
      const fs = compile(gl.FRAGMENT_SHADER, `
        precision mediump float;
        varying vec2 vUv;
        uniform sampler2D uTex;
        uniform float uOpacity;
        void main(){
          vec4 c = texture2D(uTex, vUv);
          gl_FragColor = vec4(c.rgb, c.a * uOpacity);
        }
      `);
      program = gl.createProgram();
      gl.attachShader(program, vs);
      gl.attachShader(program, fs);
      gl.linkProgram(program);

      // quad in XY plane, centered, size widthM x heightM, facing +Z then we'll rotate
      const hw = widthM / 2, hh = heightM / 2;
      const verts = new Float32Array([
        -hw,  hh, 0, 0, 0,
         hw,  hh, 0, 1, 0,
         hw, -hh, 0, 1, 1,
        -hw,  hh, 0, 0, 0,
         hw, -hh, 0, 1, 1,
        -hw, -hh, 0, 0, 1,
      ]);
      buf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(gl.ARRAY_BUFFER, verts, gl.STATIC_DRAW);

      texture = gl.createTexture();
      uploadTexture(opts.getSource());
    }

    function uploadTexture(src) {
      if (!gl || !texture || !src) return;
      const sw = src.width || src.naturalWidth || 0;
      const sh = src.height || src.naturalHeight || 0;
      if (!sw || !sh) return;
      const maxTex = gl.getParameter(gl.MAX_TEXTURE_SIZE) || 4096;
      let tw = sw;
      let th = sh;
      if (sw > maxTex || sh > maxTex) {
        const sc = maxTex / Math.max(sw, sh);
        tw = Math.max(1, Math.round(sw * sc));
        th = Math.max(1, Math.round(sh * sc));
      }
      let upload = src;
      if (tw !== sw || th !== sh) {
        const c = document.createElement("canvas");
        c.width = tw;
        c.height = th;
        const cx = c.getContext("2d");
        cx.imageSmoothingEnabled = true;
        cx.imageSmoothingQuality = "high";
        cx.drawImage(src, 0, 0, tw, th);
        upload = c;
      }
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 1);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      try {
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, upload);
      } catch (e) {}
      texDirty = false;
      lastTexKey = sw + "x" + sh;
    }

    function mul4(a, b) {
      const o = new Float32Array(16);
      for (let c = 0; c < 4; c++) {
        for (let r = 0; r < 4; r++) {
          o[c * 4 + r] =
            a[0 * 4 + r] * b[c * 4 + 0] +
            a[1 * 4 + r] * b[c * 4 + 1] +
            a[2 * 4 + r] * b[c * 4 + 2] +
            a[3 * 4 + r] * b[c * 4 + 3];
        }
      }
      return o;
    }

    function onSelect(ev) {
      if (!hitTestSource || !refSpace) return;
      const frame = ev.frame;
      const results = frame.getHitTestResults(hitTestSource);
      if (!results.length) return;
      const pose = results[0].getPose(refSpace);
      if (!pose) return;
      // Pose faces along -Z of hit; rotate 90° around X so plane stands upright-ish on wall/easel
      // For easel facing user, hit-test on vertical surface works; matrix from pose is enough.
      placed = { matrix: new Float32Array(pose.transform.matrix) };
      if (opts.onChange) opts.onChange({ mode: "space", ready: true });
    }

    function onFrame(time, frame) {
      raf = session.requestAnimationFrame(onFrame);
      const layer = session.renderState.baseLayer;
      if (!layer || !gl) return;
      const pose = frame.getViewerPose(refSpace);
      gl.bindFramebuffer(gl.FRAMEBUFFER, layer.framebuffer);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      if (!pose || !placed) return;

      if (texDirty) uploadTexture(opts.getSource());
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.useProgram(program);

      const aPos = gl.getAttribLocation(program, "aPos");
      const aUv = gl.getAttribLocation(program, "aUv");
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.enableVertexAttribArray(aPos);
      gl.vertexAttribPointer(aPos, 3, gl.FLOAT, false, 20, 0);
      gl.enableVertexAttribArray(aUv);
      gl.vertexAttribPointer(aUv, 2, gl.FLOAT, false, 20, 12);

      const opacity = opts.getOpacity ? opts.getOpacity() : 0.45;
      gl.uniform1f(gl.getUniformLocation(program, "uOpacity"), opacity);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.uniform1i(gl.getUniformLocation(program, "uTex"), 0);

      for (const view of pose.views) {
        const vp = layer.getViewport(view);
        gl.viewport(vp.x, vp.y, vp.width, vp.height);
        const mvp = mul4(view.projectionMatrix, mul4(view.transform.inverse.matrix, placed.matrix));
        gl.uniformMatrix4fv(gl.getUniformLocation(program, "uMVP"), false, mvp);
        gl.drawArrays(gl.TRIANGLES, 0, 6);
      }
    }

    async function start() {
      if (running) return;
      if (!(await xrSupported())) {
        const err = new Error("Нет комнатного AR. Нужен Chrome и «Сервисы Google Play для AR».");
        err.name = "NotSupportedError";
        throw err;
      }
      let lastErr = null;
      const attempts = [
        { requiredFeatures: ["hit-test"], optionalFeatures: ["local-floor"] },
        { requiredFeatures: ["hit-test"] },
      ];
      for (const optsReq of attempts) {
        try {
          session = await navigator.xr.requestSession("immersive-ar", optsReq);
          lastErr = null;
          break;
        } catch (e) {
          lastErr = e;
        }
      }
      if (!session) throw lastErr || new Error("Не удалось запустить immersive-ar");
      running = true;
      try {
        await initGl();
        viewerSpace = await session.requestReferenceSpace("viewer");
        try {
          refSpace = await session.requestReferenceSpace("local-floor");
        } catch (e) {
          refSpace = await session.requestReferenceSpace("local");
        }
        try {
          hitTestSource = await session.requestHitTestSource({ space: viewerSpace });
        } catch (e) {
          // hit-test may need a moment after ARCore update
          await new Promise((r) => setTimeout(r, 400));
          hitTestSource = await session.requestHitTestSource({ space: viewerSpace });
        }
      } catch (e) {
        try { await session.end(); } catch (e2) {}
        session = null;
        running = false;
        throw e;
      }
      session.addEventListener("select", onSelect);
      session.addEventListener("end", () => {
        running = false;
        session = null;
        if (opts.onEnd) opts.onEnd();
      });
      raf = session.requestAnimationFrame(onFrame);
      if (opts.onChange) opts.onChange({ mode: "space", ready: !!placed, placing: !placed });
    }

    async function stop() {
      if (session) {
        try { await session.end(); } catch (e) {}
      }
      running = false;
      session = null;
    }

    return {
      start,
      stop,
      destroy() { stop(); },
      reset() { placed = null; if (opts.onChange) opts.onChange({ mode: "space", ready: false, placing: true }); },
      refreshTexture() { texDirty = true; uploadTexture(opts.getSource()); },
      get running() { return running; },
      async supported() { return xrSupported(); },
    };
  }

  return {
    CORNER_LABELS,
    solveHomography,
    drawWarped,
    createPinSession,
    createXrSession,
    xrSupported,
    defaultCorners,
  };
})();
