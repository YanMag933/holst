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

  function fitFrame(parent, aspect) {
    const w = parent.clientWidth;
    const h = parent.clientHeight;
    const pad = 18;
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

    ctx.strokeStyle = "rgba(244,236,225,0.55)";
    ctx.lineWidth = Math.max(1, W / 400);
    const gn = zoomCell ? 2 : n;
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
      ctx.fillStyle = "rgba(212,85,43,0.18)";
      ctx.strokeStyle = "rgba(212,85,43,0.9)";
      highlightCells.forEach((c) => {
        const x = (c.col / n) * W;
        const y = (c.row / n) * H;
        ctx.fillRect(x, y, W / n, H / n);
        ctx.strokeRect(x + 1, y + 1, W / n - 2, H / n - 2);
      });
    }

    ctx.strokeStyle = "#f4ece1";
    ctx.lineWidth = Math.max(2, W / 180);
    ctx.strokeRect(1, 1, W - 2, H - 2);
  }

  return { start, stop, fitFrame, drawOverlay, pxPerMm, mmToPx };
})();
