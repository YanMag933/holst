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
    ctx.strokeStyle = "rgba(255,255,255,0.11)";
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

    if (kind === "full" && highlightCells && highlightCells.length) {
      ctx.fillStyle = "rgba(212,181,106,0.07)";
      highlightCells.forEach((c) => {
        ctx.fillRect((c.col / n) * W, (c.row / n) * H, W / n, H / n);
      });
    }

    if (kind !== "cell") {
      ctx.font = Math.max(10, Math.round(W / (kind === "quad" ? 18 : 48))) + "px Palatino, serif";
      ctx.textAlign = "left";
      ctx.textBaseline = "top";
      const c0 = Math.round(rect.x * n);
      const r0 = Math.round(rect.y * n);
      const span = Math.max(1, Math.round(rect.w * n));
      for (let r = 0; r < span; r++) {
        for (let c = 0; c < span; c++) {
          const col = c0 + c;
          const row = r0 + r;
          const hot = highlightCells && highlightCells.some((x) => x.col === col && x.row === row);
          ctx.fillStyle = hot ? "rgba(232,204,126,0.45)" : "rgba(255,255,255,0.2)";
          ctx.fillText(
            StudioAnalyze.cellLabel(col, row, n),
            (c / span) * W + 6,
            (r / span) * H + 6
          );
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
