window.ColorKit = (function () {
  function clamp(n, a, b) {
    return Math.max(a, Math.min(b, n));
  }

  function hexToRgb(hex) {
    let h = String(hex || "").replace("#", "").trim();
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    if (h.length !== 6) return { r: 200, g: 180, b: 140 };
    return {
      r: parseInt(h.slice(0, 2), 16),
      g: parseInt(h.slice(2, 4), 16),
      b: parseInt(h.slice(4, 6), 16),
    };
  }

  function rgbToHex(r, g, b) {
    const h = (n) => clamp(Math.round(n), 0, 255).toString(16).padStart(2, "0");
    return ("#" + h(r) + h(g) + h(b)).toUpperCase();
  }

  function rgbToHsl(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    let h = 0, s = 0;
    const l = (max + min) / 2;
    const d = max - min;
    if (d) {
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      switch (max) {
        case r: h = (g - b) / d + (g < b ? 6 : 0); break;
        case g: h = (b - r) / d + 2; break;
        default: h = (r - g) / d + 4;
      }
      h /= 6;
    }
    return { h: h * 360, s: s * 100, l: l * 100 };
  }

  function hslToRgb(h, s, l) {
    h = ((h % 360) + 360) % 360 / 360;
    s = clamp(s / 100, 0, 1);
    l = clamp(l / 100, 0, 1);
    if (s === 0) {
      const v = l * 255;
      return { r: v, g: v, b: v };
    }
    const hue2rgb = (p, q, t) => {
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1 / 6) return p + (q - p) * 6 * t;
      if (t < 1 / 2) return q;
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
      return p;
    };
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    return {
      r: hue2rgb(p, q, h + 1 / 3) * 255,
      g: hue2rgb(p, q, h) * 255,
      b: hue2rgb(p, q, h - 1 / 3) * 255,
    };
  }

  function srgbToLinear(c) {
    c /= 255;
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  }

  function linearToSrgb(c) {
    const v = c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
    return clamp(v * 255, 0, 255);
  }

  function rgbToXyz(r, g, b) {
    const R = srgbToLinear(r), G = srgbToLinear(g), B = srgbToLinear(b);
    return {
      x: R * 0.4124 + G * 0.3576 + B * 0.1805,
      y: R * 0.2126 + G * 0.7152 + B * 0.0722,
      z: R * 0.0193 + G * 0.1192 + B * 0.9505,
    };
  }

  function xyzToLab(x, y, z) {
    const xn = 0.95047, yn = 1, zn = 1.08883;
    const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
    const fx = f(x / xn), fy = f(y / yn), fz = f(z / zn);
    return { L: 116 * fy - 16, a: 500 * (fx - fy), b: 200 * (fy - fz) };
  }

  function rgbToLab(r, g, b) {
    const xyz = rgbToXyz(r, g, b);
    return xyzToLab(xyz.x, xyz.y, xyz.z);
  }

  function hexToLab(hex) {
    const { r, g, b } = hexToRgb(hex);
    return rgbToLab(r, g, b);
  }

  function deltaE(lab1, lab2) {
    const dL = lab1.L - lab2.L;
    const da = lab1.a - lab2.a;
    const db = lab1.b - lab2.b;
    return Math.sqrt(dL * dL + da * da + db * db);
  }

  function deltaEHex(a, b) {
    return deltaE(hexToLab(a), hexToLab(b));
  }

  function luminance(hex) {
    const { r, g, b } = hexToRgb(hex);
    return rgbToLab(r, g, b).L;
  }

  function mixName(hex) {
    const { r, g, b } = hexToRgb(hex);
    const lab = rgbToLab(r, g, b);
    const { h, s, l } = rgbToHsl(r, g, b);
    if (s < 8) {
      if (l > 90) return "почти белый";
      if (l > 70) return "светло-серый";
      if (l > 40) return "серый";
      if (l > 15) return "тёмно-серый";
      return "почти чёрный";
    }
    const hue =
      h < 18 ? "красный" :
      h < 45 ? "оранжевый" :
      h < 70 ? "жёлтый" :
      h < 150 ? "зелёный" :
      h < 200 ? "бирюзовый" :
      h < 255 ? "синий" :
      h < 310 ? "фиолетовый" : "красный";
    const light = l > 72 ? "светлый " : l < 28 ? "тёмный " : "";
    const sat = s < 25 ? "приглушённый " : s > 70 ? "насыщенный " : "";
    const warm = lab.b > 18 && lab.a > 8 ? "тёплый " : lab.b < -12 ? "холодный " : "";
    return (warm || sat || light) + hue;
  }

  /* Kubelka-Munk opaque mix, per RGB channel as reflectance 0-1 */
  function reflectanceToKS(r) {
    r = clamp(r, 0.001, 0.999);
    return ((1 - r) * (1 - r)) / (2 * r);
  }

  function ksToReflectance(ks) {
    return 1 + ks - Math.sqrt(ks * ks + 2 * ks);
  }

  function mixPaints(parts) {
    /* parts: [{hex, weight}] */
    const total = parts.reduce((s, p) => s + p.weight, 0) || 1;
    let ksR = 0, ksG = 0, ksB = 0;
    for (const p of parts) {
      const w = p.weight / total;
      const rgb = hexToRgb(p.hex);
      ksR += w * reflectanceToKS(srgbToLinear(rgb.r));
      ksG += w * reflectanceToKS(srgbToLinear(rgb.g));
      ksB += w * reflectanceToKS(srgbToLinear(rgb.b));
    }
    return rgbToHex(
      linearToSrgb(ksToReflectance(ksR)),
      linearToSrgb(ksToReflectance(ksG)),
      linearToSrgb(ksToReflectance(ksB))
    );
  }

  function gcd(a, b) {
    a = Math.round(Math.abs(a));
    b = Math.round(Math.abs(b));
    while (b) { const t = b; b = a % b; a = t; }
    return a || 1;
  }

  function simplify(nums) {
    let g = nums[0] || 1;
    for (let i = 1; i < nums.length; i++) g = gcd(g, nums[i]);
    return nums.map((n) => n / g);
  }

  function blobWord(parts, strength) {
    if (strength === "high" && parts <= 1) return "на кончике кисти";
    if (parts <= 1) return "капля";
    if (parts === 2) return "горошина";
    if (parts === 3) return "мазок с кисти №6";
    if (parts <= 5) return "боб";
    return "большая клякса";
  }

  function paintKind(it) {
    const name = String(it.name || "");
    if (/белил|white/i.test(name) || isWhiteish(it.hex)) return "white";
    if (/сажа|чёрн|черн|black/i.test(name) || isBlackish(it.hex)) return "black";
    return "chroma";
  }

  function recipeSteps(items) {
    if (!items.length) return ["Цвет не собран — сначала добавь тюбики."];
    const chroma = items.filter((it) => paintKind(it) === "chroma").sort((a, b) => b.parts - a.parts);
    const white = items.filter((it) => paintKind(it) === "white");
    const black = items.filter((it) => paintKind(it) === "black");
    const steps = [];
    if (!chroma.length && white.length && !black.length) {
      steps.push("Это почти белила из тюбика. Если свет тёплый — капля охры, если холодный — капля ультрамарина.");
      return steps;
    }
    if (chroma.length === 1 && !white.length && !black.length) {
      steps.push("Почти цвет из тюбика «" + chroma[0].name + "». Можно класть как есть.");
      return steps;
    }
    let n = 1;
    if (chroma[0]) {
      steps.push(n + ". Выложи " + blobWord(chroma[0].parts, chroma[0].strength) + " «" + chroma[0].name + "» — это основа, с неё начинают, не с белил.");
      n += 1;
    }
    chroma.slice(1).forEach((it) => {
      const hint = it.strength === "high" ? " Сильный пигмент: вводи по капле." : "";
      steps.push(n + ". Вмешивай «" + it.name + "» (" + blobWord(it.parts, it.strength) + "), пока оттенок не станет похож — жёлтее, краснее или синее." + hint);
      n += 1;
    });
    if (black.length) {
      steps.push(n + ". Темнить «" + black[0].name + "» совсем чуть-чуть. Чёрная быстро убивает цвет: лучше капля умбры, чем мазок сажи.");
      n += 1;
    }
    if (white.length) {
      steps.push(n + ". Белила — в самом конце, по капле. Если положить их раньше, смесь станет меловой и холодной.");
      n += 1;
    }
    steps.push(n + ". Сверь мазок с кружком. Слишком ярко — капля «противоположного» (к зелёному красный, к оранжевому синий). Слишком светло — не сразу белила, сначала чуть основного цвета.");
    return steps;
  }

  function recipeText(items) {
    if (!items.length) return "Цвет не собран.";
    return recipeSteps(items).join(" ");
  }

  function isWhiteish(hex) {
    return luminance(hex) > 88 && rgbToHsl(...Object.values(hexToRgb(hex))).s < 12;
  }

  function isBlackish(hex) {
    return luminance(hex) < 18;
  }

  function bestMix(targetHex, paints, opts) {
    const targetLab = hexToLab(targetHex);
    const list = (paints || []).filter((p) => p && p.hex);
    if (!list.length) {
      return {
        hex: targetHex,
        deltaE: 99,
        parts: [],
        text: "Нет красок в наличии — добавь тюбики в мастерскую.",
        steps: ["Нет красок в наличии — добавь тюбики в мастерскую."],
        quality: "hard",
      };
    }

    let best = null;
    const preferNoWhite = opts && opts.preferNoWhite;

    function consider(combo) {
      const hex = mixPaints(combo.map((c) => ({ hex: c.hex, weight: c.parts })));
      let d = deltaE(targetLab, hexToLab(hex));
      if (preferNoWhite && combo.some((c) => /белил|white/i.test(c.name) || isWhiteish(c.hex))) {
        d += 6;
      }
      if (!best || d < best.deltaE) {
        const simplified = simplify(combo.map((c) => c.parts));
        const parts = combo.map((c, i) => ({
          id: c.id,
          name: c.name,
          hex: c.hex,
          parts: simplified[i],
          strength: c.strength || "normal",
        })).filter((c) => c.parts > 0);
        const steps = recipeSteps(parts);
        best = {
          hex,
          deltaE: d,
          parts,
          text: steps.join(" "),
          steps,
          quality: d < 6 ? "ok" : d < 12 ? "good" : d < 20 ? "approx" : "hard",
        };
      }
    }

    for (const p of list) consider([{ ...p, parts: 1 }]);

    const white = list.find((p) => /белил|white/i.test(p.name) || isWhiteish(p.hex));
    const black = list.find((p) => /сажа|чёрн|черн|black/i.test(p.name) || isBlackish(p.hex));

    const ranked = list
      .map((p) => ({ p, d: deltaEHex(targetHex, p.hex) }))
      .sort((a, b) => a.d - b.d)
      .map((x) => x.p);

    const pool = [];
    const seen = new Set();
    function take(p) {
      if (p && !seen.has(p.id)) {
        seen.add(p.id);
        pool.push(p);
      }
    }
    ranked.slice(0, 6).forEach(take);
    take(white);
    take(black);

    const ratios = [1, 2, 3, 4, 6, 8];

    if (white) {
      for (const p of pool) {
        if (p.id === white.id) continue;
        for (const a of ratios) {
          for (const b of [1, 2, 3, 4, 6]) {
            consider([
              { ...white, parts: a },
              { ...p, parts: b },
            ]);
          }
        }
      }
    }

    if (black) {
      for (const p of pool) {
        if (p.id === black.id) continue;
        consider([
          { ...p, parts: 6 },
          { ...black, parts: 1 },
        ]);
        consider([
          { ...p, parts: 8 },
          { ...black, parts: 1 },
        ]);
      }
    }

    for (let i = 0; i < pool.length; i++) {
      for (let j = i + 1; j < pool.length; j++) {
        const a = pool[i], b = pool[j];
        consider([{ ...a, parts: 1 }, { ...b, parts: 1 }]);
        consider([{ ...a, parts: 2 }, { ...b, parts: 1 }]);
        consider([{ ...a, parts: 1 }, { ...b, parts: 2 }]);
        consider([{ ...a, parts: 3 }, { ...b, parts: 1 }]);
        consider([{ ...a, parts: 1 }, { ...b, parts: 3 }]);
        if (white && a.id !== white.id && b.id !== white.id) {
          consider([{ ...white, parts: 4 }, { ...a, parts: 2 }, { ...b, parts: 1 }]);
          consider([{ ...white, parts: 2 }, { ...a, parts: 2 }, { ...b, parts: 2 }]);
          consider([{ ...white, parts: 6 }, { ...a, parts: 1 }, { ...b, parts: 1 }]);
        }
      }
    }

    return best;
  }

  function kmeansHex(pixels, k, rounds) {
    /* pixels: [{r,g,b}] */
    if (!pixels.length) return [];
    k = Math.max(1, Math.min(k, pixels.length));
    const cents = [];
    const step = Math.max(1, Math.floor(pixels.length / k));
    for (let i = 0; i < k; i++) cents.push({ ...pixels[i * step] });
    const assign = new Array(pixels.length);
    for (let r = 0; r < (rounds || 10); r++) {
      const sums = cents.map(() => ({ r: 0, g: 0, b: 0, n: 0 }));
      for (let i = 0; i < pixels.length; i++) {
        let bi = 0, bd = 1e15;
        for (let c = 0; c < k; c++) {
          const dr = pixels[i].r - cents[c].r;
          const dg = pixels[i].g - cents[c].g;
          const db = pixels[i].b - cents[c].b;
          const d = dr * dr + dg * dg + db * db;
          if (d < bd) { bd = d; bi = c; }
        }
        assign[i] = bi;
        sums[bi].r += pixels[i].r;
        sums[bi].g += pixels[i].g;
        sums[bi].b += pixels[i].b;
        sums[bi].n++;
      }
      for (let c = 0; c < k; c++) {
        if (sums[c].n) {
          cents[c] = {
            r: sums[c].r / sums[c].n,
            g: sums[c].g / sums[c].n,
            b: sums[c].b / sums[c].n,
            n: sums[c].n,
          };
        }
      }
    }
    return cents
      .filter((c) => c.n)
      .map((c) => ({
        hex: rgbToHex(c.r, c.g, c.b),
        n: c.n,
        share: c.n / pixels.length,
      }))
      .sort((a, b) => b.n - a.n);
  }

  function sampleCanvas(canvas, maxSamples) {
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    const w = canvas.width, h = canvas.height;
    const data = ctx.getImageData(0, 0, w, h).data;
    const pixels = [];
    const step = Math.max(1, Math.floor((w * h) / (maxSamples || 8000)));
    for (let i = 0; i < w * h; i += step) {
      const o = i * 4;
      if (data[o + 3] < 40) continue;
      pixels.push({ r: data[o], g: data[o + 1], b: data[o + 2] });
    }
    return pixels;
  }

  function contrastText(hex) {
    return luminance(hex) > 58 ? "#1a1612" : "#f4ece1";
  }

  return {
    clamp,
    hexToRgb,
    rgbToHex,
    rgbToHsl,
    hslToRgb,
    rgbToLab,
    hexToLab,
    deltaE,
    deltaEHex,
    luminance,
    mixName,
    mixPaints,
    bestMix,
    kmeansHex,
    sampleCanvas,
    contrastText,
    rgbToHexStr: rgbToHex,
  };
})();
