window.Easel = (function () {
  function Easel(canvas, opts) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.opts = opts || {};
    this.stickers = [];
    this.images = {};
    this.selectedId = null;
    this.gridN = 4;
    this.bg = "#E8DCC8";
    this.aspect = 3 / 4;
    this.widthCm = 30;
    this.heightCm = 40;
    this.mode = "idle";
    this.pointers = new Map();
    this.lastPinch = null;
    this.holdTimer = 0;
    this.pendingHoldMenu = false;
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this._bind();
    this.resize();
  }

  Easel.prototype.setScene = function (scene) {
    this.stickers = scene.stickers || [];
    this.bg = scene.bg || "#E8DCC8";
    this.gridN = scene.gridN || 4;
    this.widthCm = scene.widthCm || 30;
    this.heightCm = scene.heightCm || 40;
    this.aspect = this.widthCm / this.heightCm;
    this.draw();
  };

  Easel.prototype.setImage = function (id, img) {
    this.images[id] = img;
    this.draw();
  };

  Easel.prototype.resize = function () {
    const el = this.canvas;
    const parent = el.parentElement;
    const pw = parent.clientWidth || 320;
    const ph = parent.clientHeight || 420;
    let w = pw, h = w / this.aspect;
    if (h > ph) { h = ph; w = h * this.aspect; }
    el.style.width = w + "px";
    el.style.height = h + "px";
    el.width = Math.round(w * this.dpr);
    el.height = Math.round(h * this.dpr);
    this.draw();
  };

  Easel.prototype.cssSize = function () {
    return { w: this.canvas.clientWidth, h: this.canvas.clientHeight };
  };

  Easel.prototype.eventPos = function (e) {
    const r = this.canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  Easel.prototype.stickerSize = function (s) {
    const { w } = this.cssSize();
    const img = this.images[s.imageId];
    const nw = img ? img.naturalWidth || img.width : 100;
    const nh = img ? img.naturalHeight || img.height : 100;
    const sw = w * (s.scale || 0.3);
    const sh = sw * (nh / nw);
    return { sw, sh, nw, nh };
  };

  Easel.prototype.hitHandle = function (s, p) {
    const { sw, sh } = this.stickerSize(s);
    const loc = this.worldToLocal(s, p.x, p.y);
    const hs = 18;
    const corners = [
      { id: "scale", x: sw / 2, y: sh / 2 },
      { id: "scale", x: -sw / 2, y: sh / 2 },
      { id: "scale", x: sw / 2, y: -sh / 2 },
      { id: "scale", x: -sw / 2, y: -sh / 2 },
    ];
    for (const c of corners) {
      if (Math.abs(loc.x - c.x) < hs && Math.abs(loc.y - c.y) < hs) return "scale";
    }
    if (Math.abs(loc.x) < hs && Math.abs(loc.y + sh / 2 + 28) < hs) return "rotate";
    if (Math.abs(loc.x) <= sw / 2 && Math.abs(loc.y) <= sh / 2) return "body";
    return null;
  };

  Easel.prototype.worldToLocal = function (s, x, y) {
    const { w, h } = this.cssSize();
    const cx = s.x * w, cy = s.y * h;
    const dx = x - cx, dy = y - cy;
    const c = Math.cos(-(s.rot || 0));
    const sn = Math.sin(-(s.rot || 0));
    return { x: dx * c - dy * sn, y: dx * sn + dy * c };
  };

  Easel.prototype.hitTest = function (p) {
    for (let i = this.stickers.length - 1; i >= 0; i--) {
      const s = this.stickers[i];
      const handle = this.hitHandle(s, p);
      if (handle) return { sticker: s, handle };
    }
    return null;
  };

  Easel.prototype._bind = function () {
    const el = this.canvas;
    el.style.touchAction = "none";
    el.addEventListener("pointerdown", this.onDown.bind(this), { passive: false });
    el.addEventListener("pointermove", this.onMove.bind(this));
    el.addEventListener("pointerup", this.onUp.bind(this));
    el.addEventListener("pointercancel", this.onUp.bind(this));
    el.addEventListener("contextmenu", (e) => e.preventDefault());
  };

  Easel.prototype.clearHold = function () {
    if (this.holdTimer) {
      clearTimeout(this.holdTimer);
      this.holdTimer = 0;
    }
  };

  Easel.prototype.onDown = function (e) {
    e.preventDefault();
    elCapture(this.canvas, e);
    const p = this.eventPos(e);
    this.pointers.set(e.pointerId, p);
    this.clearHold();
    this.pendingHoldMenu = false;
    if (this.pointers.size === 2) {
      this.lastPinch = this.pinchState();
      this.mode = "pinch";
      return;
    }
    const hit = this.hitTest(p);
    if (!hit) {
      this.selectedId = null;
      this.mode = "idle";
      this.draw();
      if (this.opts.onSelect) this.opts.onSelect(null);
      return;
    }
    this.selectedId = hit.sticker.id;
    this.mode = hit.handle;
    this.dragStart = {
      p,
      x: hit.sticker.x,
      y: hit.sticker.y,
      scale: hit.sticker.scale,
      rot: hit.sticker.rot || 0,
    };
    if (this.opts.onSelect) this.opts.onSelect(hit.sticker.id);
    this.draw();
    if (hit.handle === "body") {
      this.holdTimer = setTimeout(() => {
        this.holdTimer = 0;
        if (this.mode !== "body" || this.pointers.size !== 1) return;
        const s = this.stickers.find((x) => x.id === this.selectedId);
        if (!s || !this.dragStart) return;
        s.x = this.dragStart.x;
        s.y = this.dragStart.y;
        this.mode = "hold";
        this.pendingHoldMenu = true;
        this.draw();
        try { if (navigator.vibrate) navigator.vibrate(16); } catch (err) {}
      }, 480);
    }
  };

  function elCapture(el, e) {
    try { el.setPointerCapture(e.pointerId); } catch (err) {}
  }

  Easel.prototype.pinchState = function () {
    const pts = Array.from(this.pointers.values());
    if (pts.length < 2) return null;
    const dx = pts[1].x - pts[0].x, dy = pts[1].y - pts[0].y;
    return {
      dist: Math.hypot(dx, dy) || 1,
      angle: Math.atan2(dy, dx),
      cx: (pts[0].x + pts[1].x) / 2,
      cy: (pts[0].y + pts[1].y) / 2,
    };
  };

  Easel.prototype.onMove = function (e) {
    if (!this.pointers.has(e.pointerId)) return;
    const p = this.eventPos(e);
    this.pointers.set(e.pointerId, p);
    const { w, h } = this.cssSize();
    const s = this.stickers.find((x) => x.id === this.selectedId);

    if (this.mode === "pinch" && s) {
      const now = this.pinchState();
      if (now && this.lastPinch) {
        const ratio = now.dist / this.lastPinch.dist;
        s.scale = Math.max(0.06, Math.min(1.6, s.scale * ratio));
        s.rot = (s.rot || 0) + (now.angle - this.lastPinch.angle);
        this.lastPinch = now;
        this.draw();
        this._changed();
      }
      return;
    }
    if (this.mode === "hold") return;
    if (this.dragStart && this.holdTimer) {
      const moved = Math.hypot(p.x - this.dragStart.p.x, p.y - this.dragStart.p.y);
      if (moved > 10) this.clearHold();
    }
    if (!s || !this.dragStart) return;
    if (this.mode === "body") {
      s.x = this.dragStart.x + (p.x - this.dragStart.p.x) / w;
      s.y = this.dragStart.y + (p.y - this.dragStart.p.y) / h;
    } else if (this.mode === "scale") {
      const loc0 = this.worldToLocal(Object.assign({}, s, { x: this.dragStart.x, y: this.dragStart.y, rot: this.dragStart.rot, scale: this.dragStart.scale }), this.dragStart.p.x, this.dragStart.p.y);
      const loc1 = this.worldToLocal(Object.assign({}, s, { x: this.dragStart.x, y: this.dragStart.y, rot: this.dragStart.rot, scale: this.dragStart.scale }), p.x, p.y);
      const d0 = Math.hypot(loc0.x, loc0.y) || 1;
      const d1 = Math.hypot(loc1.x, loc1.y) || 1;
      s.scale = Math.max(0.06, Math.min(1.6, this.dragStart.scale * (d1 / d0)));
    } else if (this.mode === "rotate") {
      const cx = s.x * w, cy = s.y * h;
      const a0 = Math.atan2(this.dragStart.p.y - cy, this.dragStart.p.x - cx);
      const a1 = Math.atan2(p.y - cy, p.x - cx);
      s.rot = this.dragStart.rot + (a1 - a0);
    }
    this.draw();
    this._changed();
  };

  Easel.prototype.onUp = function (e) {
    this.clearHold();
    const openMenu = this.pendingHoldMenu && this.mode === "hold";
    this.pendingHoldMenu = false;
    this.pointers.delete(e.pointerId);
    if (this.pointers.size < 2) this.mode = this.pointers.size ? this.mode : "idle";
    if (!this.pointers.size) {
      this.dragStart = null;
      this.lastPinch = null;
    }
    if (openMenu && this.opts.onLongPress) {
      const s = this.stickers.find((x) => x.id === this.selectedId);
      if (s) this.opts.onLongPress(s);
    }
  };

  Easel.prototype._changed = function () {
    if (this.opts.onChange) this.opts.onChange(this.stickers);
  };

  Easel.prototype.nudge = function (kind) {
    const s = this.stickers.find((x) => x.id === this.selectedId);
    if (!s) return;
    if (kind === "scale-up") s.scale = Math.min(1.6, s.scale * 1.08);
    if (kind === "scale-down") s.scale = Math.max(0.06, s.scale / 1.08);
    if (kind === "rot-left") s.rot = (s.rot || 0) - Math.PI / 12;
    if (kind === "rot-right") s.rot = (s.rot || 0) + Math.PI / 12;
    if (kind === "front") {
      this.stickers = this.stickers.filter((x) => x.id !== s.id).concat([s]);
    }
    if (kind === "back") {
      this.stickers = [s].concat(this.stickers.filter((x) => x.id !== s.id));
    }
    if (kind === "forward" || kind === "backward") {
      const i = this.stickers.findIndex((x) => x.id === s.id);
      const j = kind === "forward" ? i + 1 : i - 1;
      if (i >= 0 && j >= 0 && j < this.stickers.length) {
        const next = this.stickers.slice();
        const tmp = next[i];
        next[i] = next[j];
        next[j] = tmp;
        this.stickers = next;
      }
    }
    this.draw();
    this._changed();
  };

  Easel.prototype.removeSelected = function () {
    if (!this.selectedId) return;
    this.stickers = this.stickers.filter((x) => x.id !== this.selectedId);
    this.selectedId = null;
    this.draw();
    this._changed();
  };

  Easel.prototype.draw = function () {
    const ctx = this.ctx;
    const W = this.canvas.width, H = this.canvas.height;
    const { w, h } = this.cssSize();
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = this.bg;
    ctx.fillRect(0, 0, w, h);

    for (const s of this.stickers) {
      const img = this.images[s.imageId];
      if (!img) continue;
      const { sw, sh } = this.stickerSize(s);
      ctx.save();
      ctx.translate(s.x * w, s.y * h);
      ctx.rotate(s.rot || 0);
      ctx.drawImage(img, -sw / 2, -sh / 2, sw, sh);
      ctx.restore();
    }

    this.drawGrid(ctx, w, h);

    const sel = this.stickers.find((x) => x.id === this.selectedId);
    if (sel && this.images[sel.imageId]) {
      const { sw, sh } = this.stickerSize(sel);
      ctx.save();
      ctx.translate(sel.x * w, sel.y * h);
      ctx.rotate(sel.rot || 0);
      ctx.strokeStyle = "#d4552b";
      ctx.lineWidth = 1.5;
      ctx.setLineDash([5, 4]);
      ctx.strokeRect(-sw / 2, -sh / 2, sw, sh);
      ctx.setLineDash([]);
      const hs = 7;
      const corners = [
        [-sw / 2, -sh / 2], [sw / 2, -sh / 2], [-sw / 2, sh / 2], [sw / 2, sh / 2],
      ];
      ctx.fillStyle = "#f4ece1";
      ctx.strokeStyle = "#d4552b";
      for (const [hx, hy] of corners) {
        ctx.beginPath();
        ctx.rect(hx - hs / 2, hy - hs / 2, hs, hs);
        ctx.fill();
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.moveTo(0, -sh / 2);
      ctx.lineTo(0, -sh / 2 - 28);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(0, -sh / 2 - 28, 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }
  };

  Easel.prototype.drawGrid = function (ctx, w, h) {
    const n = this.gridN || 4;
    ctx.save();
    ctx.strokeStyle = "rgba(42,34,28,0.18)";
    ctx.lineWidth = 1;
    for (let i = 1; i < n; i++) {
      ctx.beginPath();
      ctx.moveTo((w * i) / n, 0);
      ctx.lineTo((w * i) / n, h);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, (h * i) / n);
      ctx.lineTo(w, (h * i) / n);
      ctx.stroke();
    }
    ctx.strokeStyle = "rgba(42,34,28,0.45)";
    ctx.strokeRect(0.5, 0.5, w - 1, h - 1);
    ctx.restore();
  };

  Easel.prototype.exportCanvas = function (size) {
    const out = document.createElement("canvas");
    const long = size || 900;
    if (this.aspect >= 1) {
      out.width = long;
      out.height = Math.round(long / this.aspect);
    } else {
      out.height = long;
      out.width = Math.round(long * this.aspect);
    }
    const ctx = out.getContext("2d");
    ctx.fillStyle = this.bg;
    ctx.fillRect(0, 0, out.width, out.height);
    for (const s of this.stickers) {
      const img = this.images[s.imageId];
      if (!img) continue;
      const nw = img.naturalWidth || img.width;
      const nh = img.naturalHeight || img.height;
      const sw = out.width * (s.scale || 0.3);
      const sh = sw * (nh / nw);
      ctx.save();
      ctx.translate(s.x * out.width, s.y * out.height);
      ctx.rotate(s.rot || 0);
      ctx.drawImage(img, -sw / 2, -sh / 2, sw, sh);
      ctx.restore();
    }
    return out;
  };

  Easel.prototype.cellOfSticker = function (s) {
    const n = this.gridN || 4;
    const col = Math.max(0, Math.min(n - 1, Math.floor(s.x * n)));
    const row = Math.max(0, Math.min(n - 1, Math.floor(s.y * n)));
    return { col, row };
  };

  return Easel;
})();
