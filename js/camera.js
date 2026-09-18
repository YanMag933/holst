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

    let sx = 0, sy = 0, sw = src.width, sh = src.height;
    const n = gridN || 4;
    if (zoomCell) {
      sw = src.width / n;
      sh = src.height / n;
      sx = zoomCell.col * sw;
      sy = zoomCell.row * sh;
    }

    ctx.globalAlpha = opacity;
    ctx.drawImage(src, sx, sy, sw, sh, 0, 0, W, H);
    ctx.globalAlpha = 1;

    const gn = zoomCell ? 2 : n;
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

    if (!zoomCell && highlightCells && highlightCells.length) {
      ctx.fillStyle = "rgba(212,181,106,0.07)";
      highlightCells.forEach((c) => {
        ctx.fillRect((c.col / n) * W, (c.row / n) * H, W / n, H / n);
      });
    }

    if (!zoomCell) {
      ctx.font = Math.max(8, Math.round(W / 48)) + "px Palatino, serif";
      ctx.textAlign = "left";
      ctx.textBaseline = "top";
      for (let r = 0; r < n; r++) {
        for (let c = 0; c < n; c++) {
          const hot = highlightCells && highlightCells.some((x) => x.col === c && x.row === r);
          ctx.fillStyle = hot ? "rgba(232,204,126,0.38)" : "rgba(255,255,255,0.16)";
          ctx.fillText(StudioAnalyze.cellLabel(c, r, n), (c / n) * W + 3, (r / n) * H + 3);
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
