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

  function roman(n) {
    const r = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X", "XI", "XII", "XIII", "XIV", "XV", "XVI"];
    return r[n - 1] || String(n);
  }

  function objectName(s, i) {
    const n = String(s.name || "").trim();
    if (n && n !== "предмет") return n;
    return "Предмет " + (i + 1);
  }

  function mixLesson(medium) {
    const common =
      "Мешай на палитре, не на холсте. Порядок всегда один: сначала цвет (красный/жёлтый/синий), потом сила цвета (если слишком ядовитый — капля противоположного), и только потом светлота (белила или затемнение). Больше трёх красок в одной кучке редко нужно — получится грязь. Сверяй мазок с кружком на экране.";
    if (medium === "watercolor") {
      return "Акварель пишут от светлого к тёмному. Белила почти не нужны: свет — это бумага, её берегут. Мешай лужицу и проверяй на обрезке листа. Сначала слабый чай по большим массам, каждый следующий слой чуть темнее и чуть гуще. Не три сырое пятно — дай высохнуть. " + common;
    }
    if (medium === "gouache") {
      return "Гуашь кроющая: можно светлым по тёмному. Мешай до ровного пятна, чуть гуще молока. Светлые смеси готовь с запасом — высохнув, гуашь светлеет. " + common + " В тень белила почти не клади.";
    }
    if (medium === "acrylic") {
      return "Акрил сохнет быстро. Большие массы чуть жиже, форму гуще. Если слой схватился, не растушёвывай его в грязь — клади соседнее пятно рядом. " + common + " Тень без белил. Свет и блик — последними.";
    }
    return "Масло: снизу жиже (с растворителем), сверху жирнее — иначе верхний слой треснет. Тень тонкая и без белил, свет гуще, блик совсем густой. " + common;
  }

  function teacherGround(medium) {
    if (medium === "watercolor") {
      return "Не закрывай весь лист. Лёгкая общая тонировка — слабый чай, почти вода. Места будущих бликов и самых светлых предметов оставь белыми: это и будет свет.";
    }
    if (medium === "acrylic") {
      return "Закрой белый грунт тонким общим тоном. Кисть широкая, слой полупрозрачный. Белизна холста слепит глаз: на ней любая смесь кажется темнее, чем есть.";
    }
    if (medium === "gouache") {
      return "Тонкий общий тон грунта, не паста: холст должен чуть просвечивать. Когда белизна ушла, легче понять, что темнее, а что светлее.";
    }
    return "Не начинай с яблока и блика. Сначала общий тон холста — тонкий, почти прозрачный (часто охра или умбра с растворителем). Это самый тощий слой. Дай ему слегка схватиться. Пока грунт белый, глаз врёт: смеси кажутся темнее.";
  }

  function teacherDraw(medium) {
    if (medium === "watercolor") {
      return "Лёгким карандашом или совсем слабым пятном поставь силуэты всех предметов сразу. Не обводи контур — наметь пятно. Крупное должно остаться крупным, мелочь не заползай в центр.";
    }
    return "Кистью, не карандашом: поставь все предметы как пятна одним тоном. Сначала вся картина целиком — кто где стоит, кто больше, кто дальше. Без глаз, складок и бликов. Если силуэт врёт, точный цвет это не спасёт.";
  }

  function teacherValue(medium) {
    if (medium === "watercolor") {
      return "Найди самые тёмные места и пока только наметь их чуть сильнее фона. Светлые области не трогай. Картина должна читаться как свет и тень ещё без «красивого» цвета.";
    }
    return "Светлее/темнее важнее точного цвета. Закрой все крупные тени сцены сразу: фон, падающие тени, тёмные бока. Света не пиши. Край тени мягкий. Если прищуриться, картина уже должна читаться.";
  }

  function teacherBg(medium) {
    if (medium === "watercolor") {
      return "Фон пишут рано, пока лист ещё живой. Большие заливки, кисть плашмя, от края к предметам. У силуэтов можно чуть зайти на пятно — потом предмет сядет сверху.";
    }
    return "Даль и фон — раньше ближнего плана. Широкая кисть, длинный мазок, без листочков и окон. Предметы потом врежутся в фон, и край получится живым, не «наклейкой».";
  }

  function teacherObject(medium, name, loc, depthLabel, total) {
    const head = name + " — " + loc + ". " + depthLabel + ". ";
    const mix =
      "На палитре собери три кучки: тень, средний цвет, свет. Тень мешай без белил. Средний цвет — «какой предмет на самом деле». Свет — белила в самом конце, мало. ";
    if (medium === "watercolor") {
      return head + "Сначала силуэт слабым локальным цветом, потом тень чуть гуще, свет оставь бумагой. Детали — только когда пятно стоит на месте.";
    }
    return head + mix +
      "Порядок на холсте: 1) силуэт, 2) тень, 3) средний цвет, 4) свет, 5) блик в самом конце. " +
      (total > 1 ? "Дальние предметы пишут раньше ближних — так передний край ляжет поверх." : "Пока пятно не стоит, не берись за фактуру.");
  }

  function teacherFinish(medium) {
    if (medium === "watercolor") {
      return "Пройдись по всей картине. Где край режет — смочи и приглуши. Самые тёмные акценты и пара сухих деталей. Белую бумагу в бликах уже не закрашивай.";
    }
    return "Свяжи картину целиком, не один предмет. Где край слишком острый — приглуши. Один-два самых светлых блика и один самый тёмный акцент. Не вылизывай всё одинаково. В масле блик жирнее нижнего слоя, кисть маленькая, один мазок.";
  }

  function howForRole(medium, role) {
    if (medium === "watercolor") {
      if (role === "shadow") return "Чуть гуще, чем фон. Клади по форме, светлые места обойди. Не затирай сырое.";
      if (role === "light") return "Часто это просто бумага. Если пишешь — очень жидко, один проход.";
      if (role === "form") return "Слабый полутон: чуть темнее света, светлее тени. Дай нижнему слою высохнуть.";
      return "Слабый локальный тон. На обрезке бумаги проверь, что лужица не темнее нужного.";
    }
    if (role === "shadow") {
      return "Сначала тень — предмет сразу сядет в пространство. На палитре без белил (или капля). Темни умброй и синим, не чёрной из тюбика. Клади пятном, край к полутону мягкий.";
    }
    if (role === "light") {
      return "Свет в конце. Сначала цвет, потом капля белил. Не разбели весь силуэт — оставь средний тон, иначе предмет станет мелом.";
    }
    if (role === "form") {
      return "Полутон — место, где форма поворачивается от света к тени. Чуть темнее локального цвета, почти без белил. Здесь не рисуй край.";
    }
    return "Средний тон — цвет предмета при обычном свете. Им закрывают большую часть силуэта после тени. Мешай цвет до белил, белила — если совсем нужно и в конце.";
  }

  function mixHow(medium, role, mix) {
    let how = howForRole(medium, role);
    const parts = (mix && mix.parts) || [];
    const hasWhite = parts.some((p) => /белил|white/i.test(p.name));
    if (role === "shadow" && hasWhite && medium !== "watercolor") {
      how += " Если в смеси есть белила — убери их: тень станет молочной.";
    }
    if (role === "light" && medium !== "watercolor") {
      how += " Тёплый свет: капля охры. Холодный: капля ультрамарина.";
    }
    return how;
  }

  function shadeName(hex, role) {
    const n = ColorKit.mixName(hex);
    if (role === "shadow") return "тень: " + n;
    if (role === "light") return "свет: " + n;
    if (role === "form") return "полутон: " + n;
    if (role === "mid") return "локальный цвет: " + n;
    return n;
  }

  function clusterRoles(clusters) {
    const sorted = clusters.slice().sort((a, b) => ColorKit.luminance(a.hex) - ColorKit.luminance(b.hex));
    return sorted.map((c, i) => {
      let role = "mid";
      if (i === 0) role = "shadow";
      else if (i === sorted.length - 1 && sorted.length > 1) role = "light";
      else if (sorted.length >= 4 && i === 1) role = "form";
      return { ...c, role, label: shadeName(c.hex, role) };
    });
  }

  function depthLabel(i, total) {
    if (total <= 1) return "единственный предмет на холсте";
    if (i === 0) return "дальше всех, пишем раньше ближних";
    if (i === total - 1) return "ближе к зрителю, пишем последним из предметов";
    return "средний план, после дальних";
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
    if (!hasWhite && medium !== "watercolor") {
      issues.push("Нет белил. Без них почти не сделать светлые оттенки. Добавь титановые или цинковые белила.");
    }
    const hasBlack = paints.some((p) => /сажа|чёрн|черн|black/i.test(p.name) || ColorKit.luminance(p.hex) < 18);
    if (!hasBlack && medium !== "watercolor") {
      issues.push("Нет чёрной. Темнить умброй и ультрамарином живописнее, но глубокие тени будут сложнее.");
    }
    if (hard.length) {
      issues.push(
        "Некоторые оттенки далеко от твоих тюбиков: " +
          hard.slice(0, 3).map((h) => h.name).join(", ") +
          ". Возьми ближайшую смесь и упрости цвет — картина от этого часто становится цельной."
      );
    }
    if (approx.length) {
      issues.push("Часть цветов получится «похожими», не музейными. Для учебной картины важнее светлее/темнее, чем точный бренд-колор.");
    }

    mixes.forEach((m) => {
      m.mix.parts.forEach((p) => {
        const paint = paints.find((x) => x.id === p.id);
        const w = amountWarn(paint, m.share);
        if (w && !issues.includes(w)) issues.push(w);
      });
    });

    let verdict = "ok";
    if (!paints.length || hard.length > 2) verdict = "hard";
    else if (hard.length || approx.length > 2 || (!hasWhite && medium !== "watercolor")) verdict = "approx";

    const summary =
      verdict === "ok"
        ? "Эту картину можно собрать из твоих красок. Пиши по порядку мастерской: тон, пятна, даль, потом каждый предмет, блики в конце."
        : verdict === "approx"
          ? "Картину нарисовать можно, но часть оттенков будет приблизительной. Ниже — как мешать и в каком порядке закрывать холст."
          : "С текущим набором точно попасть в референс трудно. Пиши пятнами: свет / полутон / тень из ближайших смесей.";

    const ordered = stickers.slice();
    const objects = ordered.map((s, i) => {
      const cells = cellsCovered(s, n);
      const loc = locationPhrase(s);
      const name = objectName(s, i);
      const objectClusters = (s.clusters && s.clusters.length ? s.clusters : mixes.slice(0, 3));
      const roles = clusterRoles(objectClusters).slice(0, 4);
      return {
        id: s.id,
        name,
        loc,
        depth: i,
        depthLabel: depthLabel(i, ordered.length),
        cells,
        roles,
      };
    });

    const steps = [];
    const push = (step) => {
      step.title = roman(steps.length + 1) + ". " + step.heading;
      steps.push(step);
    };

    const ground = mixes[0] || { hex: "#CDBA9A", mix: ColorKit.bestMix("#CDBA9A", paints), share: 1, name: "грунт" };
    const muted = ColorKit.bestMix(
      ColorKit.rgbToHex(
        ColorKit.hexToRgb(ground.hex).r * 0.7 + 80,
        ColorKit.hexToRgb(ground.hex).g * 0.7 + 70,
        ColorKit.hexToRgb(ground.hex).b * 0.7 + 55
      ),
      paints
    );
    push({
      id: "ground",
      heading: "Имприматура — общий тон холста",
      kind: "ground",
      teacher: teacherGround(medium),
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
            : "Тонкий слой, кисть широкая. Не паста — полупрозрачная плёнка. В масле это самый тощий слой.",
        },
      ],
    });

    const names = objects.map((o) => o.name);
    const drawCells = [];
    const seenCell = new Set();
    objects.forEach((o) => o.cells.forEach((c) => {
      const k = c.col + ":" + c.row;
      if (!seenCell.has(k)) { seenCell.add(k); drawCells.push(c); }
    }));
    push({
      id: "draw",
      heading: objects.length
        ? "Рисунок — силуэты всех предметов"
        : "Рисунок — крупные пятна",
      kind: "draw",
      teacher: teacherDraw(medium) + (names.length ? " На холсте: " + names.join(", ") + "." : ""),
      cells: drawCells.length ? drawCells : allCells(n),
      preview: "full",
      objects: objects.map((o) => ({ id: o.id, name: o.name, loc: o.loc })),
      shades: [
        {
          hex: muted.hex,
          label: "пятно рисунка",
          mix: muted,
          strokeMm: strokeFor(0.2, "form"),
          how: "Один тон, без моделировки. Проверь масштаб предметов друг к другу по сетке.",
        },
      ],
    });

    const darkSrc = mixes.slice().sort((a, b) => ColorKit.luminance(a.hex) - ColorKit.luminance(b.hex))[0] || ground;
    const darkMix = {
      hex: darkSrc.hex,
      share: darkSrc.share,
      mix: ColorKit.bestMix(darkSrc.hex, paints, { preferNoWhite: true }),
    };
    push({
      id: "value",
      heading: "Тон — большие тени всей картины",
      kind: "value",
      teacher: teacherValue(medium),
      cells: allCells(n),
      preview: "full",
      shades: [
        {
          hex: darkMix.hex,
          label: "большая тень сцены",
          mix: darkMix.mix,
          strokeMm: strokeFor(darkMix.share || 0.3, "block"),
          how: "Закрой все крупные тёмные массы сразу — фон, падающие тени, тёмные бока. Свет не пиши. Эту смесь мешай без белил.",
        },
      ],
    });

    const bgMixes = mixes.slice(0, Math.min(3, mixes.length)).map((c, i) => ({
      hex: c.hex,
      label: i === 0 ? "большая масса фона" : "второй тон фона",
      mix: c.mix,
      strokeMm: strokeFor(c.share, "block"),
      how: "Клади пятном по клеткам. Не вырисовывай. Сверь мазок с кружком. Фон чуть спокойнее предметов: если ядовито — капля противоположного цвета.",
    }));
    push({
      id: "bg",
      heading: "Дальний план и фон",
      kind: "bg",
      teacher: teacherBg(medium),
      cells: allCells(n),
      preview: "full",
      shades: bgMixes,
    });

    objects.forEach((o) => {
      const roleOrder = { shadow: 0, form: 1, mid: 2, light: 3 };
      const shades = o.roles
        .slice()
        .sort((a, b) => (roleOrder[a.role] ?? 2) - (roleOrder[b.role] ?? 2))
        .map((c) => {
          const mix = ColorKit.bestMix(
            c.hex,
            paints,
            c.role === "shadow" || c.role === "form" ? { preferNoWhite: true } : null
          );
          return {
            hex: mix.hex || c.hex,
            label: c.label,
            role: c.role,
            mix,
            strokeMm: strokeFor(c.share || 0.1, c.role === "light" ? "detail" : "form"),
            how: mixHow(medium, c.role, mix),
          };
        });
      push({
        id: o.id,
        heading: o.name + " — " + o.loc,
        kind: "object",
        teacher: teacherObject(medium, o.name, o.loc, o.depthLabel, objects.length),
        cells: o.cells,
        preview: "sticker",
        stickerId: o.id,
        objectName: o.name,
        shades,
      });
    });

    push({
      id: "finish",
      heading: "Связка, края, блики",
      kind: "finish",
      teacher: teacherFinish(medium),
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
          how: "Маленькая кисть. Один уверенный мазок. В масле блик жирнее нижнего слоя. Белила в смеси — последними.",
        })),
    });

    return {
      verdict,
      summary,
      issues,
      palette: mixes,
      steps,
      objects,
      mixLesson: mixLesson(medium),
      guideVer: 2,
      method:
        medium === "watercolor"
          ? "Акварель: светлое → тёмное, бумага = блик."
          : medium === "acrylic"
            ? "Акрил: большие пятна → форма → свет. Сохнет быстро."
            : medium === "gouache"
              ? "Гуашь: пятно, потом свет поверх, край в конце."
              : "Масло: тощее → жирное, тень → свет, даль → ближний план.",
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
