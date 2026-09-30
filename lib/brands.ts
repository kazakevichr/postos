// Имена брендов в одном месте.
//
// Один проект зовётся по-разному: SUPERFIT24 — название направления в
// таблице проектов, superfit — ключ в настройках сбора и в кошельках,
// «СуперФит» — как это читает человек. Ключ и подпись должны жить рядом,
// иначе список для выбора показывает техническое, а экран — человеческое,
// и одно с другим никто не свяжет.
export const BRAND_NAMES: Record<string, string> = {
  superfit: "СуперФит",
  party: "Вечеринки",
  oracle: "Оракл",
  moneyball: "MoneyBall",
  other: "Прочее",
};

export const brandLabel = (key: string) => BRAND_NAMES[key] || key;

// Бренды, которые вообще бывают: настроенные для сбора плюс те, что уже
// встретились на аккаунтах. Оракл живёт своими каналами, а не BRAND_MAP,
// поэтому добавляем его явно — иначе его нечем было бы выбрать. MoneyBall
// тоже: площадок у него пока нет, а завод и направление уже есть.
export const ALL_BRAND_KEYS = ["superfit", "party", "oracle", "moneyball", "other"];

const norm = (s: string) => s.toLowerCase().replace(/[^a-zа-яё0-9]/gi, "");

/**
 * Бренды направления, выведенные из его названия.
 *
 * Ручное поле было ошибкой: разграничение, которое включается только после
 * настройки, по умолчанию показывает всё — то есть выглядит сделанным и не
 * работает. Имена и так совпадают по смыслу: superfit ↔ SUPERFIT24,
 * oracle ↔ Oracle, «Вечеринки» ↔ «Вечеринки (Все Наши и Музлото)».
 * Совпадение ищем и по ключу, и по человеческой подписи.
 *
 * Ручное поле осталось на случай, когда имена всё же разошлись, — но
 * заполнять его, чтобы получить очевидное, больше не нужно.
 */
export function autoBrands(projectName: string): string[] {
  const name = norm(projectName);
  if (!name) return [];
  return ALL_BRAND_KEYS.filter((key) => {
    if (key === "other") return false;
    return [key, BRAND_NAMES[key] || ""]
      .map(norm)
      .filter(Boolean)
      .some((candidate) => name.includes(candidate) || candidate.includes(name));
  });
}

/** Что показывать направлению: ручная настройка, иначе выведенное из имени. */
export function brandsOf(project: { name: string; brandKeys: string }): string[] {
  const explicit = (project.brandKeys || "")
    .split(",")
    .map((b) => b.trim())
    .filter(Boolean);
  if (explicit.length) return explicit;
  const auto = autoBrands(project.name);
  if (auto.length) return auto;
  // НОВЫЙ ПРОЕКТ получает свой бренд из названия: «Психолог» → psiholog.
  // Раньше проект без знакомого бренда получал пустые рамки, а пульт и план
  // от этого откатывались к бренду по умолчанию — и новый проект показывал
  // завод СуперФита. Теперь заведённый в «Настройке проекта» проект сразу
  // живёт своей жизнью, без правки кода.
  const own = slugOf(project.name);
  return own ? [own] : [];
}

// ── Транслит для ключей ───────────────────────────────────────────────────
// Ключ бренда и имена профилей — латиница без пробелов, а называют их
// по-русски. Одна функция на весь Постос, чтобы «Психолог» везде превращался
// в одно и то же.
const TR: Record<string, string> = {
  а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "e", ж: "zh", з: "z", и: "i",
  й: "y", к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r", с: "s", т: "t",
  у: "u", ф: "f", х: "h", ц: "ts", ч: "ch", ш: "sh", щ: "sch", ъ: "", ы: "y", ь: "",
  э: "e", ю: "yu", я: "ya",
};

export function slugOf(title: string): string {
  const t = title.toLowerCase().split("").map((c) => TR[c] ?? c).join("");
  return t.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 24);
}

/** Все бренды: известные коду плюс заведённые проектами. */
export async function allBrands(): Promise<string[]> {
  const { prisma } = await import("@/lib/prisma");
  const rows = await prisma.project.findMany({ where: { isActive: true }, select: { name: true, brandKeys: true } });
  return [...new Set([...ALL_BRAND_KEYS.filter((b) => b !== "other"), ...rows.flatMap((r) => brandsOf(r))])];
}

/** Человеческое имя бренда: из словаря, а для нового проекта — его название. */
export async function brandTitle(brand: string): Promise<string> {
  if (BRAND_NAMES[brand]) return BRAND_NAMES[brand];
  const { prisma } = await import("@/lib/prisma");
  const rows = await prisma.project.findMany({ where: { isActive: true }, select: { name: true, brandKeys: true } });
  return rows.find((r) => brandsOf(r).includes(brand))?.name || brand;
}
