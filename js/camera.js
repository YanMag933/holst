window.StudioCam = (function () {
  let stream = null;
  let raf = 0;
  let video = null;
  let overlay = null;
  let frameEl = null;

  function mmToPx() {
    const probe = document.getElementById("mm-probe");
    if (probe) {
      const w = probe.getBoundingClientRect().width;
      if (w > 4) return w / 10;
    }
    return 96 / 25.4;
  }

  function pxPerMm(calibrate) {
    return calibrate || mmToPx();
  }

  async function start(videoEl) {
    stop();
    video = videoEl;
    const constraints = {
      audio: false,
      video: {
        facingMode: { ideal: "environment" },
        width: { ideal: 1920 },
        height: { ideal: 1080 },
      },
    };
    try {
      stream = await navigator.mediaDevices.getUserMedia(constraints);
    } catch (e) {
      stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
    }
    video.srcObject = stream;
    video.setAttribute("playsinline", "true");
    video.muted = true;
    await video.play();
    return stream;
  }

  function stop() {
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    if (stream) {
      stream.getTracks().forEach((t) => t.stop());
      stream = null;
    }
    if (video) video.srcObject = null;
  }

  function fitFrame(parent, aspect, inset) {
    const w = parent.clientWidth;
    const extraB = (inset && inset.bottom) || 0;
    const h = parent.clientHeight - extraB;
    const pad = 14;
    let fw = w - pad * 2;
    let fh = fw / aspect;
    if (fh > h - pad * 2) {
      fh = h - pad * 2;
      fw = fh * aspect;
    }
    return { fw, fh, left: (w - fw) / 2, top: (h - fh) / 2 };
  }

  function drawOverlay(opts) {
    const {
      canvas,
      exportCanvas,
      opacity,
      gridN,
      zoom,
      zoomCell,
      highlightCells,
      stepCanvas,
    } = opts;
    const ctx = canvas.getContext("2d");
    const W = canvas.width;
    const H = canvas.height;
    ctx.clearRect(0, 0, W, H);
    const src = stepCanvas || exportCanvas;
    if (!src) return;

    const n = gridN || 4;
    const view = zoom || (zoomCell ? { kind: "cell", col: zoomCell.col, row: zoomCell.row } : { kind: "full" });
    const rect = window.Easel && Easel.viewRect ? Easel.viewRect(view, n) : { x: 0, y: 0, w: 1, h: 1 };
    const sx = rect.x * src.width;
    const sy = rect.y * src.height;
    const sw = rect.w * src.width;
    const sh = rect.h * src.height;

    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.globalAlpha = opacity;
    ctx.drawImage(src, sx, sy, sw, sh, 0, 0, W, H);
    ctx.globalAlpha = 1;

    const kind = view.kind || "full";
    const gn = kind === "full" ? n : 2;
    ctx.save();
    const hotList = highlightCells || [];
    const hotSet = new Set(hotList.map((c) => c.col + ":" + c.row));
    const subset = hotList.length > 0 && hotList.length < n * n;

    function cellBox(col, row) {
      const left = (col / n - rect.x) / rect.w;
      const top = (row / n - rect.y) / rect.h;
      const right = ((col + 1) / n - rect.x) / rect.w;
      const bottom = ((row + 1) / n - rect.y) / rect.h;
      return {
        x: left * W,
        y: top * H,
        w: (right - left) * W,
        h: (bottom - top) * H,
        visible: right > 0.001 && bottom > 0.001 && left < 0.999 && top < 0.999,
      };
    }

    ctx.strokeStyle = subset ? "rgba(255,255,255,0.08)" : "rgba(224,196,122,0.28)";
    ctx.lineWidth = Math.max(0.5, W / 900);
    for (let i = 1; i < gn; i++) {
      ctx.beginPath();
      ctx.moveTo((W * i) / gn, 0);
      ctx.lineTo((W * i) / gn, H);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, (H * i) / gn);
      ctx.lineTo(W, (H * i) / gn);
      ctx.stroke();
    }

    if (subset) {
      ctx.fillStyle = "rgba(4,2,0,0.52)";
      for (let row = 0; row < n; row++) {
        for (let col = 0; col < n; col++) {
          if (hotSet.has(col + ":" + row)) continue;
          const box = cellBox(col, row);
          if (box.visible) ctx.fillRect(box.x, box.y, box.w, box.h);
        }
      }
      const lw = Math.max(2.2, W / 130);
      hotList.forEach((c) => {
        const box = cellBox(c.col, c.row);
        if (!box.visible) return;
        ctx.fillStyle = "rgba(224,196,122,0.18)";
        ctx.fillRect(box.x, box.y, box.w, box.h);
        ctx.strokeStyle = "rgba(232,204,126,0.95)";
        ctx.lineWidth = lw;
        ctx.strokeRect(box.x + lw / 2, box.y + lw / 2, box.w - lw, box.h - lw);
      });
    } else if (hotList.length) {
      const lw = Math.max(1.5, W / 200);
      ctx.strokeStyle = "rgba(232,204,126,0.5)";
      ctx.lineWidth = lw;
      for (let row = 0; row < n; row++) {
        for (let col = 0; col < n; col++) {
          const box = cellBox(col, row);
          if (!box.visible) continue;
          ctx.strokeRect(box.x + lw / 2, box.y + lw / 2, box.w - lw, box.h - lw);
        }
      }
    }

    if (kind !== "cell") {
      ctx.font = Math.max(11, Math.round(W / (kind === "quad" ? 16 : 42))) + "px Palatino, serif";
      ctx.textAlign = "left";
      ctx.textBaseline = "top";
      const c0 = Math.round(rect.x * n);
      const r0 = Math.round(rect.y * n);
      const span = Math.max(1, Math.round(rect.w * n));
      for (let r = 0; r < span; r++) {
        for (let c = 0; c < span; c++) {
          const col = c0 + c;
          const row = r0 + r;
          const hot = hotSet.has(col + ":" + row);
          const label = StudioAnalyze.cellLabel(col, row, n);
          const x = (c / span) * W + 7;
          const y = (r / span) * H + 7;
          if (hot && subset) {
            ctx.fillStyle = "rgba(18,12,6,0.62)";
            const tw = ctx.measureText(label).width;
            ctx.fillRect(x - 4, y - 3, tw + 10, Math.max(16, W / 36));
          }
          ctx.fillStyle = hot ? "rgba(255,232,170,0.95)" : "rgba(255,255,255,0.28)";
          ctx.fillText(label, x, y);
        }
      }
    }

    ctx.strokeStyle = "rgba(244,236,225,0.55)";
    ctx.lineWidth = Math.max(1.2, W / 280);
    ctx.strokeRect(1, 1, W - 2, H - 2);
    ctx.restore();
  }

  return { start, stop, fitFrame, drawOverlay, pxPerMm, mmToPx };
})();
