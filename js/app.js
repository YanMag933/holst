(function () {
  "use strict";

  const VER = "19";
  const SIZES = [
    [20, 30], [30, 40], [40, 50], [50, 50], [50, 70], [60, 80],
  ];
  const AMOUNTS = [
    { id: "full", label: "полный тюбик" },
    { id: "half", label: "половина" },
    { id: "little", label: "мало" },
    { id: "drop", label: "чуть-чуть" },
  ];
  const MEDIA = [
    { id: "oil", label: "масло" },
    { id: "acrylic", label: "акрил" },
    { id: "gouache", label: "гуашь" },
    { id: "watercolor", label: "акварель" },
  ];

  let state = emptyState();
  let urls = {};
  let easel = null;
  let camLive = false;
  let exportShot = null;
  let arSession = null;
  let camOnResize = null;
  let deferredPrompt = null;
  let cutImg = null;
  let photoImg = null;
  let filmGen = 0;
  const MAX_REFS = 3;

  const app = document.getElementById("app");
  const topbar = document.getElementById("topbar");
  const nav = document.getElementById("nav");
  const modal = document.getElementById("modal");

  function emptyState() {
    return {
      version: 1,
      tab: "home",
      activeId: null,
      calibrate: null,
      overlayOpacity: 0.28,
      arMode: "pin",
      arPinCorners: null,
      projects: [],
      ui: {},
    };
  }

  function arModeId() {
    return state.arMode === "space" ? "space" : "pin";
  }

  function arModeLabel(id) {
    return id === "space" ? "Комната (нужен Google)" : "Углы";
  }

  async function roomArAvailable() {
    try {
      return !!(window.HolstAR && (await HolstAR.xrSupported()));
    } catch (e) {
      return false;
    }
  }

  function esc(s) {
    return String(s || "").replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    }[c]));
  }

  function uid(p) { return HolstDB.uid(p); }

  function current() {
    return state.projects.find((p) => p.id === state.activeId) || null;
  }

  function canvasLongPx(widthCm, heightCm) {
    // ~100 px/cm so close-up AR / camera overlay stays sharp on phone screens
    const longCm = Math.max(widthCm || 40, heightCm || 50);
    return Math.round(Math.min(4096, Math.max(2400, longCm * 100)));
  }

  function projectZoom(p) {
    if (p.zoom && p.zoom.kind) return p.zoom;
    if (p.zoomCell) return { kind: "cell", col: p.zoomCell.col, row: p.zoomCell.row };
    return { kind: "full", col: 0, row: 0 };
  }

  function setProjectZoom(p, zoom) {
    p.zoom = zoom || { kind: "full", col: 0, row: 0 };
    p.zoomCell = p.zoom.kind === "cell" ? { col: p.zoom.col, row: p.zoom.row } : null;
    if (easel) easel.setView(p.zoom);
    if (window.HolstCast) HolstCast.poke();
  }

  function zoomFromTap(p, col, row) {
    const z = projectZoom(p);
    const n = p.gridN || 4;
    if (!z.kind || z.kind === "full") {
      const b = Easel.blockOf(col, row, n);
      return { kind: "quad", col: b.col, row: b.row };
    }
    if (z.kind === "quad") return { kind: "cell", col, row };
    return { kind: "full", col, row };
  }

  function zoomKindTarget(p, kind) {
    const n = p.gridN || 4;
    const z = projectZoom(p);
    let col = z.col || 0;
    let row = z.row || 0;
    if (easel && easel.selectedId) {
      const s = easel.stickers.find((x) => x.id === easel.selectedId);
      if (s) {
        const c = easel.cellOfSticker(s);
        col = c.col;
        row = c.row;
      }
    }
    if (kind === "full") return { kind: "full", col, row };
    if (kind === "quad") {
      const b = Easel.blockOf(col, row, n);
      return { kind: "quad", col: b.col, row: b.row };
    }
    return { kind: "cell", col, row };
  }

  function zoomBarHtml(p) {
    const k = projectZoom(p).kind || "full";
    return `
      <div class="zoom-bar" id="zoom-bar">
        <button type="button" class="btn ghost row ${k === "full" ? "on" : ""}" data-zoom="full">весь холст</button>
        <button type="button" class="btn ghost row ${k === "quad" ? "on" : ""}" data-zoom="quad">4 клетки</button>
        <button type="button" class="btn ghost row ${k === "cell" ? "on" : ""}" data-zoom="cell">1 клетка</button>
      </div>`;
  }

  function cropExport(src, p) {
    if (!src) return null;
    const rect = Easel.viewRect(projectZoom(p), p.gridN || 4);
    const c = document.createElement("canvas");
    c.width = Math.max(2, Math.round(src.width * rect.w));
    c.height = Math.max(2, Math.round(src.height * rect.h));
    const ctx = c.getContext("2d");
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(
      src,
      rect.x * src.width, rect.y * src.height,
      src.width * rect.w, src.height * rect.h,
      0, 0, c.width, c.height
    );
    return c;
  }

  function cloneStickers(stickers) {
    return (stickers || []).map((s) => ({
      id: s.id,
      imageId: s.imageId,
      x: s.x,
      y: s.y,
      scale: s.scale,
      rot: s.rot,
      name: s.name,
    }));
  }

  function ensureLayouts(p) {
    if (!Array.isArray(p.layouts)) p.layouts = [];
  }

  function layoutThumb() {
    if (!easel || !easel.canvas || !easel.canvas.isConnected) return "";
    try {
      return easel.exportCanvas(140).toDataURL("image/jpeg", 0.55);
    } catch (e) {
      return "";
    }
  }

  function saveLayout(p, name, updateId) {
    ensureLayouts(p);
    const stickers = cloneStickers(easel ? easel.stickers : p.stickers);
    const thumb = layoutThumb();
    if (updateId) {
      const L = p.layouts.find((x) => x.id === updateId);
      if (L) {
        L.stickers = stickers;
        L.thumb = thumb || L.thumb;
        L.savedAt = Date.now();
        if (name) L.name = name;
        p.activeLayoutId = L.id;
        p.stickers = stickers;
        return L;
      }
    }
    const layout = {
      id: uid("l"),
      name: (name || "").trim() || ("Вариант " + (p.layouts.length + 1)),
      stickers,
      thumb,
      savedAt: Date.now(),
    };
    p.layouts.push(layout);
    p.activeLayoutId = layout.id;
    p.stickers = stickers;
    return layout;
  }

  async function applyLayout(p, id) {
    ensureLayouts(p);
    const L = p.layouts.find((x) => x.id === id);
    if (!L) return;
    p.stickers = cloneStickers(L.stickers);
    p.activeLayoutId = L.id;
    p.analysis = null;
    exportShot = null;
    save();
    if (easel) {
      easel.stickers = p.stickers;
      easel.selectedId = null;
      for (const s of p.stickers) {
        const url = await fileUrl("cut:" + s.imageId);
        if (url) easel.setImage(s.imageId, await loadImage(url));
      }
      easel.draw();
    }
    fillLayouts(p);
  }

  function toast(msg) {
    let el = document.getElementById("toast");
    if (!el) {
      el = document.createElement("div");
      el.id = "toast";
      el.className = "toast";
      document.body.appendChild(el);
    }
    el.textContent = msg;
    el.classList.add("show");
    clearTimeout(toast._t);
    toast._t = setTimeout(() => el.classList.remove("show"), 1800);
  }

  function save() {
    HolstDB.saveState(state).catch(() => {});
  }

  function setTab(tab) {
    if (tab !== "camera") stopCam();
    state.tab = tab;
    if (tab === "home") state.activeId = state.activeId;
    save();
    render();
  }

  function openProject(id) {
    state.activeId = id;
    state.tab = "paints";
    state.ui = {};
    save();
    render();
  }

  async function rememberUrl(key, blob) {
    if (urls[key]) URL.revokeObjectURL(urls[key]);
    urls[key] = HolstDB.blobUrl(blob);
    return urls[key];
  }

  async function fileUrl(key) {
    if (urls[key]) return urls[key];
    const blob = await HolstDB.getFile(key);
    if (!blob) return "";
    return rememberUrl(key, blob);
  }

  function loadImage(url) {
    return new Promise((res, rej) => {
      const img = new Image();
      img.onload = () => res(img);
      img.onerror = rej;
      img.src = url;
    });
  }

  async function ingestImage(file) {
    let bmp = null;
    if (typeof createImageBitmap === "function") {
      try {
        bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
      } catch (e) {
        try { bmp = await createImageBitmap(file); } catch (e2) {}
      }
    }
    const canvas = document.createElement("canvas");
    let w, h, paint;
    if (bmp) {
      w = bmp.width;
      h = bmp.height;
      paint = (ctx, dw, dh) => ctx.drawImage(bmp, 0, 0, dw, dh);
    } else {
      const tmp = URL.createObjectURL(file);
      try {
        const img = await loadImage(tmp);
        w = img.naturalWidth;
        h = img.naturalHeight;
        paint = (ctx, dw, dh) => ctx.drawImage(img, 0, 0, dw, dh);
      } finally {
        URL.revokeObjectURL(tmp);
      }
    }
    const scale = Math.min(1, 3200 / Math.max(w, 1));
    canvas.width = Math.max(1, Math.round(w * scale));
    canvas.height = Math.max(1, Math.round(h * scale));
    const ctx = canvas.getContext("2d");
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    paint(ctx, canvas.width, canvas.height);
    if (bmp && bmp.close) bmp.close();
    const blob = await new Promise((res) => canvas.toBlob((b) => res(b || file), "image/jpeg", 0.92));
    return blob;
  }

  async function forgetFile(key) {
    if (urls[key]) {
      URL.revokeObjectURL(urls[key]);
      delete urls[key];
    }
    await HolstDB.delFile(key).catch(() => {});
  }

  async function pruneRefs(p) {
    while (p.refs.length > MAX_REFS) {
      const old = p.refs.shift();
      await forgetFile("ref:" + old.id);
    }
  }

  function amountLabel(id) {
    return (AMOUNTS.find((a) => a.id === id) || AMOUNTS[0]).label;
  }

  function mediumLabel(id) {
    return (MEDIA.find((m) => m.id === id) || MEDIA[0]).label;
  }

  function svgNav(d) {
    return `<svg viewBox="0 0 24 24"><path d="${d}"/></svg>`;
  }

  function renderTop(title, sub, back) {
    const home = state.tab === "home" && !back;
    if (home) {
      topbar.innerHTML = `
        <div class="brand-lockup">
          <img class="brand-mark" src="icons/icon-192.png" alt="" />
          <div>
            <p class="eyebrow">ателье</p>
            <h1>Холст</h1>
          </div>
        </div>
        <button type="button" class="icon-btn" id="go-howto" aria-label="Справка">i</button>
      `;
      document.getElementById("go-howto").onclick = () => { state.tab = "howto"; render(); };
      return;
    }
    topbar.innerHTML = `
      <div class="row" style="gap:10px;min-width:0">
        ${back ? `<button type="button" class="icon-btn" id="go-back" aria-label="Назад">←</button>` : ""}
        <div style="min-width:0">
          <h1>${esc(title)}</h1>
          ${sub ? `<p class="sub">${esc(sub)}</p>` : ""}
        </div>
      </div>
      <button type="button" class="icon-btn" id="install-mini" title="На телефон" ${canInstallHint() ? "" : "hidden"}>↓</button>
    `;
    const backBtn = document.getElementById("go-back");
    if (backBtn) backBtn.onclick = () => {
      if (state.tab === "paint-edit" || state.tab === "photo") {
        state.tab = "paints";
        render();
        return;
      }
      if (state.tab === "cutout" || state.tab === "new" || state.tab === "howto") {
        state.tab = state.tab === "cutout" ? "compose" : "home";
        if (state.tab === "home") state.activeId = null;
        render();
        return;
      }
      state.tab = "home";
      state.activeId = null;
      stopCam();
      save();
      render();
    };
    const inst = document.getElementById("install-mini");
    if (inst) inst.onclick = installApp;
  }

  function canInstallHint() {
    const standalone = window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone;
    return !standalone;
  }

  function renderNav() {
    const p = current();
    if (!p || ["home", "new", "cutout", "paint-edit", "photo", "howto"].includes(state.tab)) {
      nav.hidden = true;
      return;
    }
    nav.hidden = false;
    const tab = state.tab;
    nav.innerHTML = [
      ["paints", "Краски", "M4 7h16M4 12h16M4 17h10"],
      ["compose", "Холст", "M4 5h16v14H4zM8 9h8"],
      ["steps", "Этапы", "M5 6h14M5 12h10M5 18h7"],
      ["camera", "Камера", "M4 8h4l2-2h4l2 2h4v12H4z"],
    ].map(([id, label, d]) => `
      <button type="button" data-tab="${id}" class="${tab === id ? "active" : ""}">
        ${svgNav(d)}<span>${label}</span>
      </button>
    `).join("");
    nav.querySelectorAll("button").forEach((b) => {
      b.onclick = () => setTab(b.dataset.tab);
    });
  }

  function render() {
    if (watchCode()) return renderWatch(watchCode());
    app.classList.toggle("camera-mode", state.tab === "camera");
    app.classList.remove("watch-mode");
    modal.hidden = true;
    modal.innerHTML = "";
    renderNav();
    const p = current();
    if (state.tab === "home") return renderHome();
    if (state.tab === "howto") return renderHowTo();
    if (state.tab === "new") return renderNew();
    if (!p) { state.tab = "home"; return renderHome(); }
    if (state.tab === "paints") return renderPaints(p);
    if (state.tab === "paint-edit") return renderPaintEdit(p);
    if (state.tab === "photo") return renderPhoto(p);
    if (state.tab === "compose") return renderCompose(p);
    if (state.tab === "cutout") return renderCutout(p);
    if (state.tab === "steps") return renderSteps(p);
    if (state.tab === "camera") return renderCamera(p);
    renderHome();
  }

  function renderHome() {
    renderTop("Холст", "ателье на телефоне");
    const standalone = window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone;
    const list = state.projects.map((p) => {
      const layouts = p.layouts || [];
      const thumb = (layouts.find((x) => x.id === p.activeLayoutId) || layouts[layouts.length - 1] || {}).thumb || "";
      return `
      <button type="button" class="card project-card" data-open="${esc(p.id)}">
        <div class="thumb" style="background:${esc(p.bg || "#E8DCC8")}">${thumb ? `<img src="${esc(thumb)}" alt=""/>` : ""}</div>
        <div>
          <strong>${esc(p.name)}</strong>
          <div class="muted">${p.widthCm}×${p.heightCm} см · ${esc(mediumLabel(p.medium))} · ${p.paints.length} красок${layouts.length ? " · " + layouts.length + " вар." : ""}</div>
        </div>
        <span class="muted">→</span>
      </button>`;
    }).join("");
    app.innerHTML = `
      ${!standalone ? `
      <div class="install-banner">
        <div class="grow">
          <p class="eyebrow">в кармане</p>
          <strong>На домашний экран</strong>
          <div class="tiny">Камера, краски и холст остаются в телефоне — компьютер больше не нужен.</div>
        </div>
        <button type="button" class="btn row" id="install-btn">Установить</button>
      </div>` : ""}
      <div class="hero">
        <p class="eyebrow">мастерская</p>
        <p>Собери натюрморт из референсов. Холст узнает каждый предмет, разложит письмо по этапам ателье и смеси из твоих тюбиков.</p>
      </div>
      ${list ? `<p class="field">Картины</p>${list}` : `<div class="empty">Пока нет картин. Создай первую — размер холста и краски.</div>`}
      <div class="stack">
        <button type="button" class="btn" id="new-project">Новая картина</button>
        <button type="button" class="btn ghost" id="open-howto">Цвета и установка</button>
      </div>
      <div class="card update-card" style="margin-top:18px">
        <p class="eyebrow">приложение</p>
        <h3>Обновить Холст</h3>
        <p class="tiny">Скачает новую версию с сайта. Картины, краски и референсы не пропадут.</p>
        <button type="button" class="btn gold" id="update-app">Обновить приложение</button>
      </div>
    `;
    app.querySelectorAll("[data-open]").forEach((b) => b.onclick = () => openProject(b.dataset.open));
    document.getElementById("new-project").onclick = () => { state.tab = "new"; render(); };
    document.getElementById("open-howto").onclick = () => { state.tab = "howto"; render(); };
    const ib = document.getElementById("install-btn");
    if (ib) ib.onclick = installApp;
    bindUpdate();
  }

  function renderHowTo() {
    renderTop("Ателье", "установка и цвета", true);
    app.innerHTML = `
      <div class="card update-card">
        <p class="eyebrow">приложение</p>
        <h3>Обновить Холст</h3>
        <p class="muted">Нажми — приложение само снимет старый кэш и скачает новую версию. Твои картины останутся.</p>
        <button type="button" class="btn gold" id="update-app" style="margin-top:12px">Обновить приложение</button>
      </div>
      <div class="card">
        <h3>На телефон</h3>
        <p class="muted">1. Открой ссылку в Safari или Chrome.<br>
        2. iPhone: Поделиться → На экран «Домой».<br>
        3. Android: меню → Установить приложение.<br>
        4. Дальше запускай иконку «Холст» — без компьютера и можно без интернета.</p>
      </div>
      <div class="card">
        <h3>Привязка к холсту</h3>
        <p class="muted">В камере тапни 4 угла реального холста — картина ляжет поверх. Работает на любом телефоне, без магазинов и расширений.</p>
        <p class="tiny" style="margin-top:10px">Режим «картинка висит в комнате и не съезжает, когда ходишь» на Android возможен только через сервисы Google (ARCore) и Play Маркет. Без Play Маркета этого режима нет — ни вшить, ни скачать отдельно нельзя. Пользуйся привязкой по углам.</p>
      </div>
      <div class="card">
        <h3>Другой экран</h3>
        <p class="muted">На холсте или в камере нажми «Показать на телевизоре». Открой код на компьютере или Smart TV в браузере — оба в одном Wi‑Fi. Интернет нужен на пару секунд, дальше картина идёт с телефона. Если не находится: транслируй экран телефона как обычно (AirPlay, Google Cast, Smart View) или HDMI.</p>
      </div>
      <div class="card">
        <h3>Порядок письма</h3>
        <p class="muted">Так пишут в ателье и в классическом натюрморте. 1) Имприматура — тонкий общий тон, чтобы белый грунт не слепил. 2) Рисунок пятнами: все силуэты сразу, масштаб по сетке. 3) Большие тени всей сцены — картина должна читаться как свет/тьма ещё без цвета. 4) Даль и фон широкой кистью — раньше ближнего плана. 5) Каждый предмет отдельно, от дальнего к ближнему: силуэт → тень → локальный цвет → свет. 6) Связка краёв и блики — в самом конце, жирнее и меньше. Деталь, написанная раньше больших отношений, обычно портит картину.</p>
      </div>
      <div class="card">
        <h3>Как мешать</h3>
        <p class="muted">Мешай на палитре, не на холсте. Сначала цвет (красный, жёлтый, синий), потом сила цвета: если слишком ядовитый — капля противоположного (к зелёному красный, к оранжевому синий). Светлоту правят в конце: белила по капле, темнение — умброй или синим, не сразу чёрной. Тень без белил, иначе молоко. Свет: белила последними и мало. Больше трёх красок в одной кучке — почти всегда грязь. Масло: снизу жиже, сверху жирнее. Акварель наоборот — от светлого к тёмному, свет это бумага.</p>
      </div>
      <div class="card">
        <h3>Как задать цвет краски</h3>
        <p class="muted"><b>Лучше название с тюбика.</b> Пиши «ультрамарин», «охра светлая», «белила титановые». Цвет появится сразу — подкрути, если мазок в жизни чуть другой.</p>
        <p class="muted"><b>Фото — запасной путь.</b> Не снимай этикетку. Выдави мазок на белую бумагу у окна, днём, без блика, ткни в центр.</p>
      </div>
      <button type="button" class="btn ghost" id="to-home">К картинам</button>
    `;
    document.getElementById("to-home").onclick = () => { state.tab = "home"; render(); };
    bindUpdate();
  }

  function renderNew() {
    renderTop("Новая картина", "размер и материал", true);
    app.innerHTML = `
      <label class="field">Название
        <input id="np-name" maxlength="60" placeholder="Натюрморт с яблоком" />
      </label>
      <div class="field" style="margin-top:12px">Размер холста, см</div>
      <div class="chips" id="size-chips">
        ${SIZES.map(([w, h]) => `<button type="button" class="chip" data-w="${w}" data-h="${h}">${w}×${h}</button>`).join("")}
        <button type="button" class="chip" data-w="custom">свой</button>
      </div>
      <div class="row" style="margin:10px 0 14px">
        <label class="field grow">Ширина<input id="np-w" type="number" inputmode="decimal" value="40" /></label>
        <label class="field grow">Высота<input id="np-h" type="number" inputmode="decimal" value="50" /></label>
      </div>
      <div class="field">Материал</div>
      <div class="chips" id="med-chips">
        ${MEDIA.map((m, i) => `<button type="button" class="chip ${i === 0 ? "on" : ""}" data-m="${m.id}">${m.label}</button>`).join("")}
      </div>
      <label class="field" style="margin-top:14px">Цвет грунта холста
        <input id="np-bg" type="color" value="#E8DCC8" style="height:46px;padding:4px" />
      </label>
      <div class="stack" style="margin-top:18px">
        <button type="button" class="btn" id="np-go">Создать</button>
      </div>
    `;
    let medium = "oil";
    document.querySelectorAll("#size-chips .chip").forEach((c) => {
      c.onclick = () => {
        document.querySelectorAll("#size-chips .chip").forEach((x) => x.classList.remove("on"));
        c.classList.add("on");
        if (c.dataset.w !== "custom") {
          document.getElementById("np-w").value = c.dataset.w;
          document.getElementById("np-h").value = c.dataset.h;
        }
      };
    });
    document.querySelectorAll("#med-chips .chip").forEach((c) => {
      c.onclick = () => {
        document.querySelectorAll("#med-chips .chip").forEach((x) => x.classList.remove("on"));
        c.classList.add("on");
        medium = c.dataset.m;
      };
    });
    document.querySelector('#size-chips [data-w="40"]').classList.add("on");
    document.getElementById("np-go").onclick = () => {
      const name = document.getElementById("np-name").value.trim() || "Без названия";
      const widthCm = Math.max(5, Number(document.getElementById("np-w").value) || 40);
      const heightCm = Math.max(5, Number(document.getElementById("np-h").value) || 50);
      const project = {
        id: uid("p"),
        name,
        widthCm,
        heightCm,
        medium,
        bg: document.getElementById("np-bg").value,
        gridN: 4,
        paints: [],
        refs: [],
        cutouts: [],
        stickers: [],
        analysis: null,
        stepIndex: 0,
        zoomCell: null,
        zoom: { kind: "full", col: 0, row: 0 },
        layouts: [],
        activeLayoutId: null,
        createdAt: Date.now(),
      };
      state.projects.unshift(project);
      openProject(project.id);
    };
  }

  function renderPaints(p) {
    renderTop(p.name, `${p.widthCm}×${p.heightCm} см · ${mediumLabel(p.medium)}`);
    const rows = p.paints.map((t) => `
      <button type="button" class="paint-row" data-edit="${esc(t.id)}" style="margin:8px 0">
        <span class="swatch" style="background:${esc(t.hex)}"></span>
        <span>
          <strong>${esc(t.name)}</strong>
          <div class="tiny">${esc(t.hex)} · ${esc(amountLabel(t.amount))}</div>
        </span>
        <span class="muted">править</span>
      </button>
    `).join("");
    app.innerHTML = `
      <div class="hint">Пиши название с тюбика — цвет подставится сразу. Потом подкрути, если мазок в жизни чуть другой. Этикетку лучше не фотографировать.</div>
      <label class="field">Добавить краску
        <input id="paint-q" placeholder="ультрамарин, охра светлая…" autocomplete="off" />
      </label>
      <div id="paint-hits" class="card" style="margin-top:8px" hidden></div>
      <div class="row" style="margin:10px 0 14px">
        <button type="button" class="btn ghost" id="add-custom">Свой цвет</button>
        <button type="button" class="btn ghost" id="add-photo">Фото мазка</button>
      </div>
      ${rows || `<div class="empty">Пока нет тюбиков. Без них не из чего мешать оттенки.</div>`}
    `;
    const q = document.getElementById("paint-q");
    const hits = document.getElementById("paint-hits");
    q.addEventListener("input", () => {
      const found = PaintCatalog.search(q.value, 8);
      if (!q.value.trim()) { hits.hidden = true; return; }
      hits.hidden = false;
        hits.innerHTML = found.map((c) => `
        <button type="button" class="search-hit" data-cat="${esc(c.id)}">
          <span class="swatch" style="background:${esc(c.hex)}"></span>
          <span>
            <strong>${esc(c.name)}</strong>
            <div class="tiny">нажми — добавим, цвет можно поправить</div>
          </span>
        </button>
      `).join("") || `<div class="muted">Нет в каталоге — нажми «Свой цвет» и поправь вручную.</div>`;
      hits.querySelectorAll("[data-cat]").forEach((b) => {
        b.onclick = () => {
          const cat = PaintCatalog.byId(b.dataset.cat);
          addPaint(p, { name: cat.name, hex: cat.hex, catalogId: cat.id, amount: "full" });
        };
      });
    });
    app.querySelectorAll("[data-edit]").forEach((b) => {
      b.onclick = () => {
        state.ui.paintId = b.dataset.edit;
        state.tab = "paint-edit";
        render();
      };
    });
    document.getElementById("add-custom").onclick = () => {
      addPaint(p, { name: q.value.trim() || "Свой цвет", hex: "#8899AA", amount: "full" });
    };
    document.getElementById("add-photo").onclick = () => {
      state.ui.paintId = null;
      state.tab = "photo";
      render();
    };
  }

  function addPaint(p, data) {
    const paint = { id: uid("t"), name: data.name, hex: data.hex, amount: data.amount || "full", catalogId: data.catalogId || "" };
    p.paints.push(paint);
    p.analysis = null;
    state.ui.paintId = paint.id;
    state.tab = "paint-edit";
    save();
    render();
  }

  function renderPaintEdit(p) {
    const t = p.paints.find((x) => x.id === state.ui.paintId);
    if (!t) { state.tab = "paints"; return renderPaints(p); }
    renderTop("Цвет тюбика", "поправь, если свотч не совпал", true);
    const hsl = ColorKit.rgbToHsl(...Object.values(ColorKit.hexToRgb(t.hex)));
    app.innerHTML = `
      <div class="card" style="text-align:center">
        <div class="swatch" id="live-swatch" style="width:100%;height:120px;border-radius:16px;background:${esc(t.hex)}"></div>
        <div style="margin-top:8px"><strong id="live-hex">${esc(t.hex)}</strong></div>
      </div>
      <label class="field">Название<input id="t-name" value="${esc(t.name)}" /></label>
      <div class="hsl" style="margin:12px 0">
        <label>Оттенок<input id="t-h" type="range" min="0" max="360" value="${Math.round(hsl.h)}" /></label>
        <label>Насыщенность<input id="t-s" type="range" min="0" max="100" value="${Math.round(hsl.s)}" /></label>
        <label>Яркость<input id="t-l" type="range" min="0" max="100" value="${Math.round(hsl.l)}" /></label>
      </div>
      <div class="field">Сколько осталось</div>
      <div class="chips" id="am-chips">
        ${AMOUNTS.map((a) => `<button type="button" class="chip ${t.amount === a.id ? "on" : ""}" data-a="${a.id}">${a.label}</button>`).join("")}
      </div>
      <div class="stack" style="margin-top:16px">
        <button type="button" class="btn ghost" id="t-photo">Сверить по фото мазка</button>
        <button type="button" class="btn" id="t-save">Готово</button>
        <button type="button" class="btn danger" id="t-del">Удалить</button>
      </div>
    `;
    function applyHsl() {
      const rgb = ColorKit.hslToRgb(
        Number(document.getElementById("t-h").value),
        Number(document.getElementById("t-s").value),
        Number(document.getElementById("t-l").value)
      );
      t.hex = ColorKit.rgbToHex(rgb.r, rgb.g, rgb.b);
      document.getElementById("live-swatch").style.background = t.hex;
      document.getElementById("live-hex").textContent = t.hex;
      p.analysis = null;
    }
    ["t-h", "t-s", "t-l"].forEach((id) => document.getElementById(id).oninput = applyHsl);
    document.getElementById("am-chips").onclick = (e) => {
      const b = e.target.closest("[data-a]");
      if (!b) return;
      t.amount = b.dataset.a;
      document.querySelectorAll("#am-chips .chip").forEach((x) => x.classList.toggle("on", x === b));
    };
    document.getElementById("t-save").onclick = () => {
      t.name = document.getElementById("t-name").value.trim() || t.name;
      state.tab = "paints";
      save();
      render();
    };
    document.getElementById("t-del").onclick = () => {
      p.paints = p.paints.filter((x) => x.id !== t.id);
      state.tab = "paints";
      save();
      render();
    };
    document.getElementById("t-photo").onclick = () => {
      state.tab = "photo";
      render();
    };
  }

  function renderPhoto(p) {
    renderTop("Фото мазка", "сними бумагу у окна", true);
    app.innerHTML = `
      <div class="hint">Выдави краску на белый лист при дневном свете. Нажми в центр мазка — возьмём средний цвет, не блик.</div>
      <input id="photo-file" type="file" accept="image/*" capture="environment" hidden />
      <button type="button" class="btn" id="photo-take">Снять или выбрать фото</button>
      <div class="photo-pick" id="photo-stage" hidden style="margin-top:12px">
        <canvas id="photo-cv"></canvas>
      </div>
      <div id="photo-res" hidden class="card" style="margin-top:12px;text-align:center">
        <div class="swatch" id="photo-sw" style="width:100%;height:70px;border-radius:14px"></div>
        <p class="muted" id="photo-hex"></p>
        <button type="button" class="btn" id="photo-use">Взять этот цвет</button>
      </div>
    `;
    const file = document.getElementById("photo-file");
    document.getElementById("photo-take").onclick = () => file.click();
    file.onchange = async () => {
      const f = file.files && file.files[0];
      if (!f) return;
      const url = URL.createObjectURL(f);
      photoImg = await loadImage(url);
      const cv = document.getElementById("photo-cv");
      const stage = document.getElementById("photo-stage");
      stage.hidden = false;
      const maxW = stage.clientWidth || 320;
      const sc = maxW / photoImg.width;
      cv.width = Math.round(photoImg.width * sc);
      cv.height = Math.round(photoImg.height * sc);
      cv.getContext("2d").drawImage(photoImg, 0, 0, cv.width, cv.height);
      cv.onclick = (e) => {
        const r = cv.getBoundingClientRect();
        const x = ((e.clientX - r.left) / r.width) * cv.width;
        const y = ((e.clientY - r.top) / r.height) * cv.height;
        const hex = sampleAvg(cv, x, y, 8);
        document.getElementById("photo-res").hidden = false;
        document.getElementById("photo-sw").style.background = hex;
        document.getElementById("photo-hex").textContent = hex;
        document.getElementById("photo-use").onclick = () => {
          if (state.ui.paintId) {
            const t = p.paints.find((x) => x.id === state.ui.paintId);
            if (t) t.hex = hex;
            state.tab = "paint-edit";
          } else {
            addPaint(p, { name: "С фото мазка", hex, amount: "full" });
            return;
          }
          p.analysis = null;
          save();
          render();
        };
      };
    };
  }

  function sampleAvg(cv, x, y, rad) {
    const ctx = cv.getContext("2d");
    const rx = Math.max(0, Math.round(x - rad));
    const ry = Math.max(0, Math.round(y - rad));
    const rw = Math.min(cv.width - rx, rad * 2);
    const rh = Math.min(cv.height - ry, rad * 2);
    const data = ctx.getImageData(rx, ry, rw, rh).data;
    let r = 0, g = 0, b = 0, n = 0;
    for (let i = 0; i < data.length; i += 4) {
      const lum = data[i] + data[i + 1] + data[i + 2];
      if (lum > 740) continue;
      r += data[i]; g += data[i + 1]; b += data[i + 2]; n++;
    }
    if (!n) return "#CCCCCC";
    return ColorKit.rgbToHex(r / n, g / n, b / n);
  }

  async function renderCompose(p) {
    renderTop("Постановка", "предметы и варианты композиции");
    app.innerHTML = `
      <div class="field">Референсы — не больше трёх, старые стираются</div>
      <div class="film" id="ref-film"></div>
      <div class="row" style="margin-bottom:12px">
        <button type="button" class="btn ghost" id="add-ref">+ Картинка</button>
      </div>
      <input id="ref-file" type="file" accept="image/*" hidden />
      <div class="field">Вырезанные предметы — нажми, чтобы положить на холст</div>
      <div class="film" id="cut-film"></div>
      <div class="easel-wrap" id="easel-wrap"><canvas id="easel"></canvas></div>
      ${zoomBarHtml(p)}
      <p class="tiny" style="margin:0 0 10px">Коснись клетки — сначала 4 квадрата, ещё раз — один.</p>
      <div class="field">Варианты композиции</div>
      <div class="film" id="layout-film"></div>
      <div class="row wrap" style="margin-bottom:12px">
        <button type="button" class="btn ghost row" id="save-layout">Сохранить вариант</button>
        <button type="button" class="btn ghost row" id="update-layout">Обновить этот</button>
      </div>
      <div class="row wrap" style="margin-top:10px">
        <button type="button" class="btn ghost row" data-nudge="scale-up">крупнее</button>
        <button type="button" class="btn ghost row" data-nudge="scale-down">мельче</button>
        <button type="button" class="btn ghost row" data-nudge="rot-left">↺</button>
        <button type="button" class="btn ghost row" data-nudge="rot-right">↻</button>
        <button type="button" class="btn ghost row" data-nudge="back">назад</button>
        <button type="button" class="btn ghost row" data-nudge="front">вперёд</button>
      </div>
      <button type="button" class="btn danger" id="del-sticker" style="margin-top:10px">Удалить объект с холста</button>
      <p class="tiny" id="del-hint" style="margin:8px 0 10px">Зажми предмет — слой вперёд или назад. Нажми, потом «Удалить». Размер меняется равномерно.</p>
      <button type="button" class="btn ghost" id="cast-screen" style="margin-top:10px">Показать на телевизоре / компьютере</button>
      <label class="field">Сетка
        <select id="grid-n">
          ${[3, 4, 5, 6, 8].map((n) => `<option value="${n}" ${p.gridN === n ? "selected" : ""}>${n}×${n}</option>`).join("")}
        </select>
      </label>
    `;
    await pruneRefs(p);
    await fillFilms(p);
    document.getElementById("add-ref").onclick = () => document.getElementById("ref-file").click();
    document.getElementById("ref-file").onchange = async (e) => {
      const input = e.target;
      const file = input.files && input.files[0];
      input.value = "";
      if (!file) return;
      const named = /\.(jpe?g|png|webp|heic|heif|gif|bmp)$/i.test(file.name || "");
      if (file.type && !file.type.startsWith("image") && !named) return;
      const blob = await ingestImage(file);
      const id = uid("r");
      await HolstDB.putFile("ref:" + id, blob);
      p.refs.push({ id, name: file.name || "референс" });
      await pruneRefs(p);
      save();
      render();
    };
    document.getElementById("grid-n").onchange = (e) => {
      p.gridN = Number(e.target.value);
      if (easel) { easel.gridN = p.gridN; easel.draw(); }
      save();
    };
    const zoomBar = document.getElementById("zoom-bar");
    if (zoomBar) {
      zoomBar.querySelectorAll("[data-zoom]").forEach((b) => {
        b.onclick = () => {
          setProjectZoom(p, zoomKindTarget(p, b.dataset.zoom));
          save();
          zoomBar.querySelectorAll("[data-zoom]").forEach((x) => {
            x.classList.toggle("on", x.dataset.zoom === projectZoom(p).kind);
          });
        };
      });
    }
    const castBtn = document.getElementById("cast-screen");
    if (castBtn) castBtn.onclick = () => openCastSheet(p);
    app.querySelectorAll("[data-nudge]").forEach((b) => {
      b.onclick = () => easel && easel.nudge(b.dataset.nudge);
    });
    document.getElementById("del-sticker").onclick = () => {
      const hint = document.getElementById("del-hint");
      if (!easel) return;
      if (!easel.selectedId) {
        if (!easel.stickers.length) {
          hint.textContent = "На холсте пусто — сначала положи вырезанный предмет.";
          return;
        }
        easel.selectedId = easel.stickers[easel.stickers.length - 1].id;
      }
      easel.removeSelected();
      p.stickers = easel.stickers;
      p.analysis = null;
      save();
      hint.textContent = "Объект снят с холста.";
    };
    document.getElementById("save-layout").onclick = () => openSaveLayoutSheet(p, false);
    document.getElementById("update-layout").onclick = () => {
      ensureLayouts(p);
      if (!p.activeLayoutId || !p.layouts.some((x) => x.id === p.activeLayoutId)) {
        openSaveLayoutSheet(p, true);
        return;
      }
      saveLayout(p, "", p.activeLayoutId);
      p.analysis = null;
      save();
      fillLayouts(p);
      toast("Вариант обновлён");
    };
    mountEasel(p).then(() => fillLayouts(p));
  }

  function fillLayouts(p) {
    ensureLayouts(p);
    const film = document.getElementById("layout-film");
    if (!film) return;
    film.innerHTML = "";
    if (!p.layouts.length) {
      film.innerHTML = `<div class="muted">Разложи предметы и сохрани вариант. Можно сделать несколько постановок и переключаться между ними.</div>`;
      return;
    }
    p.layouts.forEach((L) => {
      const el = document.createElement("div");
      el.className = "film-item layout-item" + (L.id === p.activeLayoutId ? " on" : "");
      el.innerHTML = `
        <button type="button" class="film-open">
          ${L.thumb ? `<img src="${esc(L.thumb)}" alt=""/>` : `<div class="ph">◻</div>`}
          <span>${esc(L.name)}</span>
        </button>
        <button type="button" class="film-x" aria-label="Удалить вариант">×</button>
      `;
      el.querySelector(".film-open").onclick = () => applyLayout(p, L.id);
      el.querySelector(".film-x").onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        p.layouts = p.layouts.filter((x) => x.id !== L.id);
        if (p.activeLayoutId === L.id) p.activeLayoutId = null;
        save();
        fillLayouts(p);
      };
      film.appendChild(el);
    });
  }

  function openSaveLayoutSheet(p, asUpdate) {
    ensureLayouts(p);
    const currentL = p.layouts.find((x) => x.id === p.activeLayoutId);
    const suggested = asUpdate && currentL
      ? currentL.name
      : ("Вариант " + (p.layouts.length + 1));
    modal.hidden = false;
    modal.innerHTML = `
      <div class="sheet" role="dialog" aria-label="Сохранить вариант">
        <div class="grab"></div>
        <h3>${asUpdate ? "Обновить вариант" : "Сохранить вариант"}</h3>
        <p class="tiny">Снимок расстановки на холсте. Потом откроешь любой вариант одним касанием.</p>
        <label class="field">Название
          <input id="layout-name" maxlength="40" value="${esc(suggested)}" />
        </label>
        <div class="stack" style="margin-top:14px">
          <button type="button" class="btn" id="layout-ok">${asUpdate ? "Обновить" : "Сохранить"}</button>
          <button type="button" class="btn ghost" id="layout-cancel">Отмена</button>
        </div>
      </div>
    `;
    modal.onclick = (e) => {
      if (e.target === modal) closeModal();
    };
    const input = document.getElementById("layout-name");
    if (input) {
      input.focus();
      input.select();
    }
    document.getElementById("layout-ok").onclick = (e) => {
      e.stopPropagation();
      const name = (document.getElementById("layout-name").value || "").trim();
      if (asUpdate && currentL) saveLayout(p, name, currentL.id);
      else saveLayout(p, name);
      p.analysis = null;
      save();
      closeModal();
      fillLayouts(p);
      toast(asUpdate ? "Вариант обновлён" : "Вариант сохранён");
    };
    document.getElementById("layout-cancel").onclick = (e) => {
      e.stopPropagation();
      closeModal();
    };
  }

  async function fillFilms(p) {
    const gen = ++filmGen;
    const refFilm = document.getElementById("ref-film");
    const cutFilm = document.getElementById("cut-film");
    if (!refFilm || !cutFilm) return;
    refFilm.innerHTML = "";
    cutFilm.innerHTML = "";
    for (const r of p.refs) {
      const url = await fileUrl("ref:" + r.id);
      if (gen !== filmGen) return;
      const el = document.createElement("div");
      el.className = "film-item";
      el.innerHTML = `
        <button type="button" class="film-open">
          <img src="${esc(url)}" alt=""/>
          <span>вырезать</span>
        </button>
        <button type="button" class="film-x" aria-label="Удалить картинку">×</button>
      `;
      el.querySelector(".film-open").onclick = () => {
        state.ui.refId = r.id;
        state.tab = "cutout";
        save();
        render();
      };
      el.querySelector(".film-x").onclick = async (e) => {
        e.preventDefault();
        e.stopPropagation();
        p.refs = p.refs.filter((x) => x.id !== r.id);
        await forgetFile("ref:" + r.id);
        if (state.ui.refId === r.id) state.ui.refId = null;
        save();
        render();
      };
      refFilm.appendChild(el);
    }
    if (!p.refs.length) {
      refFilm.innerHTML = `<div class="muted">Загрузи одну картинку. Хранятся текущая и две предыдущие.</div>`;
    }
    for (const c of p.cutouts) {
      const url = await fileUrl("cut:" + c.id);
      if (gen !== filmGen) return;
      const el = document.createElement("div");
      el.className = "film-item";
      el.innerHTML = `
        <button type="button" class="film-open">
          <img src="${esc(url)}" alt=""/>
          <span>${esc(c.name || "на холст")}</span>
        </button>
        <button type="button" class="film-x" aria-label="Удалить предмет">×</button>
      `;
      el.querySelector(".film-open").onclick = () => placeCutout(p, c);
      el.querySelector(".film-x").onclick = async (e) => {
        e.preventDefault();
        e.stopPropagation();
        p.cutouts = p.cutouts.filter((x) => x.id !== c.id);
        await forgetFile("cut:" + c.id);
        save();
        render();
      };
      cutFilm.appendChild(el);
    }
    if (!p.cutouts.length) {
      cutFilm.innerHTML = `<div class="muted">Пока пусто. Открой референс и закрась предмет маркером.</div>`;
    }
  }

  function placeCutout(p, c) {
    p.stickers.push({
      id: uid("s"),
      imageId: c.id,
      x: 0.5,
      y: 0.5,
      scale: 0.34,
      rot: 0,
      name: c.name || "предмет",
    });
    p.analysis = null;
    save();
    if (easel) {
      easel.stickers = p.stickers;
      easel.selectedId = p.stickers[p.stickers.length - 1].id;
      const url = urls["cut:" + c.id];
      if (url) loadImage(url).then((img) => easel.setImage(c.id, img));
      else easel.draw();
    }
  }

  function closeModal() {
    modal.hidden = true;
    modal.innerHTML = "";
    modal.onclick = null;
  }

  function showDepthSheet(sticker) {
    if (!easel || !sticker) return;
    easel.selectedId = sticker.id;
    easel.draw();
    modal.hidden = false;
    modal.innerHTML = `
      <div class="sheet" role="dialog" aria-label="Глубина">
        <div class="grab"></div>
        <h3>Глубина</h3>
        <p class="tiny">Вперёд — ближе к зрителю. Назад — дальше в картину. Можно нажать несколько раз.</p>
        <div class="stack">
          <button type="button" class="btn" id="depth-forward">Переместить вперёд</button>
          <button type="button" class="btn secondary" id="depth-backward">Переместить назад</button>
          <button type="button" class="btn ghost" id="depth-done">Готово</button>
        </div>
      </div>
    `;
    modal.onclick = (e) => {
      if (e.target === modal) closeModal();
    };
    document.getElementById("depth-forward").onclick = (e) => {
      e.stopPropagation();
      if (easel) easel.nudge("forward");
    };
    document.getElementById("depth-backward").onclick = (e) => {
      e.stopPropagation();
      if (easel) easel.nudge("backward");
    };
    document.getElementById("depth-done").onclick = (e) => {
      e.stopPropagation();
      closeModal();
    };
  }

  function watchCode() {
    const m = String(location.hash || "").match(/^#watch\/([A-Za-z0-9]+)/i);
    return m ? m[1].toUpperCase() : "";
  }

  async function openCastSheet(p) {
    modal.hidden = false;
    modal.innerHTML = `
      <div class="sheet" role="dialog" aria-label="Другой экран">
        <div class="grab"></div>
        <h3>Другой экран</h3>
        <p class="tiny" id="cast-status">Собираю подключение… Оба устройства в одном Wi‑Fi. Интернет нужен только чтобы найти друг друга.</p>
        <div id="cast-body" class="stack"></div>
      </div>
    `;
    modal.onclick = (e) => {
      if (e.target === modal) closeModal();
    };
    const status = document.getElementById("cast-status");
    const body = document.getElementById("cast-body");
    try {
      const session = await HolstCast.host({
        getFrame() {
          const cur = current() || p;
          if (exportShot) return cropExport(exportShot, cur);
          if (easel && easel.canvas && easel.canvas.isConnected) {
            return cropExport(easel.exportCanvas(canvasLongPx(cur.widthCm, cur.heightCm)), cur);
          }
          return null;
        },
        onViewers(n) {
          const el = document.getElementById("cast-viewers");
          if (el) el.textContent = n ? "Смотрят: " + n : "Жду второй экран…";
        },
      });
      if (!document.getElementById("cast-body")) return;
      status.textContent = "Открой ссылку на компьютере или телевизоре. Картина и приближение идут с телефона.";
      body.innerHTML = `
        ${session.qr ? `<img class="cast-qr" alt="QR" src="${esc(session.qr)}" />` : ""}
        <div class="watch-code">${esc(session.code)}</div>
        <p class="tiny" id="cast-viewers">Жду второй экран…</p>
        <p class="tiny">${esc(session.url)}</p>
        <button type="button" class="btn" id="cast-copy">Скопировать ссылку</button>
        <button type="button" class="btn ghost" id="cast-stop">Отключить</button>
        <p class="tiny">Запасной путь: транслируй экран телефона на телевизор (AirPlay / Cast / Smart View) или кабель HDMI.</p>
      `;
      document.getElementById("cast-copy").onclick = async (e) => {
        e.stopPropagation();
        try {
          await navigator.clipboard.writeText(session.url);
          document.getElementById("cast-copy").textContent = "Скопировано";
        } catch (err) {
          prompt("Скопируй ссылку", session.url);
        }
      };
      document.getElementById("cast-stop").onclick = (e) => {
        e.stopPropagation();
        HolstCast.stopHost();
        closeModal();
      };
      HolstCast.poke();
    } catch (err) {
      status.textContent = "Прямое подключение не вышло. Транслируй экран телефона на телевизор или открой картину по HDMI.";
      body.innerHTML = `<button type="button" class="btn ghost" id="cast-stop">Закрыть</button>`;
      const b = document.getElementById("cast-stop");
      if (b) b.onclick = (e) => { e.stopPropagation(); closeModal(); };
    }
  }

  function renderWatch(code) {
    nav.hidden = true;
    app.classList.add("watch-mode");
    app.classList.remove("camera-mode");
    renderTop("Экран", "картина с телефона", true);
    const backBtn = document.getElementById("go-back");
    if (backBtn) {
      backBtn.onclick = () => {
        HolstCast.stopJoin();
        location.hash = "";
        render();
      };
    }
    app.innerHTML = `
      <div class="watch-root">
        <img id="watch-img" alt="Картина" />
        <p class="tiny" id="watch-status">Ищу телефон по коду ${esc(code)}… Один Wi‑Fi.</p>
        <button type="button" class="btn ghost" id="watch-back">В мастерскую</button>
      </div>
    `;
    const img = document.getElementById("watch-img");
    const st = document.getElementById("watch-status");
    let prev = "";
    HolstCast.join(code, (data) => {
      const blob = data instanceof Blob ? data : new Blob([data], { type: "image/jpeg" });
      const url = URL.createObjectURL(blob);
      img.onload = () => { if (prev) URL.revokeObjectURL(prev); };
      img.src = url;
      prev = url;
      img.classList.add("on");
      st.textContent = "Картина с телефона";
    }, () => {
      st.textContent = "Связались. Жду картину…";
    }).catch(() => {
      st.textContent = "Не нашёл телефон. Проверь Wi‑Fi и что на телефоне открыт «Другой экран».";
    });
    document.getElementById("watch-back").onclick = () => {
      HolstCast.stopJoin();
      location.hash = "";
      render();
    };
  }

  async function mountEasel(p) {
    const canvas = document.getElementById("easel");
    if (!canvas) return;
    easel = new Easel(canvas, {
      onChange(stickers) {
        p.stickers = stickers;
        p.analysis = null;
        exportShot = null;
        save();
      },
      onSelect() {},
      onLongPress(sticker) {
        showDepthSheet(sticker);
      },
      onGridTap(cell) {
        setProjectZoom(p, zoomFromTap(p, cell.col, cell.row));
        save();
        const bar = document.getElementById("zoom-bar");
        if (bar) {
          bar.querySelectorAll("[data-zoom]").forEach((x) => {
            x.classList.toggle("on", x.dataset.zoom === projectZoom(p).kind);
          });
        }
      },
    });
    easel.setScene({
      stickers: p.stickers,
      bg: p.bg,
      gridN: p.gridN,
      widthCm: p.widthCm,
      heightCm: p.heightCm,
      view: projectZoom(p),
    });
    for (const s of p.stickers) {
      const url = await fileUrl("cut:" + s.imageId);
      if (url) easel.setImage(s.imageId, await loadImage(url));
    }
    window.addEventListener("resize", onResize, { passive: true });
  }

  function onResize() {
    if (easel && state.tab === "compose") easel.resize();
  }

  async function renderCutout(p) {
    const ref = p.refs.find((r) => r.id === state.ui.refId);
    if (!ref) { state.tab = "compose"; return renderCompose(p); }
    renderTop("Маркер", "пятно по предмету — сеть доведёт край", true);
    const url = await fileUrl("ref:" + ref.id);
    app.innerHTML = `
      <div class="cutout-stage" id="stage">
        <canvas class="base" id="cut-base"></canvas>
        <canvas class="draw" id="cut-draw"></canvas>
      </div>
      <div class="tools">
        <span class="tiny" id="cut-phase-label">Выделить</span>
        <button type="button" class="btn ghost row mark-pm" id="cut-minus" hidden>−</button>
        <button type="button" class="btn ghost row mark-pm" id="cut-plus" hidden>+</button>
        <span class="tiny">толщина</span>
        <input id="brush" type="range" min="12" max="80" value="36" />
        <button type="button" class="btn ghost row" id="cut-clear">очистить</button>
      </div>
      <label class="field">Прозрачность кисти <span id="op-val">50%</span>
        <input id="mark-op" type="range" min="12" max="80" value="50" />
      </label>
      <p class="tiny" id="cut-help" style="margin:0 0 10px">Закрась нужный предмет. Сеть снимет фон только на этом куске — как стикер.</p>
      <label class="field" id="cut-name-wrap">Как назвать предмет
        <input id="cut-name" placeholder="яблоко, кувшин, дерево…" />
      </label>
      <div class="stack" style="margin-top:12px">
        <button type="button" class="btn" id="do-cut">Вырезать</button>
        <p class="tiny" id="cut-msg"></p>
        <div id="cut-preview" hidden></div>
      </div>
    `;
    const base = document.getElementById("cut-base");
    const draw = document.getElementById("cut-draw");
    const stage = document.getElementById("stage");
    const msg = document.getElementById("cut-msg");
    cutImg = await loadImage(url);
    Cutout.loadBg().catch(() => {});
    Cutout.loadNN().catch(() => {});
    let phase = "select";
    let refineMode = "minus";
    let drawing = false;
    let box = { x: 0, y: 0, w: 1, h: 1 };
    let markOp = 0.5;
    let session = null;
    let viewSrc = cutImg;

    function dpr() { return Math.min(2, window.devicePixelRatio || 1); }
    function applyMarkOp() {
      const raw = Number(document.getElementById("mark-op").value);
      markOp = Math.max(0.12, Math.min(0.8, raw / 100));
      document.getElementById("op-val").textContent = Math.round(markOp * 100) + "%";
      draw.style.opacity = String(markOp);
    }
    function fitTo(src) {
      viewSrc = src;
      const iw = src.naturalWidth || src.width;
      const ih = src.naturalHeight || src.height;
      const sw = stage.clientWidth || 320;
      const sh = Math.min(window.innerHeight * 0.52, 560);
      stage.style.height = sh + "px";
      const s = Math.min(sw / iw, sh / ih);
      const dw = iw * s;
      const dh = ih * s;
      box = { x: (sw - dw) / 2, y: (sh - dh) / 2, w: dw, h: dh };
      const px = dpr();
      [base, draw].forEach((cv) => {
        cv.width = Math.round(dw * px);
        cv.height = Math.round(dh * px);
        cv.style.width = dw + "px";
        cv.style.height = dh + "px";
        cv.style.left = box.x + "px";
        cv.style.top = box.y + "px";
        cv.style.right = "auto";
        cv.style.bottom = "auto";
      });
      const bctx = base.getContext("2d");
      bctx.setTransform(px, 0, 0, px, 0, 0);
      bctx.clearRect(0, 0, dw, dh);
      bctx.drawImage(src, 0, 0, dw, dh);
      const dctx = draw.getContext("2d");
      dctx.setTransform(px, 0, 0, px, 0, 0);
      applyMarkOp();
    }
    function clearDraw() {
      const ctx = draw.getContext("2d");
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, draw.width, draw.height);
      ctx.setTransform(dpr(), 0, 0, dpr(), 0, 0);
    }
    function paintBase() {
      const bctx = base.getContext("2d");
      bctx.setTransform(dpr(), 0, 0, dpr(), 0, 0);
      bctx.clearRect(0, 0, box.w, box.h);
      bctx.drawImage(viewSrc, 0, 0, box.w, box.h);
    }
    fitTo(cutImg);

    function setRefineBtns() {
      document.getElementById("cut-minus").classList.toggle("on", refineMode === "minus");
      document.getElementById("cut-plus").classList.toggle("on", refineMode === "plus");
    }
    document.getElementById("cut-minus").onclick = () => {
      refineMode = "minus";
      setRefineBtns();
    };
    document.getElementById("cut-plus").onclick = () => {
      refineMode = "plus";
      setRefineBtns();
    };
    document.getElementById("cut-clear").onclick = () => {
      if (phase === "refine" && session) {
        const copy = document.createElement("canvas");
        copy.width = session.cut0.width;
        copy.height = session.cut0.height;
        copy.getContext("2d").drawImage(session.cut0, 0, 0);
        session.cut = copy;
        viewSrc = session.cut;
        paintBase();
      }
      clearDraw();
    };
    document.getElementById("mark-op").addEventListener("input", applyMarkOp);
    document.getElementById("mark-op").addEventListener("change", applyMarkOp);

    function pos(e) {
      const r = draw.getBoundingClientRect();
      const pt = e.touches ? e.touches[0] : e;
      return { x: pt.clientX - r.left, y: pt.clientY - r.top };
    }
    function paintAt(p0, p1) {
      const ctx = draw.getContext("2d");
      ctx.setTransform(dpr(), 0, 0, dpr(), 0, 0);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = "source-over";
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.lineWidth = Number(document.getElementById("brush").value);
      if (phase === "refine") {
        ctx.strokeStyle = refineMode === "plus" ? "#46c86e" : "#dc4646";
      } else {
        ctx.strokeStyle = "#ff46a0";
      }
      ctx.beginPath();
      ctx.moveTo(p0.x, p0.y);
      ctx.lineTo(p1.x, p1.y);
      ctx.stroke();
    }
    function bakeRefine() {
      if (phase !== "refine" || !session) return;
      const cut = session.cut;
      const rgb = session.rgb;
      const brush = document.createElement("canvas");
      brush.width = cut.width;
      brush.height = cut.height;
      brush.getContext("2d").drawImage(draw, 0, 0, cut.width, cut.height);
      const cctx = cut.getContext("2d");
      if (refineMode === "minus") {
        cctx.globalCompositeOperation = "destination-out";
        cctx.drawImage(brush, 0, 0);
        cctx.globalCompositeOperation = "source-over";
      } else {
        const piece = document.createElement("canvas");
        piece.width = cut.width;
        piece.height = cut.height;
        const pctx = piece.getContext("2d");
        pctx.drawImage(rgb, 0, 0);
        pctx.globalCompositeOperation = "destination-in";
        pctx.drawImage(brush, 0, 0);
        cctx.globalCompositeOperation = "source-over";
        cctx.drawImage(piece, 0, 0);
      }
      clearDraw();
      viewSrc = cut;
      paintBase();
    }
    let last = null;
    draw.onpointerdown = (e) => {
      e.preventDefault();
      draw.setPointerCapture(e.pointerId);
      drawing = true;
      last = pos(e);
      paintAt(last, last);
    };
    draw.onpointermove = (e) => {
      if (!drawing) return;
      const now = pos(e);
      paintAt(last, now);
      last = now;
    };
    draw.onpointerup = () => {
      drawing = false;
      bakeRefine();
    };
    draw.onpointercancel = () => { drawing = false; };

    function enterRefine(out) {
      const rgb = document.createElement("canvas");
      rgb.width = out.rgb.width;
      rgb.height = out.rgb.height;
      rgb.getContext("2d").drawImage(out.rgb, 0, 0);
      const cut = document.createElement("canvas");
      cut.width = out.cut.width;
      cut.height = out.cut.height;
      cut.getContext("2d").drawImage(out.cut, 0, 0);
      const cut0 = document.createElement("canvas");
      cut0.width = cut.width;
      cut0.height = cut.height;
      cut0.getContext("2d").drawImage(cut, 0, 0);
      session = { rgb, cut, cut0 };
      phase = "refine";
      refineMode = "minus";
      stage.classList.add("check");
      document.getElementById("cut-phase-label").textContent = "Правка";
      document.getElementById("cut-minus").hidden = false;
      document.getElementById("cut-plus").hidden = false;
      setRefineBtns();
      document.getElementById("cut-help").textContent = "− убирает кусок с вырезки, + возвращает его из фото.";
      document.getElementById("do-cut").hidden = true;
      const preview = document.getElementById("cut-preview");
      preview.hidden = false;
      preview.innerHTML = `
        <button type="button" class="btn" id="cut-keep">Готово</button>
        <button type="button" class="btn ghost" id="cut-retry">Вырезать заново</button>
      `;
      fitTo(cut);
      clearDraw();
      msg.textContent = "Подправь край на самой вырезке, потом нажми «Готово».";
      document.getElementById("cut-keep").onclick = async () => {
        const trimmed = Cutout.trim(session.cut);
        const blob = await new Promise((res) => trimmed.toBlob(res, "image/png"));
        const id = uid("c");
        await HolstDB.putFile("cut:" + id, blob);
        const name = document.getElementById("cut-name").value.trim() || "предмет";
        p.cutouts.push({ id, name });
        save();
        state.tab = "compose";
        render();
      };
      document.getElementById("cut-retry").onclick = () => {
        session = null;
        phase = "select";
        stage.classList.remove("check");
        document.getElementById("cut-phase-label").textContent = "Выделить";
        document.getElementById("cut-minus").hidden = true;
        document.getElementById("cut-plus").hidden = true;
        document.getElementById("cut-help").textContent = "Закрась нужный предмет. Сеть снимет фон только на этом куске — как стикер.";
        document.getElementById("do-cut").hidden = false;
        document.getElementById("do-cut").disabled = false;
        preview.hidden = true;
        preview.innerHTML = "";
        fitTo(cutImg);
        clearDraw();
        msg.textContent = "Закрась предмет ещё раз.";
      };
    }

    document.getElementById("do-cut").onclick = async () => {
      const btn = document.getElementById("do-cut");
      if (btn.disabled) return;
      btn.disabled = true;
      msg.textContent = "Снимаю фон с предмета в мазке…";
      try {
        const tmp = document.createElement("canvas");
        tmp.width = cutImg.naturalWidth;
        tmp.height = cutImg.naturalHeight;
        const tctx = tmp.getContext("2d");
        tctx.imageSmoothingEnabled = true;
        tctx.imageSmoothingQuality = "high";
        tctx.drawImage(draw, 0, 0, tmp.width, tmp.height);
        const out = await Cutout.extract(cutImg, tmp, {
          onProgress: (s) => { msg.textContent = s; },
          maxSide: canvasLongPx(p.widthCm, p.heightCm),
        });
        if (!out.rgb || !out.cut) throw new Error("Не вышло собрать вырезку.");
        enterRefine(out);
      } catch (err) {
        btn.disabled = false;
        msg.textContent = err.message || "Не вышло. Закрась предмет пятном и попробуй ещё раз.";
      }
    };
  }

  function blobMix(parts) {
    const max = Math.max(...parts.map((x) => x.parts), 1);
    return `<div class="mix-visual">${parts.map((pt) => {
      const d = 18 + (pt.parts / max) * 34;
      return `<div class="blob"><i style="width:${d}px;height:${d}px;background:${esc(pt.hex)}"></i>${esc(pt.name)}<br>×${pt.parts}</div>`;
    }).join("")}</div>`;
  }

  function stepKindLabel(kind) {
    return ({
      ground: "грунт",
      draw: "рисунок",
      value: "тон",
      bg: "даль",
      object: "предмет",
      finish: "финиш",
    })[kind] || "этап";
  }

  function mixQuality(q) {
    return q === "ok" ? "смесь близкая" : q === "good" ? "хорошо" : q === "approx" ? "похоже" : "далеко — упрости";
  }

  async function renderSteps(p) {
    renderTop("Этапы", "порядок письма по предметам");
    if (!p.stickers.length) {
      app.innerHTML = `<div class="empty">Сначала собери картину на холсте — хотя бы один вырезанный предмет.</div>`;
      return;
    }
    if (!p.paints.length) {
      app.innerHTML = `<div class="empty">Добавь краски. Без тюбиков не из чего считать смеси.</div>`;
      return;
    }
    app.innerHTML = `<div class="empty" id="an-wait">Смотрю каждый предмет и твои краски…</div>`;
    if (!p.analysis || p.analysis.guideVer !== 2 || !p.analysis.mixLesson || !Array.isArray(p.analysis.objects)) {
      p.analysis = await runAnalysis(p);
      save();
    }
    const a = p.analysis;
    const ppm = StudioCam.pxPerMm(state.calibrate);
    const objects = a.objects || [];
    app.innerHTML = `
      <div class="verdict ${esc(a.verdict)}">
        <p class="eyebrow">разбор</p>
        <strong>${a.verdict === "ok" ? "Можно писать" : a.verdict === "approx" ? "Можно, с упрощением цвета" : "Сложно попасть точно"}</strong>
        <p class="muted">${esc(a.summary)}</p>
        ${a.method ? `<p class="tiny">${esc(a.method)}</p>` : ""}
      </div>
      ${a.issues.map((i) => `<div class="hint">${esc(i)}</div>`).join("")}
      <div class="card mix-lesson">
        <p class="eyebrow">как мешать</p>
        <h3>Палитра</h3>
        <p class="muted">${esc(a.mixLesson || "")}</p>
        <ol class="atelier">
          <li>Общий тон холста</li>
          <li>Силуэты всех предметов</li>
          <li>Большие тени сцены</li>
          <li>Дальний план и фон</li>
          <li>Каждый предмет: тень → цвет → свет</li>
          <li>Края и блики в конце</li>
        </ol>
        <p class="tiny" style="margin-top:12px">На палитре: сначала цвет, потом сила цвета, белила — последними. Тень без белил.</p>
      </div>
      ${objects.length ? `
      <div class="card roster">
        <p class="eyebrow">на холсте</p>
        <h3>Предметы</h3>
        <p class="tiny">Каждый вырезанный объект — отдельный этап. Дальние пишут раньше ближних.</p>
        ${objects.map((o) => {
          const idx = (a.steps || []).findIndex((s) => s.stickerId === o.id);
          return `
            <button type="button" class="object-row" data-jump="${idx}">
              <span class="depth-dot" title="${esc(o.depthLabel)}"></span>
              <span>
                <strong>${esc(o.name)}</strong>
                <div class="tiny">${esc(o.loc)} · ${esc(o.depthLabel)}${o.cells && o.cells.length ? " · " + o.cells.slice(0, 4).map((c) => c.label).join(" ") : ""}</div>
              </span>
              <span class="muted">${idx >= 0 ? "этап" : ""}</span>
            </button>`;
        }).join("")}
      </div>` : ""}
      ${(a.steps || []).map((s, idx) => `
        <div class="card step-card" id="step-${idx}">
          <div class="row wrap" style="justify-content:space-between;align-items:baseline">
            <span class="kind-pill">${esc(stepKindLabel(s.kind))}</span>
          </div>
          <h3>${esc(s.title)}</h3>
          <p class="muted">${esc(s.teacher)}</p>
          <p class="tiny">Клетки: ${(s.cells || []).slice(0, 12).map((c) => c.label).join(", ")}${(s.cells || []).length > 12 ? "…" : ""}</p>
          ${(s.shades || []).map((sh) => `
            <div class="shade-block">
              <div class="row">
                <span class="swatch" style="background:${esc(sh.mix.hex)}"></span>
                <div>
                  <strong>${esc(sh.label)}</strong>
                  <div class="tiny">${esc(mixQuality(sh.mix.quality))}</div>
                </div>
              </div>
              ${blobMix(sh.mix.parts || [])}
              ${(sh.mix.steps && sh.mix.steps.length)
                ? `<ol class="mix-steps">${sh.mix.steps.map((t) => `<li>${esc(t)}</li>`).join("")}</ol>`
                : `<p class="muted">${esc(sh.mix.text || "")}</p>`}
              <p class="tiny">${esc(sh.how || "")}</p>
              <div class="stroke-preview" title="реальный размер мазка" style="--stroke:${(sh.strokeMm || 8) * ppm}px;background:${esc(sh.mix.hex)}"></div>
              <p class="tiny" style="text-align:center">Поднеси палитру к кружку — это реальный размер мазка (~${sh.strokeMm} мм).</p>
            </div>
          `).join("")}
          <button type="button" class="btn secondary" data-cam-step="${idx}" style="margin-top:10px">Рисовать этот этап в камере</button>
        </div>
      `).join("")}
    `;
    const goCam = (idx) => {
      p.stepIndex = Number(idx);
      p.zoomCell = null;
      p.zoom = { kind: "full", col: 0, row: 0 };
      state.tab = "camera";
      save();
      render();
    };
    app.querySelectorAll("[data-cam-step]").forEach((b) => {
      b.onclick = () => goCam(b.dataset.camStep);
    });
    app.querySelectorAll("[data-jump]").forEach((b) => {
      b.onclick = () => {
        const idx = Number(b.dataset.jump);
        if (idx < 0) return;
        const el = document.getElementById("step-" + idx);
        if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
      };
    });
  }

  async function runAnalysis(p) {
    const wrap = document.createElement("div");
    wrap.style.cssText = "position:fixed;left:-9999px;width:400px;height:500px";
    const cv = document.createElement("canvas");
    wrap.appendChild(cv);
    document.body.appendChild(wrap);
    const tmp = new Easel(cv, {});
    tmp.setScene({
      stickers: p.stickers, bg: p.bg, gridN: p.gridN,
      widthCm: p.widthCm, heightCm: p.heightCm,
    });
    for (const s of p.stickers) {
      const url = await fileUrl("cut:" + s.imageId);
      if (url) tmp.setImage(s.imageId, await loadImage(url));
    }
    tmp.resize();
    const hi = canvasLongPx(p.widthCm, p.heightCm);
    const shot = tmp.exportCanvas(hi);
    const small = document.createElement("canvas");
    if (shot.width >= shot.height) {
      small.width = 720;
      small.height = Math.max(2, Math.round(720 * shot.height / shot.width));
    } else {
      small.height = 720;
      small.width = Math.max(2, Math.round(720 * shot.width / shot.height));
    }
    const sctx = small.getContext("2d");
    sctx.imageSmoothingEnabled = true;
    sctx.imageSmoothingQuality = "high";
    sctx.drawImage(shot, 0, 0, small.width, small.height);
    const stickers = [];
    for (const s of p.stickers) {
      const url = await fileUrl("cut:" + s.imageId);
      let clusters = [];
      if (url) clusters = await StudioAnalyze.clustersForImage(await loadImage(url), p.paints);
      stickers.push({ ...s, clusters });
    }
    wrap.remove();
    exportShot = shot;
    return StudioAnalyze.analyze({
      canvas: small,
      paints: p.paints,
      stickers,
      gridN: p.gridN,
      medium: p.medium,
      widthCm: p.widthCm,
      heightCm: p.heightCm,
    });
  }

  async function ensureHiExport(p) {
    const need = canvasLongPx(p.widthCm, p.heightCm);
    if (exportShot && Math.max(exportShot.width, exportShot.height) >= need * 0.92) {
      return exportShot;
    }
    if (easel && state.activeId === p.id) {
      for (const s of p.stickers) {
        if (easel.images[s.imageId]) continue;
        const url = await fileUrl("cut:" + s.imageId);
        if (url) easel.setImage(s.imageId, await loadImage(url));
      }
      exportShot = easel.exportCanvas(need);
      return exportShot;
    }
    const wrap = document.createElement("div");
    wrap.style.cssText = "position:fixed;left:-9999px;width:400px;height:500px";
    const cv = document.createElement("canvas");
    wrap.appendChild(cv);
    document.body.appendChild(wrap);
    const tmp = new Easel(cv, {});
    tmp.setScene({
      stickers: p.stickers, bg: p.bg, gridN: p.gridN,
      widthCm: p.widthCm, heightCm: p.heightCm,
    });
    for (const s of p.stickers) {
      const url = await fileUrl("cut:" + s.imageId);
      if (url) tmp.setImage(s.imageId, await loadImage(url));
    }
    tmp.resize();
    exportShot = tmp.exportCanvas(need);
    wrap.remove();
    return exportShot;
  }

  async function renderCamera(p) {
    let mode = arModeId();
    const canRoom = await roomArAvailable();
    if (mode === "space" && !canRoom) {
      state.arMode = "pin";
      save();
      mode = "pin";
    }
    renderTop("Проекция", mode === "space" ? "комната · AR" : "углы · привязка к холсту");
    if (!p.analysis) {
      app.innerHTML = `<div class="empty">Сначала разбери картину на вкладке «Этапы».</div>`;
      return;
    }
    if (arSession && arSession.destroy) {
      try { arSession.destroy(); } catch (e) {}
      arSession = null;
    }
    app.innerHTML = `
      <div class="cam-root" id="cam-root">
        <video id="cam-video" playsinline muted autoplay></video>
        <canvas id="cam-ov" class="cam-full-ov"></canvas>
        <div class="cam-top">
          <span class="tiny cam-chip" id="cam-label"></span>
        </div>
        <button type="button" class="cam-scrim" id="cam-scrim" hidden aria-label="Закрыть подсказку"></button>
        <div class="cam-sheet-wrap" id="cam-sheet">
          <div class="cam-sheet">
            <div class="cam-sheet-handle">
              <button type="button" class="cam-sheet-toggle" id="cam-sheet-toggle" aria-expanded="false">
                <span class="grab"></span>
                <span class="cam-sheet-head">
                  <span class="swatch" id="cam-handle-swatch" hidden></span>
                  <span class="cam-sheet-title" id="cam-sheet-title">Подсказка</span>
                  <span class="cam-sheet-chevron" aria-hidden="true">▴</span>
                </span>
              </button>
              <div class="cam-step-nav">
                <button type="button" class="btn ghost row" id="cam-prev">Назад</button>
                <span class="tiny" id="cam-step-count"></span>
                <button type="button" class="btn gold row" id="cam-next">Дальше</button>
              </div>
            </div>
            <div class="cam-sheet-body">
              ${canRoom ? `
              <div class="field">Режим привязки</div>
              <div class="chips" id="cam-ar-chips">
                <button type="button" class="chip ${mode === "pin" ? "on" : ""}" data-ar="pin">Углы</button>
                <button type="button" class="chip ${mode === "space" ? "on" : ""}" data-ar="space">Комната</button>
              </div>` : `
              <p class="tiny">Привязка по 4 углам. Комнатный AR здесь недоступен — без Google Play его не поставить.</p>`}
              <div class="row wrap" style="margin-top:8px">
                <button type="button" class="btn ghost row" id="ar-rebind">${mode === "space" ? "Поставить заново" : "Перепривязать"}</button>
                <button type="button" class="btn ghost row" id="ar-reset">Сбросить</button>
              </div>
              <p class="tiny" id="ar-hint"></p>
              <label class="field">Прозрачность картины
                <input id="op" type="range" min="8" max="70" value="${Math.round((state.overlayOpacity || 0.28) * 100)}" />
              </label>
              <label class="field">Этап
                <select id="cam-step"></select>
              </label>
              <button type="button" class="btn ghost" id="cast-screen">Другой экран</button>
              <div id="cam-mix"></div>
              <p class="tiny" id="cam-err" style="color:var(--bad)"></p>
            </div>
          </div>
        </div>
      </div>
    `;
    const video = document.getElementById("cam-video");
    const ov = document.getElementById("cam-ov");
    const err = document.getElementById("cam-err");
    const hint = document.getElementById("ar-hint");
    const root = document.getElementById("cam-root");

    if (!exportShot) {
      try { p.analysis = await runAnalysis(p); } catch (e) {}
    }
    try { await ensureHiExport(p); } catch (e) {}
    if (state.overlayOpacity == null || state.overlayOpacity === 0.42) state.overlayOpacity = 0.28;
    const aspect = p.widthCm / p.heightCm;
    const steps = p.analysis.steps || [];
    const sel = document.getElementById("cam-step");
    const sheet = document.getElementById("cam-sheet");
    const scrim = document.getElementById("cam-scrim");
    const toggle = document.getElementById("cam-sheet-toggle");
    const prevBtn = document.getElementById("cam-prev");
    const nextBtn = document.getElementById("cam-next");
    const stepCount = document.getElementById("cam-step-count");
    if (sel) {
      sel.innerHTML = steps.map((s, i) => `<option value="${i}" ${i === (p.stepIndex || 0) ? "selected" : ""}>${esc(s.title)}</option>`).join("");
    }
    function setSheet(open) {
      if (sheet) sheet.classList.toggle("open", open);
      if (toggle) toggle.setAttribute("aria-expanded", open ? "true" : "false");
      if (scrim) scrim.hidden = !open;
    }
    function goStep(delta) {
      if (!steps.length) return;
      const cur = Math.max(0, Math.min(steps.length - 1, p.stepIndex || 0));
      const next = Math.max(0, Math.min(steps.length - 1, cur + delta));
      if (next === cur) return;
      p.stepIndex = next;
      if (sel) sel.value = String(next);
      save();
      updateHud();
      if (arSession && arSession.paint) arSession.paint();
    }
    if (toggle) toggle.onclick = () => setSheet(!sheet.classList.contains("open"));
    if (scrim) scrim.onclick = () => setSheet(false);
    if (prevBtn) prevBtn.onclick = () => goStep(-1);
    if (nextBtn) nextBtn.onclick = () => goStep(1);

    function updateHud() {
      const step = steps[p.stepIndex || 0];
      const label = document.getElementById("cam-label");
      if (label) {
        label.textContent = mode === "space"
          ? (arSession && arSession.running ? "AR · тапни по плоскости холста" : "AR · запуск…")
          : `${p.widthCm}×${p.heightCm} см · ${arModeLabel("pin")}`;
      }
      if (hint) {
        hint.textContent = mode === "space"
          ? "Наведи на холст и тапни — картинка встанет в пространстве."
          : "Тапни 4 угла холста: левый верх → правый верх → правый низ → левый низ. Потом можно подвинуть точки. Если съехало — «Перепривязать».";
      }
      const ppm = StudioCam.pxPerMm(state.calibrate);
      const mix = document.getElementById("cam-mix");
      const sh = (step && step.shades && step.shades[0]) || null;
      const titleEl = document.getElementById("cam-sheet-title");
      if (titleEl) titleEl.textContent = step ? step.title : "Подсказка";
      const handleSw = document.getElementById("cam-handle-swatch");
      if (handleSw) {
        if (sh && sh.mix) {
          handleSw.hidden = false;
          handleSw.style.background = sh.mix.hex;
        } else handleSw.hidden = true;
      }
      const idx = Math.max(0, Math.min(Math.max(0, steps.length - 1), p.stepIndex || 0));
      if (stepCount) stepCount.textContent = steps.length ? (idx + 1) + " / " + steps.length : "";
      if (prevBtn) prevBtn.disabled = idx <= 0;
      if (nextBtn) {
        nextBtn.disabled = idx >= steps.length - 1;
        nextBtn.textContent = idx >= steps.length - 1 ? "Готово" : "Дальше";
      }
      if (sel && String(sel.value) !== String(idx)) sel.value = String(idx);
      if (mix) mix.innerHTML = step ? `
        <div class="tiny" style="color:var(--linen);margin:0 0 4px">${esc(step.title)}</div>
        ${step.teacher ? `<p class="tiny">${esc(step.teacher)}</p>` : ""}
        ${sh && sh.mix && sh.mix.steps && sh.mix.steps[0] ? `<p class="tiny">${esc(sh.mix.steps[0])}</p>` : ""}
        ${sh ? `<div class="row">
          <span class="swatch" style="background:${esc(sh.mix.hex)}"></span>
          <span class="tiny">${esc(sh.label)}${step.objectName ? " · " + step.objectName : ""}</span>
          <span class="stroke-preview" style="--stroke:${Math.min(48, (sh.strokeMm || 10) * ppm)}px;background:${esc(sh.mix.hex)};margin:0 0 0 auto"></span>
        </div>` : ""}
      ` : "";
    }

    function layout() {
      const nav = document.getElementById("nav");
      const handle = document.querySelector(".cam-sheet-handle");
      const extra = (nav ? nav.getBoundingClientRect().height : 68) + (handle ? handle.getBoundingClientRect().height : 56) + 6;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const rw = root.clientWidth;
      const rh = Math.max(120, root.clientHeight - extra);
      ov.style.left = "0";
      ov.style.top = "0";
      ov.style.width = rw + "px";
      ov.style.height = rh + "px";
      const nw = Math.round(rw * dpr);
      const nh = Math.round(rh * dpr);
      if (ov.width !== nw || ov.height !== nh) {
        ov.width = nw;
        ov.height = nh;
        if (arSession && arSession.setCorners && Array.isArray(state.arPinCorners) && state.arPinCorners.length === 4) {
          arSession.setCorners(state.arPinCorners.map((c) => ({
            x: c.x * ov.width,
            y: c.y * ov.height,
          })));
        }
      }
      if (arSession && arSession.setAspect) arSession.setAspect(aspect);
      if (arSession && arSession.paint) arSession.paint();
    }

    document.querySelectorAll("#cam-ar-chips [data-ar]").forEach((b) => {
      b.onclick = () => {
        if (b.dataset.ar === mode) return;
        if (b.dataset.ar === "space" && !canRoom) {
          toast("Комнатный AR недоступен без Google Play");
          return;
        }
        state.arMode = b.dataset.ar;
        save();
        render();
      };
    });

    if (mode === "pin") {
      try {
        await StudioCam.start(video);
        camLive = true;
      } catch (e) {
        err.textContent = insecureCam()
          ? "Камера на телефоне нужна по https. Открой приложение с иконки на экране «Домой» или с GitHub Pages."
          : "Нет доступа к камере. Разреши её в настройках браузера для этого сайта.";
      }
      layout();
      const saved = Array.isArray(state.arPinCorners) && state.arPinCorners.length === 4
        ? state.arPinCorners.map((c) => ({
          x: c.x * ov.width,
          y: c.y * ov.height,
        }))
        : [];
      arSession = HolstAR.createPinSession({
        canvas: ov,
        aspect,
        corners: saved,
        getSource: () => exportShot,
        getOpacity: () => state.overlayOpacity || 0.28,
        getHighlight: () => {
          const step = steps[p.stepIndex || 0];
          return { cells: (step && step.cells) || [], gridN: p.gridN || 4 };
        },
        onChange(snap) {
          if (snap.ready && snap.corners) {
            state.arPinCorners = snap.corners.map((c) => ({
              x: c.x / Math.max(1, ov.width),
              y: c.y / Math.max(1, ov.height),
            }));
            save();
          }
          if (!snap.ready) {
            state.arPinCorners = null;
            save();
          }
        },
      });
      arSession.paint();
      document.getElementById("ar-rebind").onclick = () => {
        arSession.reset();
        toast("Тапни 4 угла заново");
      };
      document.getElementById("ar-reset").onclick = () => {
        arSession.reset();
        state.arPinCorners = null;
        save();
      };
    } else {
      video.style.display = "none";
      ov.classList.add("cam-xr-ov");
      hint.textContent = "Запускаю AR…";
      arSession = HolstAR.createXrSession({
        canvas: ov,
        overlayRoot: root,
        widthCm: p.widthCm,
        heightCm: p.heightCm,
        getSource: () => exportShot,
        getOpacity: () => Math.max(0.2, state.overlayOpacity || 0.35),
        onChange() { updateHud(); },
        onEnd() {
          camLive = false;
          if (state.tab === "camera") toast("AR завершён");
        },
      });
      try {
        await arSession.start();
        camLive = true;
        toast("Тапни по плоскости холста");
      } catch (e) {
        state.arMode = "pin";
        save();
        toast("Комнатный AR не запустился — включаю углы");
        render();
        return;
      }
      document.getElementById("ar-rebind").onclick = () => {
        if (arSession) arSession.reset();
        toast("Тапни новую плоскость");
      };
      document.getElementById("ar-reset").onclick = () => {
        if (arSession) arSession.reset();
      };
      layout();
    }

    const castBtn = document.getElementById("cast-screen");
    if (castBtn) castBtn.onclick = () => openCastSheet(p);
    if (sel) {
      sel.onchange = () => {
        p.stepIndex = Number(sel.value);
        save();
        updateHud();
        if (arSession && arSession.paint) arSession.paint();
      };
    }
    document.getElementById("op").oninput = (e) => {
      state.overlayOpacity = Number(e.target.value) / 100;
      save();
      if (arSession && arSession.paint) arSession.paint();
      if (arSession && arSession.refreshTexture) arSession.refreshTexture();
    };
    updateHud();
    if (camOnResize) window.removeEventListener("resize", camOnResize);
    camOnResize = layout;
    window.addEventListener("resize", camOnResize, { passive: true });
  }

  function stopCam() {
    if (camOnResize) {
      window.removeEventListener("resize", camOnResize);
      camOnResize = null;
    }
    if (arSession) {
      try {
        if (arSession.destroy) arSession.destroy();
        if (arSession.stop) arSession.stop();
      } catch (e) {}
      arSession = null;
    }
    if (camLive) StudioCam.stop();
    camLive = false;
  }

  function insecureCam() {
    return !window.isSecureContext;
  }

  async function installApp() {
    if (deferredPrompt) {
      deferredPrompt.prompt();
      await deferredPrompt.userChoice;
      deferredPrompt = null;
      return;
    }
    state.tab = "howto";
    render();
  }

  function bindUpdate() {
    const btn = document.getElementById("update-app");
    if (btn) btn.onclick = updateApp;
  }

  function updateApp() {
    const btn = document.getElementById("update-app");
    if (btn) {
      btn.disabled = true;
      btn.textContent = "Обновляю…";
    }
    location.replace("./reset.html?t=" + Date.now());
  }

  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferredPrompt = e;
  });

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("./sw.js?v=" + VER).catch(() => {});
  }

  HolstDB.open().catch(() => {});
  render();
  window.addEventListener("hashchange", () => render());
  const boot = Promise.race([
    HolstDB.loadState(),
    new Promise((res) => setTimeout(() => res(null), 1200)),
  ]);
  boot.then((s) => {
    if (s && s.projects) {
      state = Object.assign(emptyState(), s);
      state.projects.forEach((p) => {
        if (!Array.isArray(p.layouts)) p.layouts = [];
      });
      if (!watchCode()) render();
    }
  }).catch(() => {});
})();
