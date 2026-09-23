// Расписание завода — одно устройство на все бренды.
//
// Было два разных: у MoneyBall дни недели и несколько запусков в день, у
// СуперФита один ежедневный час в матрице маршрутов. Разные экраны для одного
// и того же — это то, обо что спотыкался Роман: «нужно, чтобы был единый, как
// у MoneyBall» (23.09.2026).
//
// Теперь правило общее: формат → режим (по расписанию / по запросу), список
// запусков (дни недели + время по Москве) и выдача в бот. Хранится строкой на
// бренд: Setting `factory:schedule:<бренд>`.
//
// СТАРОЕ РАСПИСАНИЕ СУПЕРФИТА ОСТАЛОСЬ ЖИТЬ РЯДОМ. Пока завод может вернуться
// на свой путь (тумблер «кто решает, когда производить»), он читает матрицу
// маршрутов — и запись туда дублируется. Иначе, вернув завод назад, человек
// получил бы вчерашнее расписание. Старый путь понимает только ОДИН запуск в
// день и целые часы: об этом пульт предупреждает прямо в карточке формата.
import { prisma } from "@/lib/prisma";
import { DEFAULT_BRAND } from "@/lib/factory";
import { MB_DEFAULTS, MB_FORMATS, MONEYBALL } from "@/lib/moneyball";
import { KINDS, SCHEDULABLE, scheduleMap, setSchedule as setLegacy } from "@/lib/routes";

export type Slot = { days: number[]; time: string };
export type Rule = { mode: "time" | "demand"; slots: Slot[]; bot: boolean };

const ALL = [1, 2, 3, 4, 5, 6, 7];
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const DAY_NAMES = ["пн", "вт", "ср", "чт", "пт", "сб", "вс"];
// Ключ хранения. У MoneyBall он остался прежним: расписание уже лежит там,
// и переезд ради красоты имени стоил бы заводу графика.
const KEY = (brand: string) => (brand === MONEYBALL ? "moneyball:schedule" : `factory:schedule:${brand}`);

/** Форматы бренда, которые вообще планируются. Словарь общий с заводом. */
export function brandFormats(brand: string): { kind: string; label: string; fromPlan: boolean }[] {
  if (brand === MONEYBALL) return MB_FORMATS;
  if (brand === DEFAULT_BRAND) {
    return SCHEDULABLE.map((kind) => ({
      kind,
      label: KINDS.find((k) => k.kind === kind)?.label || kind,
      // Темы из месячного плана берут все форматы СуперФита: так было и до
      // появления пульта.
      fromPlan: true,
    }));
  }
  return [];
}

/**
 * Расписание бренда. Сохранённое поверх умолчаний — по каждому формату
 * отдельно, чтобы новый формат не выпадал из расписания молча.
 *
 * Умолчания у СуперФита берутся из его старого расписания: переход не должен
 * менять час выпуска, о котором никто не просил.
 */
export async function scheduleOf(brand: string): Promise<Record<string, Rule>> {
  const row = await prisma.setting.findUnique({ where: { key: KEY(brand) } });
  let saved: Record<string, Rule> = {};
  try {
    saved = row ? JSON.parse(row.value) : {};
  } catch {
    // Битая запись не должна оставлять завод без расписания.
  }

  const out: Record<string, Rule> = {};
  if (brand === MONEYBALL) {
    for (const f of MB_FORMATS) {
      const rule = saved[f.kind] || MB_DEFAULTS[f.kind];
      out[f.kind] = { mode: rule.mode, slots: rule.slots || [], bot: rule.bot !== false };
    }
    return out;
  }

  const legacy = await scheduleMap();
  for (const f of brandFormats(brand)) {
    const s = legacy[f.kind] || { mode: "demand" };
    const fallback: Rule = {
      mode: s.mode === "time" ? "time" : "demand",
      slots: s.mode === "time" && s.time ? [{ days: [...ALL], time: s.time }] : [],
      bot: true,
    };
    const rule = saved[f.kind] || fallback;
    out[f.kind] = { mode: rule.mode, slots: rule.slots || [], bot: rule.bot !== false };
  }
  return out;
}

function clean(rule: any): Rule {
  if (!rule || !["time", "demand"].includes(rule.mode)) throw new Error("режим: по расписанию или по запросу");
  if (!Array.isArray(rule.slots) || rule.slots.length > 12) throw new Error("запусков должно быть от одного до двенадцати");
  const slots: Slot[] = rule.slots.map((s: any) => {
    const time = String(s?.time || "");
    if (!TIME.test(time)) throw new Error(`время «${time}» — нужно ЧЧ:ММ`);
    const raw: number[] = (Array.isArray(s?.days) ? s.days : []).map(Number);
    const days = [...new Set(raw)].filter((d) => Number.isInteger(d) && d >= 1 && d <= 7).sort((a, b) => a - b);
    if (!days.length) throw new Error(`у запуска в ${time} не выбран ни один день`);
    return { days, time };
  });
  if (rule.mode === "time" && !slots.length) throw new Error("для режима «по расписанию» нужен хотя бы один запуск");
  slots.sort((a, b) => a.time.localeCompare(b.time) || a.days[0] - b.days[0]);
  return { mode: rule.mode, slots, bot: rule.bot !== false };
}

export async function setRule(brand: string, kind: string, rule: unknown) {
  if (!brandFormats(brand).some((f) => f.kind === kind)) throw new Error("у этого завода нет такого формата");
  const all = await scheduleOf(brand);
  all[kind] = clean(rule);
  const value = JSON.stringify(all);
  await prisma.setting.upsert({
    where: { key: KEY(brand) },
    create: { key: KEY(brand), value },
    update: { value },
  });

  // Старый путь СуперФита должен остаться согласованным: он понимает один
  // запуск в день, поэтому забирает первый по времени.
  if (brand === DEFAULT_BRAND) {
    const r = all[kind];
    await setLegacy(kind, r.mode, r.slots[0]?.time || "08:00").catch(() => {});
  }
  return all;
}

export function daysLabel(d: number[]) {
  if (d.length === 7) return "ежедневно";
  if (d.join() === "1,2,3,4,5") return "пн–пт";
  return d.map((x) => DAY_NAMES[x - 1]).join(", ");
}

export function ruleLabel(rule: Rule) {
  if (rule.mode !== "time") return "по запросу";
  const ordered = [...rule.slots].sort((a, b) => a.days[0] - b.days[0] || a.time.localeCompare(b.time));
  const byDays = new Map<string, string[]>();
  for (const s of ordered) {
    const k = daysLabel(s.days);
    byDays.set(k, [...(byDays.get(k) || []), s.time]);
  }
  return [...byDays].map(([d, t]) => `${d} ${t.join(", ")}`).join(" · ");
}
