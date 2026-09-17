window.StudioAnalyze = (function () {
  function cellLabel(col, row, n) {
    const letters = "АБВГДЕЖЗИКЛМНОПРСТ";
    return letters[col] + (row + 1);
  }

  function cellsCovered(sticker, n) {
    const cells = [];
    const pad = (sticker.scale || 0.3) / 2;
    const x0 = Math.max(0, sticker.x - pad);
    const x1 = Math.min(0.999, sticker.x + pad);
    const y0 = Math.max(0, sticker.y - pad * 1.2);
    const y1 = Math.min(0.999, sticker.y + pad * 1.2);
    const c0 = Math.floor(x0 * n), c1 = Math.floor(x1 * n);
    const r0 = Math.floor(y0 * n), r1 = Math.floor(y1 * n);
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) cells.push({ col: c, row: r, label: cellLabel(c, r, n) });
    }
    return cells;
  }

  function strokeFor(share, kind) {
    if (kind === "ground") return 28;
    if (kind === "block") return share > 0.25 ? 22 : 14;
    if (kind === "form") return 8;
    return 4;
  }

  function amountWarn(paint, share) {
    if (!paint) return null;
    if (paint.amount === "drop" && share > 0.12) {
      return `«${paint.name}» почти кончилась, а в картине это большой кусок. Замешай запас заранее или упрости заливку.`;
    }
    if (paint.amount === "half" && share > 0.4) {
      return `«${paint.name}» уйдёт на большие плоскости — проверь, что тюбика хватит на фон.`;
    }
    return null;
  }

  function teacherForMedium(medium, stepIndex, title) {
    const oil = medium === "watercolor";
    if (stepIndex === 0) {
      return oil
        ? "Акварель начинается с белого листа: не закрашиваем всё сразу. Сначала лёгкая общая тонировка неба/фона — слабый чай, почти вода."
        : "Профессионал не прыгает к деталям. Сначала закрываем белый грунт общим тоном — имприматура. Тонкий слой, чтобы холст перестал слепить и все следующие цвета легли родственно.";
    }
    if (title.indexOf("Фон") === 0) {
      return "Большие массы пишем широко. Кисть лежит плашмя, мазки длинные. Не вырисовываем облачко — кладём пятно.";
    }
    if (stepIndex < 3) {
      return "Сначала силуэт и место предмета на холсте. Поставь его как пятно: темнее / светлее фона. Пока без глаз, бликов и прожилок.";
    }
    return "Теперь форма: тень, свет, рефлекс. Детали — в конце, когда пятно уже стоит на своём месте.";
  }

  function shadeName(hex, role) {
    const n = ColorKit.mixName(hex);
    if (role === "shadow") return "тень: " + n;
    if (role === "light") return "свет: " + n;
    if (role === "mid") return "локальный цвет: " + n;
    return n;
  }

  function clusterRoles(clusters) {
    const sorted = clusters.slice().sort((a, b) => ColorKit.luminance(a.hex) - ColorKit.luminance(b.hex));
    return sorted.map((c, i) => {
      let role = "mid";
      if (i === 0) role = "shadow";
      else if (i === sorted.length - 1 && sorted.length > 1) role = "light";
      return { ...c, role, label: shadeName(c.hex, role) };
    });
  }

  function analyze(opts) {
    const {
      canvas,
      paints,
      stickers,
      gridN,
      medium,
      widthCm,
      heightCm,
    } = opts;
    const n = gridN || 4;
    const pixels = ColorKit.sampleCanvas(canvas, 7000);
    const k = Math.min(10, Math.max(4, 3 + stickers.length));
    const global = ColorKit.kmeansHex(pixels, k, 12);
    const mixes = global.map((c) => {
      const mix = ColorKit.bestMix(c.hex, paints);
      return { ...c, mix, name: ColorKit.mixName(c.hex) };
    });

    const issues = [];
    const hard = mixes.filter((m) => m.mix.quality === "hard");
    const approx = mixes.filter((m) => m.mix.quality === "approx");
    if (!paints.length) issues.push("Нет ни одной краски — анализ смешения невозможен.");
    const hasWhite = paints.some((p) => /белил|white/i.test(p.name) || ColorKit.luminance(p.hex) > 88);
    if (!hasWhite) issues.push("Нет белил. Без них почти не сделать светлые оттенки и не высветлить смеси. Добавь титановые или цинковые белила.");
    const hasBlack = paints.some((p) => /сажа|чёрн|черн|black/i.test(p.name) || ColorKit.luminance(p.hex) < 18);
    if (!hasBlack && medium !== "watercolor") {
      issues.push("Нет чёрной. Можно темнить умброй и ультрамарином — это даже живописнее, но глубокие тени будут сложнее.");
    }
    if (hard.length) {
      issues.push(
        "Некоторые оттенки картины далеко от твоих тюбиков: " +
          hard.slice(0, 3).map((h) => h.name).join(", ") +
          ". Возьми ближайшую смесь и упрости цвет — картина от этого часто становится цельной."
      );
    }
    if (approx.length) {
      issues.push("Часть цветов получится «похожими», не музейными. Для учебной картины этого достаточно: важнее отношения светлее/темнее, чем точный бренд-колор.");
    }

    const usedIds = new Set();
    mixes.forEach((m) => m.mix.parts.forEach((p) => usedIds.add(p.id)));
    mixes.forEach((m) => {
      m.mix.parts.forEach((p) => {
        const paint = paints.find((x) => x.id === p.id);
        const w = amountWarn(paint, m.share);
        if (w && !issues.includes(w)) issues.push(w);
      });
    });

    let verdict = "ok";
    if (!paints.length || hard.length > 2) verdict = "hard";
    else if (hard.length || approx.length > 2 || !hasWhite) verdict = "approx";

    const summary =
      verdict === "ok"
        ? "Эту картину можно собрать из твоих красок. Смесей хватит, если не гнаться за каждым фото-оттенком."
        : verdict === "approx"
          ? "Картину нарисовать можно, но часть оттенков будет приблизительной. Ниже — как мешать и где упростить."
          : "С текущим набором точно попасть в референс трудно. Напиши картину пятнами: свет / полутон / тень из ближайших смесей.";

    const steps = [];

    const ground = mixes[0] || { hex: "#CDBA9A", mix: ColorKit.bestMix("#CDBA9A", paints), share: 1, name: "грунт" };
    const muted = ColorKit.bestMix(
      ColorKit.rgbToHex(
        ColorKit.hexToRgb(ground.hex).r * 0.7 + 80,
        ColorKit.hexToRgb(ground.hex).g * 0.7 + 70,
        ColorKit.hexToRgb(ground.hex).b * 0.7 + 55
      ),
      paints
    );
    steps.push({
      id: "ground",
      title: "1. Имприматура — общий тон холста",
      teacher: teacherForMedium(medium, 0, ""),
      cells: allCells(n),
      preview: "full",
      shades: [
        {
          hex: muted.hex,
          label: "тон грунта",
          mix: muted,
          strokeMm: strokeFor(1, "ground"),
          how: medium === "watercolor"
            ? "Очень жидко, почти вода. Оставь белые места, если они будут светиться позже."
            : "Тонкий слой, кисть широкая. Не паста — полупрозрачная плёнка. Дай слегка схватиться.",
        },
      ],
    });

    const bgMixes = mixes.slice(0, Math.min(3, mixes.length)).map((c, i) => ({
      hex: c.hex,
      label: i === 0 ? "большая масса фона" : "второй тон фона",
      mix: c.mix,
      strokeMm: strokeFor(c.share, "block"),
      how: "Клади пятном по клеткам сетки. Сверь мазок с кружком на экране.",
    }));
    steps.push({
      id: "bg",
      title: "2. Фон — большие пятна",
      teacher: teacherForMedium(medium, 1, "Фон"),
      cells: allCells(n),
      preview: "full",
      shades: bgMixes,
    });

    const ordered = stickers.slice();
    ordered.forEach((s, idx) => {
      const cells = cellsCovered(s, n);
      const loc = locationPhrase(s);
      const objectClusters = (s.clusters && s.clusters.length ? s.clusters : mixes.slice(0, 3));
      const roles = clusterRoles(objectClusters).slice(0, 4);
      const shades = roles.map((c) => ({
        hex: c.hex,
        label: c.label,
        mix: c.mix || ColorKit.bestMix(c.hex, paints),
        strokeMm: strokeFor(c.share || 0.1, c.role === "light" ? "detail" : "form"),
        how:
          c.role === "shadow"
            ? "Сначала тень — предмет сразу начнёт стоять в пространстве."
            : c.role === "light"
              ? "Свет в конце. Не разбели весь предмет, оставь полутон живым."
              : "Средний тон — это «настоящий» цвет предмета в обычном свете.",
      }));
      steps.push({
        id: s.id,
        title: `${3 + idx}. ${s.name || "Предмет"} — ${loc}`,
        teacher: teacherForMedium(medium, 2 + idx, s.name || ""),
        cells,
        preview: "sticker",
        stickerId: s.id,
        shades,
      });
    });

    steps.push({
      id: "finish",
      title: `${3 + stickers.length}. Связка, акценты, блики`,
      teacher:
        "Пройдись по всей картине: где край слишком режет — приглуши. Один-два самых светлых блика и самый тёмный акцент. Не детализируй всё одинаково — глаз сам достроит.",
      cells: allCells(n),
      preview: "full",
      shades: mixes
        .slice()
        .sort((a, b) => ColorKit.luminance(b.hex) - ColorKit.luminance(a.hex))
        .slice(0, 2)
        .map((c) => ({
          hex: c.hex,
          label: ColorKit.luminance(c.hex) > 60 ? "блик / самый свет" : "акцент",
          mix: c.mix,
          strokeMm: 3,
          how: "Маленькая кисть. Один уверенный мазок, не размазывай.",
        })),
    });

    return {
      verdict,
      summary,
      issues,
      palette: mixes,
      steps,
      widthCm,
      heightCm,
      gridN: n,
      medium,
    };
  }

  function allCells(n) {
    const cells = [];
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) cells.push({ col: c, row: r, label: cellLabel(c, r, n) });
    }
    return cells;
  }

  function locationPhrase(s) {
    const x = s.x, y = s.y;
    const horiz = x < 0.33 ? "слева" : x > 0.66 ? "справа" : "по центру";
    const vert = y < 0.33 ? "вверху" : y > 0.66 ? "внизу" : "в средней полосе";
    return vert + " " + horiz;
  }

  async function clustersForImage(img, paints) {
    const c = document.createElement("canvas");
    const max = 280;
    const nw = img.naturalWidth || img.width;
    const nh = img.naturalHeight || img.height;
    const sc = Math.min(1, max / Math.max(nw, nh));
    c.width = Math.max(2, Math.round(nw * sc));
    c.height = Math.max(2, Math.round(nh * sc));
    c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
    const px = ColorKit.sampleCanvas(c, 2500);
    return ColorKit.kmeansHex(px, 4, 8).map((cl) => ({
      ...cl,
      mix: ColorKit.bestMix(cl.hex, paints),
    }));
  }

  return { analyze, clustersForImage, cellLabel, cellsCovered };
})();
