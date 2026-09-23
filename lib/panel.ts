// Пульт завода: одни и те же данные для любого бренда.
//
// Заводы устроены по-разному — у MoneyBall расписание по дням недели и выдача
// в бот, у СуперФита ежедневные слоты, площадки и согласование, — но экран
// один. Правило простое: НАБОР БЛОКОВ И ТУМБЛЕРОВ ОДИНАКОВЫЙ ВЕЗДЕ, а то,
// чего завод ещё не умеет, показывается с пометкой «пока не подключено», а не
// прячется. Спрятанная настройка выглядит как её отсутствие, и человек не
// может понять, панель разная или заводы разные (замечание Романа 23.09.2026).
//
// Пока источники разные: у MoneyBall это заказы и его расписание, у СуперФита
// — матрица маршрутов и журнал. Когда СуперФит переедет на заказы, вторая
// половина этого файла схлопнется в первую.
import { prisma } from "@/lib/prisma";
import { brandLabel } from "@/lib/brands";
import { DEFAULT_BRAND } from "@/lib/factory";
import { MB_FORMATS, MONEYBALL } from "@/lib/moneyball";
import { brandFormats, ruleLabel, scheduleOf } from "@/lib/schedule";
import { msk, ordersEnabled, ordersOf, refresh } from "@/lib/orders";
import { archivedOf, channelsOf, STATE_WORD, type ChannelView } from "@/lib/channels";
import { brandBot, formatOf } from "@/lib/formats";
import {
  KINDS, blocked, kindsWithDonors, publishMap, routeMap,
} from "@/lib/routes";

export const DELIVERY_BOT = "@autopostingdobro_bot";
const DAYS = ["пн", "вт", "ср", "чт", "пт", "сб", "вс"];
const mins = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));

export type PanelSlot = { days: number[]; time: string };
export type PanelRoute = { ch: string; on: boolean; state: string; word: string };
export type PanelFormat = {
  kind: string; label: string; note: string;
  mode: "time" | "demand" | "event" | "mirror";
  slots: PanelSlot[]; when: string; week: number; next: string; publish: string;
  bot: boolean; approval: boolean; off: boolean;
  routes: PanelRoute[]; warn: string; canSchedule: boolean; canProduce: boolean;
};



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

const WORD: Record<string, string> = { ...STATE_WORD, off: "выкл", locked: "нельзя" };

function routeState(ch: ChannelView | undefined, on: boolean, locked: boolean) {
  if (locked) return "locked";
  if (!on || !ch) return "off";
  return ch.state;
}

function warnOf(f: { mode: string; bot: boolean; off: boolean; routes: PanelRoute[] }, hasChannels: boolean, botOn: boolean) {
  if (f.off) return "донор выключен: нарезки по нему не делаются";
  if (f.mode === "demand") return "";
  const live = f.routes.filter((r) => r.state === "auto" || r.state === "manual");
  const bot = f.bot && botOn;
  if (!live.length && !bot) return "отдавать некуда: выключены и бот, и все каналы";
  if (!live.length && hasChannels) return "только в бот: каналы выключены или на паузе";
  return "";
}

// ── MoneyBall: расписание и заказы ─────────────────────────────────────────
async function moneyballPanel(now: ReturnType<typeof msk>) {
  await refresh(MONEYBALL).catch(() => {});
  const sched = await scheduleOf(MONEYBALL);
  const channels = await channelsOf(MONEYBALL);
  const botOn = await brandBot(MONEYBALL);

  const formats: PanelFormat[] = [];
  for (const f of MB_FORMATS) {
    const rule = sched[f.kind];
    const set = await formatOf(MONEYBALL, f.kind);
    const slots = rule.mode === "time" ? rule.slots : [];
    const base = {
      kind: f.kind, label: f.label,
      note: f.fromPlan ? "тема из плана, без неё завод ищет сам" : "тему находит завод",
      mode: rule.mode as PanelFormat["mode"],
      slots: rule.slots, when: ruleLabel(rule),
      week: slots.reduce((n, s) => n + s.days.length, 0),
      next: rule.mode === "time" ? nextRun(rule.slots, now) : "",
      publish: "сразу",
      // Выдача уезжает в заказ полем deliver_bot, и завод её слушает.
      // Согласования у MoneyBall нет вовсе.
      bot: set.bot, approval: set.approval, off: false,
      routes: [] as PanelRoute[], canSchedule: true, canProduce: true,
    };
    formats.push({ ...base, warn: warnOf(base, channels.length > 0, botOn) });
  }

  const orders = await ordersOf(MONEYBALL, now.date);
  const today = orders.map((o) => ({
    at: o.at, kind: o.kind,
    label: MB_FORMATS.find((f) => f.kind === o.kind)?.label || o.kind,
    state: o.state, topic: o.topic, error: o.error, seconds: o.seconds,
  }));
  return {
    channels, archived: await archivedOf(MONEYBALL), botOn,
    groups: [{ title: "По расписанию", formats }], today,
    caps: {
      publisher: "Постос",
      // Маршруты форматов по каналам есть только у СуперФита: у MoneyBall
      // готовое уходит в бот, и матрицы «формат × канал» у него нет.
      routes: false,
      botToggle: "live",
      // Согласования текста у этого завода нет: ролик собирается сразу.
      approvalToggle: "pending",
      approvalNote: "завод MoneyBall пока не умеет согласование: ролик собирается сразу",
      scheduleDays: true,
    },
  };
}

// ── СуперФит: матрица маршрутов и журнал ───────────────────────────────────
async function superfitPanel(now: ReturnType<typeof msk>) {
  const [sched, flags, publish, kinds, channels] = await Promise.all([
    scheduleOf(DEFAULT_BRAND), routeMap(), publishMap(), kindsWithDonors(), channelsOf(DEFAULT_BRAND),
  ]);
  const byKey = new Map(channels.map((c) => [c.key, c]));
  const botOn = await brandBot(DEFAULT_BRAND);

  const make = async (k: { kind: string; label: string; note: string }): Promise<PanelFormat> => {
    const set = await formatOf(DEFAULT_BRAND, k.kind);
    const routes: PanelRoute[] = channels.map((c) => {
      const locked = blocked(c.key, k.kind);
      const on = Boolean(flags[`${c.key}|${k.kind}`]);
      const state = routeState(byKey.get(c.key), on, locked);
      return { ch: c.key, on, state, word: WORD[state] || state };
    });
    const common = { ...k, bot: set.bot, approval: set.approval, off: set.off, routes };
    const base = k.kind.startsWith("repost:")
      ? {
          ...common, mode: "event" as const, slots: [], week: 0, next: "",
          when: "по событию: донор выложил ролик",
          publish: publish[k.kind]?.mode === "at" ? String(publish[k.kind].at) : "сразу",
          canSchedule: false, canProduce: true,
        }
      : k.kind === "manual"
      ? {
          ...common, mode: "mirror" as const, slots: [], week: 0, next: "",
          when: "после вашего поста", publish: "сразу", canSchedule: false, canProduce: false,
        }
      : (() => {
          const rule = sched[k.kind] || { mode: "demand" as const, slots: [] };
          const slots: PanelSlot[] = rule.mode === "time" ? rule.slots : [];
          return {
            ...common, mode: rule.mode as PanelFormat["mode"],
            slots: rule.slots, when: ruleLabel(rule),
            week: slots.reduce((n, x) => n + x.days.length, 0), next: nextRun(slots, now), publish: "сразу",
            canSchedule: true, canProduce: true,
          };
        })();
    return { ...base, warn: warnOf(base, channels.length > 0, botOn) };
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

  const scheduled = [];
  for (const f of brandFormats(DEFAULT_BRAND)) {
    scheduled.push(await make({ kind: f.kind, label: f.label, note: NOTE[f.kind] || "" }));
  }
  const donors = [];
  for (const k of kinds.filter((x) => x.kind.startsWith("repost:"))) {
    donors.push(await make({ kind: k.kind, label: k.label.replace("Нарезки · ", ""), note: "донор выложил ролик — завод делает нарезку" }));
  }
  const rest = [];
  for (const k of KINDS.filter((x) => x.kind === "manual")) rest.push(await make({ kind: k.kind, label: k.label, note: NOTE[k.kind] || "" }));

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
    at: msk(j.at).time, kind: j.kind || j.slot, label: label(j.kind || j.slot),
    state: EVENT[j.event] || j.event || "в работе",
    topic: j.topic, error: j.error, seconds: j.seconds,
  }));

  return {
    channels, archived: await archivedOf(DEFAULT_BRAND), botOn,
    groups: [
      { title: "По расписанию", formats: scheduled },
      ...(donors.length ? [{ title: "Нарезки · по событию", formats: donors }] : []),
      { title: "Без участия завода", formats: rest },
    ],
    today,
    caps: {
      publisher: "завод",
      routes: true,
      // Эти два тумблера Постос уже хранит, но завод СуперФита пока читает
      // свои настройки. Честно говорим об этом прямо в пульте.
      botToggle: "pending",
      botNote: "завод пока всегда отдаёт готовое в бот: тумблер начнёт работать, когда он научится читать это из заказа",
      approvalToggle: "pending",
      approvalNote: "сейчас согласование задано на заводе: тумблер начнёт работать, когда он научится читать это из заказа",
      scheduleDays: true,
      scheduleNote: "пока заказами управляет Постос, расписание работает целиком. Вернёте завод на собственное — он поймёт только первый запуск в день, целый час и без выбора дней",
    },
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
    // Кто решает, когда производить. У MoneyBall выбора нет — он построен
    // только под заказы; у остальных это переключается.
    orders: await ordersEnabled(brand),
    ordersSwitchable: brand !== MONEYBALL && Boolean(body),
    ...(body || { channels: [], archived: [], botOn: true, groups: [], today: [], caps: null }),
    known: Boolean(body),
  };
}
