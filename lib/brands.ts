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
  return explicit.length ? explicit : autoBrands(project.name);
}
