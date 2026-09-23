// Завод MoneyBall: его форматы и расписание.
//
// Всё, что касается только MoneyBall, живёт здесь и названо по бренду. Рядом
// лежат ручки /api/factory/* — общий контракт, по которому ходят все заводы,
// и расписание СуперФита внутри него. Назови мы расписание MoneyBall тоже
// «factory», через месяц никто бы не сказал, чьё оно. Журнал, план тем и брак
// MoneyBall берёт общие: там, чей заказ, решает ключ завода.
//
// Расписание устроено иначе, чем у СуперФита, потому что иначе устроен
// график. Новости выходят дважды в день, Прогнозы — в разные дни в разное
// время, Персонаж — раз в неделю. Модель СуперФита «каждый день в ЧЧ:ММ» это
// не выражает, а расширять её значило бы трогать завод, который работает.
import { prisma } from "@/lib/prisma";

export const MONEYBALL = "moneyball";

/**
 * Форматы завода. kind — общий словарь с заводом: те же имена стоят в
 * moneyball-factory, auto/timetable.py → FORMATS. Переименование — всегда
 * парой правок, в обоих репозиториях.
 *
 * fromPlan — берёт ли формат тему из плана. Новости разбирают чужой ролик,
 * Прогнозы — матчи дня: тема рождается на заводе, и вписанная в план будет
 * проигнорирована. Персонаж, наоборот, берёт тему из плана, а без неё ищет
 * сам.
 */
export const MB_FORMATS = [
  { kind: "news", label: "ИИ-аватар Новости", fromPlan: false },
  { kind: "forecast", label: "ИИ-аватар Прогнозы", fromPlan: false },
  { kind: "make", label: "Персонаж", fromPlan: true },
];

/** Один запуск в неделе: дни (1 — понедельник … 7 — воскресенье) и время старта по Москве. */
export type MbSlot = { days: number[]; time: string };
/**
 * Правило формата: когда собирать и куда отдавать готовое.
 *
 * bot — выдача в телеграм-бот. Это такой же тумблер, как площадка: её можно
 * выключить и оставить только соцсети (решение Романа 23.09.2026). Пока
 * площадок у MoneyBall нет, выключенная выдача означает, что ролик не увидит
 * никто, — пульт об этом предупреждает.
 */
export type MbRule = { mode: "time" | "demand"; slots: MbSlot[]; bot: boolean };

const EVERY_DAY = [1, 2, 3, 4, 5, 6, 7];

// График, согласованный с Романом 22.09.2026. Время — старт сборки, как у
// СуперФита: ролик приходит в бот выдачи позже, когда соберётся.
//
// Вторник у Прогнозов — каждую неделю, без пропусков: если топ-лиги в этот
// вечер не играют, завод расширяет выбор матчей сам (решение Романа того же
// дня). Поэтому здесь нет ни календаря еврокубков, ни признака «если есть».
const DEFAULTS: Record<string, MbRule> = {
  news: {
    mode: "time",
    slots: [
      { days: EVERY_DAY, time: "09:00" },
      { days: EVERY_DAY, time: "19:00" },
    ],
    bot: true,
  },
  forecast: {
    mode: "time",
    slots: [
      { days: [6, 7], time: "10:30" },
      { days: [2], time: "13:00" },
    ],
    bot: true,
  },
  make: { mode: "time", slots: [{ days: [4], time: "20:00" }], bot: true },
};

const KEY = "moneyball:schedule";
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const DAY_NAMES = ["пн", "вт", "ср", "чт", "пт", "сб", "вс"];

/**
 * Расписание всех форматов. Сохранённое поверх значений по умолчанию —
 * по каждому формату отдельно: новый формат, про который база ещё не знает,
 * получает свой график, а не выпадает из расписания молча.
 */
export async function mbSchedule(): Promise<Record<string, MbRule>> {
  const row = await prisma.setting.findUnique({ where: { key: KEY } });
  let saved: Record<string, MbRule> = {};
  try {
    saved = row ? JSON.parse(row.value) : {};
  } catch {
    // Битая запись не должна оставлять завод без расписания.
  }
  const out: Record<string, MbRule> = {};
  for (const f of MB_FORMATS) {
    const rule = saved[f.kind] || DEFAULTS[f.kind];
    // Записи, сделанные до появления тумблера выдачи, читаются как «бот
    // включён»: так было, пока выключить его было нечем.
    out[f.kind] = { ...rule, bot: rule.bot !== false };
  }
  return out;
}

/** Проверить и привести правило к виду, в котором его хранят и отдают заводу. */
function clean(rule: any): MbRule {
  if (!rule || !["time", "demand"].includes(rule.mode)) {
    throw new Error("режим: по времени или по запросу");
  }
  if (!Array.isArray(rule.slots) || rule.slots.length > 12) {
    throw new Error("запусков должно быть от одного до двенадцати");
  }
  const slots: MbSlot[] = rule.slots.map((s: any) => {
    const time = String(s?.time || "");
    if (!TIME.test(time)) throw new Error(`время «${time}» — нужно ЧЧ:ММ`);
    const raw: number[] = (Array.isArray(s?.days) ? s.days : []).map(Number);
    const days = [...new Set(raw)]
      .filter((d) => Number.isInteger(d) && d >= 1 && d <= 7)
      .sort((a, b) => a - b);
    if (!days.length) throw new Error(`у запуска в ${time} не выбран ни один день`);
    return { days, time };
  });
  // Запуски храним и в режиме «по запросу»: вернули «по времени» — график на
  // месте, набирать его заново не нужно.
  if (rule.mode === "time" && !slots.length) {
    throw new Error("для режима «по времени» нужен хотя бы один запуск");
  }
  slots.sort((a, b) => a.time.localeCompare(b.time) || a.days[0] - b.days[0]);
  return { mode: rule.mode, slots, bot: rule.bot !== false };
}

export async function setMbRule(kind: string, rule: unknown) {
  if (!MB_FORMATS.some((f) => f.kind === kind)) throw new Error("у MoneyBall нет такого формата");
  const all = await mbSchedule();
  all[kind] = clean(rule);
  const value = JSON.stringify(all);
  await prisma.setting.upsert({ where: { key: KEY }, create: { key: KEY, value }, update: { value } });
  return all;
}

/** Дни человеческими словами: «ежедневно», «сб, вс», «пн–пт». */
export function daysLabel(days: number[]): string {
  if (days.length === 7) return "ежедневно";
  if (days.join() === "1,2,3,4,5") return "пн–пт";
  return days.map((d) => DAY_NAMES[d - 1]).join(", ");
}

/** Правило одной строкой: «ежедневно 09:00, 19:00» или «сб, вс 10:30 · вт 13:00». */
export function ruleLabel(rule: MbRule): string {
  if (rule.mode !== "time") return "по запросу";
  // По порядку недели, а не по порядку ввода: «вт 13:00 · сб, вс 10:30».
  const ordered = [...rule.slots].sort((a, b) => a.days[0] - b.days[0] || a.time.localeCompare(b.time));
  const byDays = new Map<string, string[]>();
  for (const s of ordered) {
    const k = daysLabel(s.days);
    byDays.set(k, [...(byDays.get(k) || []), s.time]);
  }
  return [...byDays].map(([d, times]) => `${d} ${times.join(", ")}`).join(" · ");
}

/** Подписи всех правил — для экрана, чтобы браузеру не собирать их заново. */
export function scheduleLabels(schedule: Record<string, MbRule>): Record<string, string> {
  return Object.fromEntries(Object.entries(schedule).map(([k, r]) => [k, ruleLabel(r)]));
}
