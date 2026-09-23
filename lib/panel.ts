// Пульт завода: одни и те же данные для любого бренда.
//
// Заводы устроены по-разному — у MoneyBall расписание по дням недели и выдача
// в бот, у СуперФита ежедневные слоты, площадки и согласование, — но вопросы к
// ним одинаковые: что выходит, когда, куда и почему не вышло. Здесь эти ответы
// собираются в один вид, чтобы экран не знал про особенности каждого завода.
//
// Пока источники разные: у MoneyBall это заказы и его расписание, у СуперФита
// — матрица маршрутов и журнал. Когда СуперФит переедет на заказы, вторая
// половина этого файла схлопнется в первую.
import { prisma } from "@/lib/prisma";
import { brandLabel } from "@/lib/brands";
import { DEFAULT_BRAND } from "@/lib/factory";
import { MB_FORMATS, MONEYBALL, mbSchedule } from "@/lib/moneyball";
import { msk, ordersOf, refresh } from "@/lib/orders";
import { channelsOf, STATE_WORD, type ChannelView } from "@/lib/channels";
import {
  KINDS, baseKind, blocked, kindsWithDonors, publishMap, routeMap, scheduleMap, SCHEDULABLE,
} from "@/lib/routes";

export const DELIVERY_BOT = "@autopostingdobro_bot";
const DAYS = ["пн", "вт", "ср", "чт", "пт", "сб", "вс"];
const ALL = [1, 2, 3, 4, 5, 6, 7];
const mins = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));

export type PanelSlot = { days: number[]; time: string };
export type PanelRoute = { ch: string; on: boolean; state: string; word: string };
export type PanelFormat = {
  kind: string; label: string; note: string;
  mode: "time" | "demand" | "event" | "mirror";
  slots: PanelSlot[]; when: string; week: number; next: string;
  bot: boolean | null; routes: PanelRoute[]; warn: string;
};

function daysLabel(d: number[]) {
  if (d.length === 7) return "ежедневно";
  if (d.join() === "1,2,3,4,5") return "пн–пт";
  return d.map((x) => DAYS[x - 1]).join(", ");
}

function whenLabel(slots: PanelSlot[]) {
  const groups = new Map<string, string[]>();
  [...slots]
    .sort((a, b) => a.days[0] - b.days[0] || mins(a.time) - mins(b.time))
    .forEach((s) => {
      const k = daysLabel(s.days);
      groups.set(k, [...(groups.get(k) || []), s.time]);
    });
  return [...groups].map(([d, t]) => `${d} ${t.join(", ")}`).join(" · ");
}

function nextRun(slots: PanelSlot[], now: { weekday: number; minutes: number }) {
  for (let add = 0; add < 8; add++) {
    const day = ((now.weekday - 1 + add) % 7) + 1;
    let best = "";
    for (const s of slots) {
      if (!s.days.includes(day)) continue;
      if (add === 0 && mins(s.time) <= now.minutes) continue;
      if (!best || mins(s.time) < mins(best)) best = s.time;
    }
    if (best) return `${add === 0 ? "сегодня" : add === 1 ? "завтра" : DAYS[day - 1]} ${best}`;
  }
  return "";
}

/** Куда ролик реально выйдет: маршрут включён, канал не на паузе и не заперт. */
function routeState(ch: ChannelView | undefined, on: boolean, locked: boolean): PanelRoute["state"] {
  if (locked) return "locked";
  if (!on) return "off";
  if (!ch) return "off";
  return ch.state; // auto | manual | pause
}

const WORD: Record<string, string> = { ...STATE_WORD, off: "выкл", locked: "нельзя" };

function warnOf(f: { mode: string; bot: boolean | null; routes: PanelRoute[] }, hasChannels: boolean) {
  if (f.mode === "demand") return "";
  const live = f.routes.filter((r) => r.state === "auto" || r.state === "manual");
  if (!live.length && f.bot === false) return "отдавать некуда: выключены и бот, и все каналы";
  if (!live.length && hasChannels) return "только в бот: каналы выключены или на паузе";
  return "";
}

// ── MoneyBall: расписание и заказы ─────────────────────────────────────────
async function moneyballPanel(now: ReturnType<typeof msk>) {
  await refresh(MONEYBALL).catch(() => {});
  const sched = await mbSchedule();
  const channels = await channelsOf(MONEYBALL);
  const formats: PanelFormat[] = MB_FORMATS.map((f) => {
    const rule = sched[f.kind];
    const slots = rule.mode === "time" ? rule.slots : [];
    const base = {
      kind: f.kind, label: f.label,
      note: f.fromPlan ? "тема из плана, без неё завод ищет сам" : "тему находит завод",
      mode: rule.mode as PanelFormat["mode"],
      slots: rule.slots, when: rule.mode === "time" ? whenLabel(rule.slots) : "по запросу",
      week: slots.reduce((n, s) => n + s.days.length, 0),
      next: rule.mode === "time" ? nextRun(rule.slots, now) : "",
      bot: rule.bot, routes: [] as PanelRoute[],
    };
    return { ...base, warn: warnOf(base, channels.length > 0) };
  });

  const orders = await ordersOf(MONEYBALL, now.date);
  const today = orders.map((o) => ({
    at: o.at, kind: o.kind,
    label: MB_FORMATS.find((f) => f.kind === o.kind)?.label || o.kind,
    state: o.state, topic: o.topic, error: o.error, seconds: o.seconds,
  }));
  return { channels, groups: [{ title: "По расписанию", formats }], today, scheduleApi: "moneyball" };
}

// ── СуперФит: матрица маршрутов и журнал ───────────────────────────────────
async function superfitPanel(now: ReturnType<typeof msk>) {
  const [sched, flags, publish, kinds, channels] = await Promise.all([
    scheduleMap(), routeMap(), publishMap(), kindsWithDonors(), channelsOf(DEFAULT_BRAND),
  ]);
  const byKey = new Map(channels.map((c) => [c.key, c]));

  const make = (k: { kind: string; label: string; note: string }): PanelFormat => {
    const routes: PanelRoute[] = channels.map((c) => {
      const locked = blocked(c.key, k.kind);
      const on = Boolean(flags[`${c.key}|${k.kind}`]);
      const state = routeState(byKey.get(c.key), on, locked);
      return { ch: c.key, on, state, word: WORD[state] || state };
    });
    const base = k.kind.startsWith("repost:")
      ? {
          ...k, mode: "event" as const, slots: [], week: 0, next: "",
          when: publish[k.kind]?.mode === "at" ? `выпуск в ${publish[k.kind].at}` : "выходит сразу",
          bot: null, routes,
        }
      : k.kind === "manual"
      ? { ...k, mode: "mirror" as const, slots: [], week: 0, next: "", when: "после вашего поста", bot: null, routes }
      : (() => {
          const s = sched[k.kind] || { mode: "demand" };
          const slots: PanelSlot[] = s.mode === "time" && s.time ? [{ days: [...ALL], time: s.time }] : [];
          return {
            ...k, mode: (s.mode === "time" ? "time" : "demand") as PanelFormat["mode"],
            slots, when: s.mode === "time" ? whenLabel(slots) : "по запросу",
            week: slots.length ? 7 : 0, next: nextRun(slots, now), bot: null, routes,
          };
        })();
    return { ...base, warn: warnOf(base, channels.length > 0) };
  };

  const NOTE: Record<string, string> = {
    make: "тема из плана, без неё завод придумывает сам",
    carousel: "про еду, по рубрикам",
    carousel_new: "фотореализм",
    avatar: "говорящий персонаж по теме дня",
    "trainer:female": "тренировка с упражнениями",
    "trainer:male": "тренировка с упражнениями",
    manual: "ваш пост в Instagram — зеркалом на видеоплощадки",
  };
  const label = (kind: string) => kinds.find((k) => k.kind === kind)?.label || kind;

  const scheduled = SCHEDULABLE.map((kind) => make({ kind, label: label(kind), note: NOTE[kind] || "" }));
  const donors = kinds
    .filter((k) => k.kind.startsWith("repost:"))
    .map((k) => make({ kind: k.kind, label: k.label.replace("Нарезки · ", ""), note: "донор выложил ролик — завод делает нарезку" }));
  const rest = KINDS.filter((k) => k.kind === "manual").map((k) => make({ kind: k.kind, label: k.label, note: NOTE[k.kind] || "" }));

  // Журнал за сегодня: у СуперФита заказов пока нет, и «что было» знает он.
  const since = new Date(Date.parse(`${now.date}T00:00:00.000Z`) - 3 * 3600 * 1000);
  const jobs = await prisma.factoryJob.findMany({
    where: { brand: DEFAULT_BRAND, at: { gte: since } },
    orderBy: { at: "asc" },
  });
  const EVENT: Record<string, string> = {
    "создан": "собирается", "готов": "готов", "опубликован": "опубликован",
    "не принят": "не принят", "брак": "брак", "ошибка": "ошибка",
  };
  const today = jobs.map((j) => ({
    at: msk(j.at).time, kind: j.kind || j.slot,
    label: label(j.kind || j.slot),
    state: EVENT[j.event] || j.event || "в работе",
    topic: j.topic, error: j.error, seconds: j.seconds,
  }));

  return {
    channels,
    groups: [
      { title: "По расписанию", formats: scheduled },
      ...(donors.length ? [{ title: "Нарезки · по событию", formats: donors }] : []),
      { title: "Без участия завода", formats: rest },
    ],
    today,
    scheduleApi: "superfit",
  };
}

/** Всё, что нужно пульту одного завода. */
export async function panelData(brand: string) {
  const now = msk();
  const body =
    brand === MONEYBALL ? await moneyballPanel(now)
    : brand === DEFAULT_BRAND ? await superfitPanel(now)
    : null;
  return {
    brand, label: brandLabel(brand), tz: "Europe/Moscow", now, bot: DELIVERY_BOT,
    ...(body || { channels: [], groups: [], today: [], scheduleApi: null }),
    // Заводы, до которых пульт ещё не дотянулся (Оракл), честно говорят об
    // этом: они публикуют сами и о своих планах Постосу не сообщают.
    known: Boolean(body),
  };
}
