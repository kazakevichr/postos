import { prisma } from "@/lib/prisma";
import { getAnketa } from "@/lib/anketa";
import { briefOf } from "@/lib/briefs";
import { brandTitle } from "@/lib/brands";
import { topicWay } from "@/lib/topicsource";
import { mainOf } from "@/lib/uploadpost";

// Новый завод (репозиторий content-factory) и всё, что Постос ему отдаёт.
//
// Старые заводы СуперФита и MoneyBall держат настройки в своих файлах на
// сервере. Новый не держит ничего: фото, голос, длина, концовка, угол подачи —
// всё заполняется в мастере формата и приезжает сюда вместе с заказом. Так
// новый проект запускается без единой правки на сервере.
//
// Доступ завода — ключ хоста (IG_HOST_KEY): завод работает на все проекты
// сразу и представляется брендом заказа в заголовке x-factory-brand там, где
// переиспользует общие ручки (отчёт по заказу, публикация).

export function engineAuth(req: Request): boolean {
  const need = process.env.IG_HOST_KEY;
  return Boolean(need) && req.headers.get("x-factory-key") === need;
}

export const HOST = "host";

export async function hostRow(brand: string) {
  return prisma.projectFormat.findUnique({ where: { brand_kind: { brand, kind: HOST } } });
}

export function cfgOf(row: { config: string } | null): any {
  try { return JSON.parse(row?.config || "{}"); } catch { return {}; }
}

/** Всё, что нужно заводу, чтобы собрать ролик Ведущего этого проекта. */
export async function hostConfig(brand: string) {
  const row = await hostRow(brand);
  const cfg = cfgOf(row);
  const [anketa, brief, title, way, main] = await Promise.all([
    getAnketa(brand), briefOf(brand), brandTitle(brand), topicWay(brand, HOST), mainOf(brand),
  ]);
  return {
    brand, title,
    photo: cfg.photo?.asset ? `/api/engine/asset?id=${cfg.photo.asset}` : "",
    logo: cfg.video?.logo ? `/api/engine/asset?id=${cfg.video.logo}` : "",
    voice: { id: cfg.voice?.id || "", speed: Number(cfg.voice?.speed || 1), style: Number(cfg.voice?.style ?? 0.35) },
    lang: cfg.lang || "ru",
    video: {
      min: Number(cfg.video?.min || 40), max: Number(cfg.video?.max || 60),
      inserts: cfg.video?.inserts || "mid", plates: cfg.video?.plates !== false,
      subtitles: cfg.video?.subtitles !== false,
      colors: cfg.video?.colors || ["#22D07A", "#FFFFFF"],
      ending: cfg.video?.ending || "",
    },
    angle: cfg.angle || "",
    source: { type: way.type, title: way.title, config: way.config },
    anketa, brief,
    upload_profile: main,
  };
}

// ── Расписание Ведущего → заказы ─────────────────────────────────────────────

const MSK_MS = 3 * 3600e3;
const GRACE_MIN = 3 * 60;
const daysFor = (per: number) => (per >= 7 ? [1, 2, 3, 4, 5, 6, 7] : per >= 5 ? [1, 2, 3, 4, 5] : per >= 3 ? [1, 3, 5] : per >= 1 ? [3] : []);
const mskNow = (t: Date) => {
  const d = new Date(t.getTime() + MSK_MS);
  return { date: d.toISOString().slice(0, 10), weekday: d.getUTCDay() || 7 };
};
const slotAt = (date: string, at: string) => Date.parse(`${date}T${at}:00.000Z`) - MSK_MS;

/** Заказы на подошедшие слоты: только у Ведущего, утверждённого пробным выпуском. */
async function refreshHost(brand: string, cfg: any, now: Date) {
  const per = Number(cfg.schedule?.perWeek || 0);
  const times: string[] = cfg.schedule?.times || [];
  const days = daysFor(per);
  for (const back of [1, 0]) {
    const day = mskNow(new Date(now.getTime() - back * 864e5));
    if (!days.includes(day.weekday)) continue;
    for (const at of times) {
      const late = (now.getTime() - slotAt(day.date, at)) / 60000;
      if (late < 0) continue;
      const key = { brand_date_kind_at: { brand, date: day.date, kind: HOST, at } };
      const have = await prisma.factoryOrder.findUnique({ where: key });
      if (have) continue;
      await prisma.factoryOrder.create({
        data: {
          brand, kind: HOST, date: day.date, at, approval: Boolean(cfg.approval),
          // Опоздал завод больше запаса — заказ заводится сразу пропущенным:
          // пропуск выпуска надо видеть, а не терять.
          ...(late > GRACE_MIN ? { state: "пропущен", doneAt: now, error: "завод не забрал заказ вовремя" } : {}),
        },
      });
    }
  }
}

/**
 * Следующая работа заводу: сначала пробные выпуски, потом заказы по расписанию.
 * Выдача — условным обновлением «план → выдан», как у старых заводов: два
 * запроса в одну секунду не получат один заказ дважды.
 */
export async function nextOrder(now = new Date()) {
  const busy = await prisma.factoryOrder.findFirst({
    where: { kind: HOST, state: { in: ["выдан", "собирается"] } },
  });
  // Завод собирает по одному ролику: оживление и рендер упираются в одну
  // машину, параллельная сборка только растянет обе.
  if (busy && now.getTime() - (busy.takenAt?.getTime() || 0) < 2 * 3600e3) return null;

  const live = await prisma.projectFormat.findMany({ where: { kind: HOST, status: "live" } });
  for (const r of live) await refreshHost(r.brand, cfgOf(r), now);

  const planned = await prisma.factoryOrder.findMany({ where: { kind: HOST, state: "план" } });
  const ready = planned
    .filter((o) => o.trial || ((now.getTime() - slotAt(o.date, o.at)) / 60000 >= 0
      && (now.getTime() - slotAt(o.date, o.at)) / 60000 <= GRACE_MIN))
    .sort((a, b) => Number(b.trial) - Number(a.trial) || slotAt(a.date, a.at) - slotAt(b.date, b.at))[0];
  if (!ready) return null;

  const cell = await prisma.planSlot.findUnique({
    where: { brand_date_slot: { brand: ready.brand, date: ready.date, slot: HOST } },
  });
  const won = await prisma.factoryOrder.updateMany({
    where: { id: ready.id, state: "план" },
    data: { state: "выдан", takenAt: now, topic: ready.topic || cell?.topic || "", facts: ready.facts || cell?.facts || "" },
  });
  if (won.count !== 1) return null;
  const order = await prisma.factoryOrder.findUniqueOrThrow({ where: { id: ready.id } });
  return { order, config: await hostConfig(order.brand) };
}

/** Пробный выпуск: заказ сразу, без расписания. Тема — из плана, ссылка или своя. */
export async function orderTrial(brand: string, topic = "") {
  const d = new Date(Date.now() + MSK_MS);
  const date = d.toISOString().slice(0, 10);
  let m = d.getUTCHours() * 60 + d.getUTCMinutes();
  let at = "";
  for (let i = 0; i < 30; i++, m++) {
    at = `${String(Math.floor(m / 60) % 24).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
    const busy = await prisma.factoryOrder.findUnique({ where: { brand_date_kind_at: { brand, date, kind: HOST, at } } });
    if (!busy) break;
  }
  return prisma.factoryOrder.create({
    data: { brand, kind: HOST, date, at, trial: true, deliverBot: false, approval: false, topic },
  });
}

// ── Служебные задачи ─────────────────────────────────────────────────────────

export async function addTask(brand: string, kind: string, input: any) {
  return prisma.engineTask.create({ data: { brand, kind, input: JSON.stringify(input || {}) } });
}

/** Задачи, которые завод ещё не взял. Брошенные дольше 10 минут — снова в работу. */
export async function takeTasks() {
  const stale = new Date(Date.now() - 10 * 60e3);
  const rows = await prisma.engineTask.findMany({
    where: { OR: [{ state: "new" }, { state: "taken", at: { lt: stale } }] },
    orderBy: { at: "asc" }, take: 5,
  });
  const out = [];
  for (const r of rows) {
    const won = await prisma.engineTask.updateMany({ where: { id: r.id, state: r.state }, data: { state: "taken", at: new Date() } });
    if (won.count === 1) out.push({ id: r.id, brand: r.brand, kind: r.kind, input: JSON.parse(r.input || "{}") });
  }
  return out;
}
