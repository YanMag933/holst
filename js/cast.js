window.HolstCast = (function () {
  const PREFIX = "holst10-";
  let peer = null;
  let conns = [];
  let timer = 0;
  let getFrame = null;

  function randomCode() {
    const abc = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
    let s = "";
    for (let i = 0; i < 5; i++) s += abc[Math.floor(Math.random() * abc.length)];
    return s;
  }

  function watchUrl(code) {
    const base = (location.origin + location.pathname).replace(/index\.html$/i, "");
    return base + "#watch/" + code;
  }

  function loadScript(src) {
    return new Promise((res, rej) => {
      const s = document.createElement("script");
      s.src = src;
      s.onload = res;
      s.onerror = rej;
      document.head.appendChild(s);
    });
  }

  async function loadPeer() {
    if (window.Peer) return window.Peer;
    await loadScript("https://unpkg.com/peerjs@1.5.4/dist/peerjs.min.js");
    if (!window.Peer) throw new Error("peerjs");
    return window.Peer;
  }

  async function qrDataUrl(text) {
    try {
      const mod = await import("https://cdn.jsdelivr.net/npm/qrcode@1.5.3/+esm");
      const fn = mod.toDataURL || (mod.default && mod.default.toDataURL);
      return await fn(text, {
        margin: 1,
        width: 240,
        color: { dark: "#140f0a", light: "#f2e6d2" },
      });
    } catch (e) {
      return "";
    }
  }

  let guest = null;

  function stopJoin() {
    if (guest) {
      try { guest.destroy(); } catch (e) {}
      guest = null;
    }
  }

  function stopHost() {
    if (timer) {
      clearInterval(timer);
      timer = 0;
    }
    conns.forEach((c) => {
      try { c.close(); } catch (e) {}
    });
    conns = [];
    if (peer) {
      try { peer.destroy(); } catch (e) {}
      peer = null;
    }
    getFrame = null;
  }

  function sendAll() {
    if (!getFrame || !conns.length) return;
    const cv = getFrame();
    if (!cv) return;
    const max = 1400;
    let src = cv;
    const sc = Math.min(1, max / Math.max(cv.width, cv.height, 1));
    if (sc < 1) {
      const t = document.createElement("canvas");
      t.width = Math.max(2, Math.round(cv.width * sc));
      t.height = Math.max(2, Math.round(cv.height * sc));
      const ctx = t.getContext("2d");
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(cv, 0, 0, t.width, t.height);
      src = t;
    }
    src.toBlob((blob) => {
      if (!blob) return;
      blob.arrayBuffer().then((buf) => {
        conns.forEach((c) => {
          try { if (c.open) c.send(buf); } catch (e) {}
        });
      });
    }, "image/jpeg", 0.78);
  }

  async function host(opts) {
    stopHost();
    getFrame = opts.getFrame;
    const Peer = await loadPeer();
    const short = opts.code || randomCode();
    const id = PREFIX + short;
    peer = new Peer(id, { debug: 0 });
    return await new Promise((resolve, reject) => {
      let done = false;
      const fail = (e) => {
        if (done) return;
        done = true;
        stopHost();
        reject(e || new Error("peer"));
      };
      const t = setTimeout(() => fail(new Error("timeout")), 14000);
      peer.on("error", fail);
      peer.on("open", async () => {
        if (done) return;
        done = true;
        clearTimeout(t);
        peer.on("connection", (conn) => {
          conn.on("open", () => {
            if (!conns.includes(conn)) conns.push(conn);
            if (opts.onViewers) opts.onViewers(conns.length);
            sendAll();
          });
          conn.on("close", () => {
            conns = conns.filter((x) => x !== conn);
            if (opts.onViewers) opts.onViewers(conns.length);
          });
        });
        const url = watchUrl(short);
        const qr = await qrDataUrl(url);
        timer = setInterval(sendAll, 1100);
        resolve({ code: short, url, qr, id });
      });
    });
  }

  function poke() {
    sendAll();
  }

  async function join(short, onFrame, onStatus) {
    stopJoin();
    const Peer = await loadPeer();
    const me = new Peer();
    guest = me;
    return await new Promise((resolve, reject) => {
      let done = false;
      const fail = (e) => {
        if (done) return;
        done = true;
        try { me.destroy(); } catch (err) {}
        if (guest === me) guest = null;
        reject(e || new Error("join"));
      };
      const t = setTimeout(() => fail(new Error("timeout")), 16000);
      me.on("error", fail);
      me.on("open", () => {
        const conn = me.connect(PREFIX + String(short).toUpperCase(), { reliable: true });
        conn.on("error", fail);
        conn.on("open", () => {
          if (done) return;
          done = true;
          clearTimeout(t);
          if (onStatus) onStatus("connected");
          resolve({ conn, peer: me });
        });
        conn.on("data", (data) => {
          if (onFrame) onFrame(data);
        });
      });
    });
  }

  return { host, stopHost, poke, join, stopJoin, watchUrl, randomCode };
})();
