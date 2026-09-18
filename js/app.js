(function () {
  "use strict";

  const VER = "9";
  const SIZES = [
    [20, 30], [30, 40], [40, 50], [50, 70], [60, 80],
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
      projects: [],
      ui: {},
    };
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
    const scale = Math.min(1, 1600 / Math.max(w, 1));
    canvas.width = Math.max(1, Math.round(w * scale));
    canvas.height = Math.max(1, Math.round(h * scale));
    paint(canvas.getContext("2d"), canvas.width, canvas.height);
    if (bmp && bmp.close) bmp.close();
    const blob = await new Promise((res) => canvas.toBlob((b) => res(b || file), "image/jpeg", 0.88));
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
    app.classList.toggle("camera-mode", state.tab === "camera");
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
    renderTop("Холст", "Помощник художника");
    const standalone = window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone;
    const list = state.projects.map((p) => `
      <button type="button" class="card project-card" data-open="${esc(p.id)}">
        <div class="thumb" style="background:${esc(p.bg || "#E8DCC8")}"></div>
        <div>
          <strong>${esc(p.name)}</strong>
          <div class="muted">${p.widthCm}×${p.heightCm} см · ${esc(mediumLabel(p.medium))} · ${p.paints.length} красок</div>
        </div>
        <span class="muted">→</span>
      </button>
    `).join("");
    app.innerHTML = `
      ${!standalone ? `
      <div class="install-banner">
        <div class="grow">
          <strong>На домашний экран</strong>
          <div class="tiny">Камера, краски и холст остаются в телефоне — компьютер больше не нужен.</div>
        </div>
        <button type="button" class="btn row" id="install-btn">Установить</button>
      </div>` : ""}
      <div class="hero">
        <p>Собери картину из референсов. Холст разложит её на этапы и смеси из твоих тюбиков — как в мастерской.</p>
      </div>
      ${list || `<div class="empty">Пока нет картин. Создай первую — размер холста и краски.</div>`}
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
    renderTop("Композиция", "вырежи предметы и разложи на холсте");
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
    mountEasel(p);
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

  async function mountEasel(p) {
    const canvas = document.getElementById("easel");
    if (!canvas) return;
    easel = new Easel(canvas, {
      onChange(stickers) {
        p.stickers = stickers;
        p.analysis = null;
        save();
      },
      onSelect() {},
      onLongPress(sticker) {
        showDepthSheet(sticker);
      },
    });
    easel.setScene({
      stickers: p.stickers,
      bg: p.bg,
      gridN: p.gridN,
      widthCm: p.widthCm,
      heightCm: p.heightCm,
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
        const seen = document.createElement("canvas");
        seen.width = cutImg.naturalWidth;
        seen.height = cutImg.naturalHeight;
        seen.getContext("2d").drawImage(base, 0, 0, seen.width, seen.height);
        const tmp = document.createElement("canvas");
        tmp.width = seen.width;
        tmp.height = seen.height;
        tmp.getContext("2d").drawImage(draw, 0, 0, tmp.width, tmp.height);
        const out = await Cutout.extract(seen, tmp, {
          onProgress: (s) => { msg.textContent = s; },
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

  async function renderSteps(p) {
    renderTop("Этапы", "как пишет профессионал");
    if (!p.stickers.length) {
      app.innerHTML = `<div class="empty">Сначала собери картину на холсте — хотя бы один вырезанный предмет.</div>`;
      return;
    }
    if (!p.paints.length) {
      app.innerHTML = `<div class="empty">Добавь краски. Без тюбиков не из чего считать смеси.</div>`;
      return;
    }
    app.innerHTML = `<div class="empty" id="an-wait">Смотрю картину и твои краски…</div>`;
    if (!p.analysis) {
      p.analysis = await runAnalysis(p);
      save();
    }
    const a = p.analysis;
    const ppm = StudioCam.pxPerMm(state.calibrate);
    app.innerHTML = `
      <div class="verdict ${esc(a.verdict)}">
        <strong>${a.verdict === "ok" ? "Можно писать" : a.verdict === "approx" ? "Можно, с упрощением цвета" : "Сложно попасть точно"}</strong>
        <p class="muted">${esc(a.summary)}</p>
      </div>
      ${a.issues.map((i) => `<div class="hint">${esc(i)}</div>`).join("")}
      ${(a.steps || []).map((s, idx) => `
        <div class="card">
          <h3>${esc(s.title)}</h3>
          <p class="muted">${esc(s.teacher)}</p>
          <p class="tiny">Клетки сетки: ${(s.cells || []).slice(0, 12).map((c) => c.label).join(", ")}${(s.cells || []).length > 12 ? "…" : ""}</p>
          ${(s.shades || []).map((sh) => `
            <div style="margin-top:12px">
              <div class="row">
                <span class="swatch" style="background:${esc(sh.mix.hex)}"></span>
                <div>
                  <strong>${esc(sh.label)}</strong>
                  <div class="tiny">${esc(sh.mix.quality === "ok" ? "смесь близкая" : sh.mix.quality === "good" ? "хорошо" : sh.mix.quality === "approx" ? "похоже" : "далеко — упрости")}</div>
                </div>
              </div>
              ${blobMix(sh.mix.parts || [])}
              <p class="muted">${esc(sh.mix.text)}</p>
              <p class="tiny">${esc(sh.how || "")}</p>
              <div class="stroke-preview" title="реальный размер мазка" style="--stroke:${(sh.strokeMm || 8) * ppm}px;background:${esc(sh.mix.hex)}"></div>
              <p class="tiny" style="text-align:center">Поднеси палитру к кружку — это реальный размер мазка (~${sh.strokeMm} мм).</p>
            </div>
          `).join("")}
          <button type="button" class="btn secondary" data-cam-step="${idx}" style="margin-top:10px">Рисовать этот этап в камере</button>
        </div>
      `).join("")}
    `;
    app.querySelectorAll("[data-cam-step]").forEach((b) => {
      b.onclick = () => {
        p.stepIndex = Number(b.dataset.camStep);
        p.zoomCell = null;
        state.tab = "camera";
        save();
        render();
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
    const shot = tmp.exportCanvas(720);
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
      canvas: shot,
      paints: p.paints,
      stickers,
      gridN: p.gridN,
      medium: p.medium,
      widthCm: p.widthCm,
      heightCm: p.heightCm,
    });
  }

  async function renderCamera(p) {
    renderTop("Проекция", "совмести рамку с реальным холстом");
    if (!p.analysis) {
      app.innerHTML = `<div class="empty">Сначала разбери картину на вкладке «Этапы».</div>`;
      return;
    }
    app.innerHTML = `
      <div class="cam-root" id="cam-root">
        <video id="cam-video" playsinline muted autoplay></video>
        <div class="cam-frame" id="cam-frame"><canvas id="cam-ov"></canvas></div>
        <div class="cam-top">
          <span class="tiny" style="background:rgba(0,0,0,.4);padding:4px 8px;border-radius:8px" id="cam-label"></span>
        </div>
        <div class="cam-ui compact">
          <label class="field">Прозрачность картины
            <input id="op" type="range" min="8" max="70" value="${Math.round((state.overlayOpacity || 0.28) * 100)}" />
          </label>
          <label class="field">Этап
            <select id="cam-step"></select>
          </label>
          <p class="tiny" id="zoom-hint"></p>
          <div id="cam-mix"></div>
          <p class="tiny" id="cam-err" style="color:var(--bad)"></p>
        </div>
      </div>
    `;
    const video = document.getElementById("cam-video");
    const frame = document.getElementById("cam-frame");
    const ov = document.getElementById("cam-ov");
    const err = document.getElementById("cam-err");
    try {
      await StudioCam.start(video);
      camLive = true;
    } catch (e) {
      err.textContent = insecureCam()
        ? "Камера на телефоне нужна по https. Открой приложение с иконки на экране «Домой» или с GitHub Pages."
        : "Нет доступа к камере. Разреши её в настройках браузера для этого сайта.";
    }
    if (!exportShot) {
      try { p.analysis = await runAnalysis(p); } catch (e) {}
    }
    if (state.overlayOpacity == null || state.overlayOpacity === 0.42) state.overlayOpacity = 0.28;
    const aspect = p.widthCm / p.heightCm;
    const steps = p.analysis.steps || [];
    const sel = document.getElementById("cam-step");
    sel.innerHTML = steps.map((s, i) => `<option value="${i}" ${i === (p.stepIndex || 0) ? "selected" : ""}>${esc(s.title)}</option>`).join("");
    function layout() {
      const root = document.getElementById("cam-root");
      const hud = document.querySelector(".cam-ui");
      const extra = hud ? Math.min(160, hud.getBoundingClientRect().height) : 120;
      const fit = StudioCam.fitFrame(root, aspect, { bottom: extra });
      frame.style.left = fit.left + "px";
      frame.style.top = fit.top + "px";
      frame.style.width = fit.fw + "px";
      frame.style.height = fit.fh + "px";
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      ov.width = Math.round(fit.fw * dpr);
      ov.height = Math.round(fit.fh * dpr);
      paintCam();
    }
    function paintCam() {
      const step = steps[p.stepIndex || 0];
      document.getElementById("cam-label").textContent = p.zoomCell
        ? `Клетка ${StudioAnalyze.cellLabel(p.zoomCell.col, p.zoomCell.row, p.gridN)} · ближе к холсту`
        : `${p.widthCm}×${p.heightCm} см · совмести рамку с холстом`;
      document.getElementById("zoom-hint").textContent = p.zoomCell
        ? "Рамка = один квадрат. Коснись картины ещё раз, чтобы снова видеть весь холст."
        : "Полупрозрачная картина лежит на реальном холсте. Сетка почти не мешает. Коснись клетки, чтобы приблизить.";
      const hi = (step && step.cells) || [];
      const ppm = StudioCam.pxPerMm(state.calibrate);
      const mix = document.getElementById("cam-mix");
      const sh = (step && step.shades && step.shades[0]) || null;
      mix.innerHTML = sh ? `
        <div class="row">
          <span class="swatch" style="background:${esc(sh.mix.hex)}"></span>
          <span class="tiny">${esc(sh.label)}</span>
          <span class="stroke-preview" style="--stroke:${Math.min(48, (sh.strokeMm || 10) * ppm)}px;background:${esc(sh.mix.hex)};margin:0 0 0 auto"></span>
        </div>
      ` : "";
      StudioCam.drawOverlay({
        canvas: ov,
        exportCanvas: exportShot,
        opacity: state.overlayOpacity || 0.28,
        gridN: p.gridN,
        zoomCell: p.zoomCell,
        highlightCells: p.zoomCell ? [] : hi,
      });
    }
    ov.onclick = (e) => {
      if (p.zoomCell) {
        p.zoomCell = null;
        save();
        paintCam();
        return;
      }
      const r = ov.getBoundingClientRect();
      const n = p.gridN || 4;
      const col = Math.min(n - 1, Math.max(0, Math.floor(((e.clientX - r.left) / r.width) * n)));
      const row = Math.min(n - 1, Math.max(0, Math.floor(((e.clientY - r.top) / r.height) * n)));
      p.zoomCell = { col, row };
      save();
      paintCam();
    };
    sel.onchange = () => {
      p.stepIndex = Number(sel.value);
      p.zoomCell = null;
      save();
      paintCam();
    };
    document.getElementById("op").oninput = (e) => {
      state.overlayOpacity = Number(e.target.value) / 100;
      save();
      paintCam();
    };
    layout();
    window.addEventListener("resize", layout, { passive: true });
  }

  function stopCam() {
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
  const boot = Promise.race([
    HolstDB.loadState(),
    new Promise((res) => setTimeout(() => res(null), 1200)),
  ]);
  boot.then((s) => {
    if (s && s.projects) {
      state = Object.assign(emptyState(), s);
      render();
    }
  }).catch(() => {});
})();
