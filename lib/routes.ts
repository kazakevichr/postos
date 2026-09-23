import { prisma } from "@/lib/prisma";

// Площадки и типы контента для матрицы «Маршруты публикации».
export const PLATFORMS = [
  { key: "ig_main", label: "super.fit24" },
  { key: "ig_woman", label: "woman" },
  { key: "ig_man", label: "man" },
  { key: "youtube", label: "YouTube" },
  { key: "tiktok", label: "TikTok" },
];

// Какие типы контента вообще осмысленны на профиле — раскладка Романа
// от 25.08.2026. Всё вне списка в матрице показывается прочерком.
export const RELEVANT: Record<string, string[]> = {
  ig_main: ["make", "carousel", "carousel_new", "avatar", "trainer:female", "trainer:male", "manual"],
  ig_woman: ["repost", "trainer:female"],
  ig_man: ["trainer:male", "repost"],
  youtube: ["make", "avatar", "trainer:female", "trainer:male", "repost", "manual"],
  tiktok: ["make", "avatar", "trainer:female", "trainer:male", "repost", "manual"],
};

export const KINDS = [
  { kind: "make", label: "Персонаж", note: "" },
  { kind: "carousel", label: "Карусель", note: "" },
  { kind: "carousel_new", label: "Карусель Новая", note: "фотореализм" },
  { kind: "avatar", label: "ИИ-аватар", note: "" },
  { kind: "trainer:female", label: "Тренер Ж", note: "" },
  { kind: "trainer:male", label: "Тренер М", note: "" },
  { kind: "repost", label: "Нарезки", note: "ютуб-репост" },
  { kind: "manual", label: "Ручные посты", note: "зеркало на видеоплощадки" },
];

// Клетки, которых не бывает: карусель — картинки (на видеоплощадках отдельная
// подпись «не видео»), остальное — вне раскладки профилей.
export const NA: Record<string, string[]> = {};
for (const k of ["make", "carousel", "carousel_new", "avatar", "trainer:female", "trainer:male", "repost", "manual"]) {
  NA[k] = PLATFORMS.map((p) => p.key).filter((pk) => !(RELEVANT[pk] || []).includes(k));
}

// Осознанный запрет: чужие нарезки на YouTube/TikTok — путь к страйкам.
export const LOCKED: Record<string, string[]> = {
  repost: ["youtube", "tiktok"],
};

// Значения по умолчанию — текущее состояние конвейера на 23.08.2026.
const DEFAULTS: Record<string, Record<string, boolean>> = {
  make: { ig_main: true, ig_woman: false, youtube: true, tiktok: true },
  carousel: { ig_main: true, ig_woman: false },
  carousel_new: { ig_main: true },
  avatar: { ig_main: true, ig_woman: false, youtube: true, tiktok: false },
  "trainer:female": { ig_main: false, ig_woman: false, youtube: false, tiktok: false },
  "trainer:male": { ig_main: false, ig_woman: false, youtube: false, tiktok: false },
  repost: { ig_main: false, ig_woman: true },
  manual: { ig_main: true, youtube: true, tiktok: true },
};

// Нарезки делятся по донорам: подтипы repost:<донор>. Список доноров
// присылает repost-завод (Setting repost:donors) — новый донор появляется
// в матрице без деплоя. Правила (где уместно, замки, дефолты) наследуются
// от базового repost.
export const baseKind = (k: string) => (k.startsWith("repost:") ? "repost" : k);

export async function donors(): Promise<{ key: string; label: string; manual?: boolean }[]> {
  const row = await prisma.setting.findUnique({ where: { key: "repost:donors" } });
  try {
    const list = row ? JSON.parse(row.value) : [];
    return Array.isArray(list)
      ? list.filter((d) => d?.key).map((d) => ({
          key: String(d.key), label: String(d.label || d.key),
          ...(d.manual ? { manual: true } : {}),
        }))
      : [];
  } catch { return []; }
}

// Время публикации нарезок. У заводских типов расписание — это старт
// производства; нарезки же собираются по событию (донор выложил ролик),
// поэтому час у них отдельной осью: когда выпускать уже готовое.
// Хранится отдельно от списка доноров, чтобы перерегистрация доноров
// заводом не стирала выставленные часы.
export type PublishRule = { mode: "now" | "at"; at?: string };

export async function publishMap(): Promise<Record<string, PublishRule>> {
  const row = await prisma.setting.findUnique({ where: { key: "repost:publish" } });
  try { return row ? JSON.parse(row.value) : {}; } catch { return {}; }
}

export async function setPublish(kind: string, mode: string, at?: string) {
  if (!kind.startsWith("repost:")) throw new Error("время публикации задаётся только нарезкам");
  if (!["now", "at"].includes(mode)) throw new Error("mode: now | at");
  if (mode === "at" && !/^([01]\d|2[0-3]):[0-5]\d$/.test(at || "")) {
    throw new Error("время в формате ЧЧ:ММ");
  }
  const map = await publishMap();
  map[kind] = mode === "at" ? { mode: "at", at } : { mode: "now" };
  await prisma.setting.upsert({
    where: { key: "repost:publish" },
    create: { key: "repost:publish", value: JSON.stringify(map) },
    update: { value: JSON.stringify(map) },
  });
  return map;
}

// Для завода: не задано — публикуем сразу, как было до появления часов.
export async function publishFor(kind: string) {
  const r = (await publishMap())[kind];
  return r?.mode === "at" && r.at
    ? { publish_mode: "at", publish_at: r.at }
    : { publish_mode: "now", publish_at: null };
}

// Типы для матрицы: при известных донорах строка «Нарезки» раскрывается
// на подстроки по донорам.
export async function kindsWithDonors() {
  const ds = await donors();
  if (!ds.length) return KINDS;
  const out: { kind: string; label: string; note: string }[] = [];
  for (const k of KINDS) {
    if (k.kind !== "repost") { out.push(k); continue; }
    for (const d of ds) {
      out.push({
        kind: `repost:${d.key}`,
        label: `Нарезки · ${d.label}`,
        note: d.manual ? "выкладка руками" : "ютуб-репост",
      });
    }
  }
  return out;
}

export function defaultFor(platform: string, kind: string): boolean {
  if (kind === "*") return true;
  return DEFAULTS[baseKind(kind)]?.[platform] ?? false;
}

export function blocked(platform: string, kind: string): boolean {
  const b = baseKind(kind);
  return (NA[b] || []).includes(platform) || (LOCKED[b] || []).includes(platform);
}

export async function routeMap() {
  const rows = await prisma.routeFlag.findMany();
  const saved = new Map(rows.map((r) => [`${r.platform}|${r.kind}`, r.enabled]));
  const flags: Record<string, boolean> = {};
  const kinds = await kindsWithDonors();
  for (const p of PLATFORMS) {
    flags[`${p.key}|*`] = saved.get(`${p.key}|*`) ?? true;
    for (const k of kinds) {
      if (blocked(p.key, k.kind)) continue;
      // Донорский тумблер наследует состояние общего «Нарезки», пока его
      // не переключали отдельно — поведение не меняется от самого деления.
      flags[`${p.key}|${k.kind}`] =
        saved.get(`${p.key}|${k.kind}`) ??
        saved.get(`${p.key}|${baseKind(k.kind)}`) ??
        defaultFor(p.key, k.kind);
    }
  }
  return flags;
}

/**
 * Выключенный донор нарезок: тумблер в пульте гасит и производство.
 *
 * Читаем настройку напрямую, а не через lib/formats: тот тянет за собой
 * lib/factory, а он — этот файл, и получился бы круг импортов.
 */
async function donorOff(kind: string) {
  if (!kind.startsWith("repost:")) return false;
  const row = await _p.setting.findUnique({ where: { key: "factory:formats:superfit" } });
  try {
    return Boolean(row && JSON.parse(row.value)?.[kind]?.off);
  } catch {
    return false;
  }
}

// Итоговое решение для публикатора: тип разрешён и площадка не на паузе.
export async function allowed(platform: string, kind: string) {
  if (blocked(platform, kind)) return false;
  if (await donorOff(kind)) return false;
  const flags = await routeMap();
  const key = `${platform}|${kind}`;
  if (!(key in flags) && kind === "repost") {
    // Переходный случай: завод ещё спрашивает общий repost, а матрица уже
    // донорская — разрешаем, если включён хотя бы один донор.
    const ds = await donors();
    return Boolean(flags[`${platform}|*`]) &&
      ds.some((d) => flags[`${platform}|repost:${d.key}`]);
  }
  return Boolean(flags[`${platform}|*`]) && Boolean(flags[key]);
}

// Расписание производства по типам: во сколько стартует слот или «по запросу».
// Хранится в Setting под ключами slotmode:<kind>; завод синхронизирует своё
// расписание с этим раз в несколько минут.
import { prisma as _p } from "@/lib/prisma";

export const SCHEDULABLE = ["make", "carousel", "carousel_new", "avatar", "trainer:female", "trainer:male"];

const SCHEDULE_DEFAULTS: Record<string, { mode: string; time?: string }> = {
  make: { mode: "time", time: "08:00" },
  carousel: { mode: "time", time: "12:00" },
  carousel_new: { mode: "time", time: "12:00" },
  avatar: { mode: "demand" },
  "trainer:female": { mode: "demand" },
  "trainer:male": { mode: "demand" },
};

export async function scheduleMap() {
  const rows = await _p.setting.findMany({
    where: { key: { in: SCHEDULABLE.map((k) => `slotmode:${k}`) } },
  });
  const saved = new Map(rows.map((r) => [r.key.replace("slotmode:", ""), r.value]));
  const out: Record<string, { mode: string; time?: string }> = {};
  for (const k of SCHEDULABLE) {
    const raw = saved.get(k);
    if (raw) {
      try { out[k] = JSON.parse(raw); continue; } catch {}
    }
    out[k] = SCHEDULE_DEFAULTS[k];
  }
  return out;
}

export async function setSchedule(kind: string, mode: string, time?: string) {
  if (!SCHEDULABLE.includes(kind)) throw new Error("этот тип не планируется");
  if (!["time", "demand"].includes(mode)) throw new Error("mode: time | demand");
  if (mode === "time" && !/^([01]\d|2[0-3]):[0-5]\d$/.test(time || "")) {
    throw new Error("время в формате ЧЧ:ММ");
  }
  const value = JSON.stringify(mode === "time" ? { mode, time } : { mode });
  await _p.setting.upsert({
    where: { key: `slotmode:${kind}` },
    create: { key: `slotmode:${kind}`, value },
    update: { value },
  });
}

// ── Аккаунт ↔ рубильник ────────────────────────────────────────────────────
// Матрица маршрутов живёт в терминах площадок (ig_main / ig_woman / ig_man),
// а карточка в «Соц.Сетях» — в терминах аккаунтов. Карта связывает одно с
// другим и отвечает сразу на два вопроса: что гасить при архивации аккаунта и
// почему он сейчас не публикуется.
//
// ЗАВОДИТЕ НОВЫЙ АККАУНТ — впишите его сюда. Иначе он будет считаться
// незаводским: статистика собирается, публикация не предполагается.
export const ACCOUNT_PLATFORM: Record<string, string> = {
  "super.fit24": "ig_main",
  superfit24_woman: "ig_woman",
  superfit24_training: "ig_man",
  superfit05: "tiktok",
  SuperFit: "youtube",
};

export function platformFor(username: string): string | null {
  const u = (username || "").replace(/^@/, "");
  return ACCOUNT_PLATFORM[u] ?? null;
}
