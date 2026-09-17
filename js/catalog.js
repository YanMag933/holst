/* Каталог художественных красок: поиск по названию с тюбика. */
window.PaintCatalog = (function () {
  const P = [];

  function add(name, hex, extra) {
    const item = {
      id: "c" + P.length,
      name,
      hex,
      strength: "normal",
      aliases: [],
      ...extra,
    };
    P.push(item);
  }

  add("Белила титановые", "#F3F0E6", { strength: "normal", aliases: ["titanium white", "белила", "белый", "white"] });
  add("Белила цинковые", "#FAFAF4", { aliases: ["zinc white"] });
  add("Сажа газовая", "#1A1A1A", { strength: "high", aliases: ["чёрный", "черный", "костяная чёрная", "ivory black", "lamp black", "black"] });
  add("Кадмий лимонный", "#F4E24A", { aliases: ["lemon yellow", "лимонный"] });
  add("Кадмий жёлтый светлый", "#F3D03B", { aliases: ["cadmium yellow light", "жёлтый светлый", "желтый светлый"] });
  add("Кадмий жёлтый средний", "#EBC000", { aliases: ["cadmium yellow", "жёлтый", "желтый"] });
  add("Кадмий жёлтый тёмный", "#D9A400", { aliases: ["cadmium yellow deep"] });
  add("Неаполитанская жёлтая", "#E8D48B", { aliases: ["naples yellow"] });
  add("Охра светлая", "#D4A34A", { aliases: ["yellow ochre", "охра жёлтая", "охра"] });
  add("Охра золотистая", "#C8880A", { aliases: ["gold ochre", "золотистая охра"] });
  add("Сиена натуральная", "#B87333", { aliases: ["raw sienna"] });
  add("Сиена жжёная", "#8A4B2F", { aliases: ["burnt sienna", "жженая сиена"] });
  add("Умбра натуральная", "#635147", { aliases: ["raw umber"] });
  add("Умбра жжёная", "#5C4033", { aliases: ["burnt umber"] });
  add("Марс коричневый", "#6B4423", { aliases: ["mars brown", "коричневый"] });
  add("Ван Дик коричневый", "#4A3224", { aliases: ["van dyke brown"] });
  add("Охра красная", "#B85C38", { aliases: ["red ochre"] });
  add("Английская красная", "#A52A2A", { aliases: ["english red", "indian red"] });
  add("Венецианская красная", "#C14D3A", { aliases: ["venetian red"] });
  add("Кадмий красный светлый", "#E23D28", { aliases: ["cadmium red light", "красный светлый"] });
  add("Кадмий красный средний", "#D2261E", { aliases: ["cadmium red", "красный"] });
  add("Кадмий красный тёмный", "#C41E3A", { aliases: ["cadmium red deep", "красный тёмный"] });
  add("Краплак красный", "#8B1A3A", { strength: "high", aliases: ["alizarin crimson", "краплак", "ализарин"] });
  add("Кармин", "#9B1B30", { aliases: ["carmine"] });
  add("Киноварь", "#E34234", { aliases: ["vermilion", "cinnabar"] });
  add("Розовая", "#D46A8A", { aliases: ["pink", "розовый"] });
  add("Кобальт фиолетовый", "#6B3FA0", { aliases: ["cobalt violet", "фиолетовый"] });
  add("Ультрамарин фиолетовый", "#5A3D8A", { aliases: ["ultramarine violet"] });
  add("Ультрамарин", "#2E4A9B", { strength: "high", aliases: ["ultramarine blue", "ультрамарин синий", "синий"] });
  add("Кобальт синий", "#2E5DAA", { aliases: ["cobalt blue"] });
  add("Церулеум", "#3A7CA5", { aliases: ["cerulean blue", "небесно-голубой"] });
  add("Лазурь железная", "#0D3B66", { strength: "high", aliases: ["prussian blue", "берлинская лазурь", "прусская"] });
  add("Индиго", "#1C2951", { aliases: ["indigo"] });
  add("Голубая ФЦ", "#0077A8", { strength: "high", aliases: ["phthalo blue", "фталоцианин синий"] });
  add("Кобальт лазурь", "#4C8FBF", { aliases: ["cobalt azure"] });
  add("Изумрудная зелёная", "#0B6E4F", { strength: "high", aliases: ["viridian", "изумрудная", "зелёный", "зеленый"] });
  add("Зелёная ФЦ", "#007A5E", { strength: "high", aliases: ["phthalo green"] });
  add("Окись хрома", "#4F7A4E", { aliases: ["chromium oxide"] });
  add("Травяная зелёная", "#4A7C3F", { aliases: ["sap green", "травяная"] });
  add("Оливковая", "#5C6B3A", { aliases: ["olive green"] });
  add("Кобальт зелёный", "#3D8B6E", { aliases: ["cobalt green"] });
  add("Жёлто-зелёная", "#8AAA3A", { aliases: ["yellow green"] });
  add("Оранжевая", "#E07A1F", { aliases: ["orange", "кадмий оранжевый"] });
  add("Кадмий оранжевый", "#E36C12", { aliases: ["cadmium orange"] });
  add("Золотистая", "#C9A227", { aliases: ["gold"] });
  add("Телесная", "#E8B99A", { aliases: ["flesh tint", "телесный"] });
  add("Слоновая кость", "#EFE6D0", { aliases: ["ivory"] });
  add("Серая пейна", "#5C6570", { aliases: ["payne's grey", "пейна"] });
  add("Графитная серая", "#4A4A4A", { aliases: ["graphite grey", "серый"] });
  add("Бирюзовая", "#2A9B8F", { aliases: ["turquoise"] });
  add("Малиновая", "#B31B4A", { aliases: ["crimson", "маджента", "magenta"] });
  add("Охра жёлтая", "#CC9A3A", { aliases: ["охра желтая"] });
  add("Сиена натуральная светлая", "#C98A4A", {});
  add("Кобальт синий спектральный", "#2550B4", {});
  add("Белила свинцовые", "#F7F4EA", { aliases: ["lead white"] });
  add("Марс чёрный", "#222222", { strength: "high", aliases: ["mars black"] });
  add("Жжёная кость", "#2B2420", { aliases: ["bone black"] });
  add("Кадмий красный пурпурный", "#B01A3A", {});
  add("Розовый квензачридон", "#C74375", { strength: "high", aliases: ["quinacridone rose"] });
  add("Диоксазиновый фиолетовый", "#4A2A7A", { strength: "high", aliases: ["dioxazine purple"] });

  function norm(s) {
    return String(s || "")
      .toLowerCase()
      .replace(/ё/g, "е")
      .replace(/[^a-zа-я0-9]+/gi, " ")
      .trim();
  }

  function score(item, q) {
    const n = norm(item.name);
    const hay = [n].concat(item.aliases.map(norm));
    if (!q) return 0;
    let best = 0;
    for (const h of hay) {
      if (h === q) best = Math.max(best, 100);
      else if (h.startsWith(q)) best = Math.max(best, 80);
      else if (h.includes(q)) best = Math.max(best, 55);
      else {
        const words = h.split(" ");
        if (words.some((w) => w.startsWith(q))) best = Math.max(best, 70);
      }
    }
    return best;
  }

  function search(query, limit) {
    const q = norm(query);
    if (!q) return P.slice(0, limit || 12);
    return P.map((item) => ({ item, s: score(item, q) }))
      .filter((x) => x.s > 0)
      .sort((a, b) => b.s - a.s || a.item.name.localeCompare(b.item.name, "ru"))
      .slice(0, limit || 12)
      .map((x) => x.item);
  }

  function byId(id) {
    return P.find((x) => x.id === id) || null;
  }

  return { all: P, search, byId, norm };
})();
