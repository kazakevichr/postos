// Заказы заводам: здесь Постос решает, когда производить.
//
// Прежде завод сам смотрел на расписание и сам начинал сборку. Теперь
// наоборот: Постос в назначенное время заводит заказ, а завод раз в полминуты
// спрашивает, нет ли работы, и берёт её. Решение Романа 22.09.2026: «завод
// только производит и только тогда, когда Постос говорит ему производить».
//
// Что это даёт, кроме порядка в голове: расписание нельзя рассинхронизировать
// (у завода его больше нет), журнал ведётся с первой минуты заказа, а не с
// первого отчёта завода, и остановка завода — это просто «не выдавать
// заказы», без похода на сервер.
//
// ПОЧЕМУ ЗАВОД СПРАШИВАЕТ, А НЕ ПОСТОС СТУЧИТСЯ. У заводов нет открытых
// портов, они живут в своих контейнерах. Очередь заказов работает и когда
// завод перезапускался: заказ лежит и ждёт, а не теряется в неудавшемся
// запросе.
import { prisma } from "@/lib/prisma";
import { DEFAULT_BRAND, DELIVERY_ONLY } from "@/lib/factory";
import { MB_FORMATS, MONEYBALL, mbSchedule } from "@/lib/moneyball";
import { SCHEDULABLE, scheduleMap } from "@/lib/routes";

/** Расписание заводов живёт в московском времени — один сдвиг на всё. */
const MSK_MS = 3 * 60 * 60 * 1000;
/** Сколько заказ ждёт завода. Дальше он уже не нужен: Новости в 09:00,
 *  собранные в 13:00, — это не «догнали», это мусор в ленте. */
const GRACE_MIN = 3 * 60;

/**
 * Через сколько взятый заказ считается потерянным. Сам не повторяем — сборка
 * стоит денег, повтор решает человек.
 *
 * У заводов это очень разное время. MoneyBall собирает ролик подряд, и два
 * часа молчания значат, что он упал. У СуперФита между «взял» и «готов» стоит
 * согласование текста человеком: там заказ может честно ждать полдня.
 */
const STALE_MIN: Record<string, number> = { [MONEYBALL]: 120, [DEFAULT_BRAND]: 12 * 60 };
const staleOf = (brand: string) => STALE_MIN[brand] ?? 120;

/**
 * Заводы, которые берут заказы по одному.
 *
 * MoneyBall собирает ролик целиком в одном процессе — вторая сборка ему не
 * нужна ни по памяти, ни по деньгам. У СуперФита своя очередь и своё
 * согласование: заказ на Персонажа, ждущий кнопки, не должен задерживать
 * ИИ-аватара, у которого свой час.
 */
const SINGLE = new Set([MONEYBALL]);

/**
 * Заводы, которым Постос выдаёт заказы.
 *
 * MoneyBall — всегда: он для этого и построен. СуперФит переключается
 * тумблером в пульте, потому что на его стороне остаётся старый путь, и
 * переключать надо в два действия и с возможностью вернуться.
 */
export async function ordersEnabled(brand: string) {
  if (brand === MONEYBALL) return true;
  if (brand !== DEFAULT_BRAND) return false;
  const row = await prisma.setting.findUnique({ where: { key: `orders:${brand}` } });
  return row?.value === "on";
}

export async function setOrders(brand: string, on: boolean) {
  if (brand === MONEYBALL) throw new Error("MoneyBall работает только по заказам");
  const value = on ? "on" : "off";
  await prisma.setting.upsert({
    where: { key: `orders:${brand}` },
    create: { key: `orders:${brand}`, value },
    update: { value },
  });
  // Вернули завод на старый путь — незабранные заказы убираем. Иначе они
  // доживут до конца запаса и лягут в журнал пропусками, которых не было:
  // завод в это время работал по своему расписанию.
  if (!on) await prisma.factoryOrder.deleteMany({ where: { brand, state: "план" } });
}

export async function orderBrands() {
  const out = [MONEYBALL];
  if (await ordersEnabled(DEFAULT_BRAND)) out.push(DEFAULT_BRAND);
  return out;
}

type Moment = { date: string; weekday: number; time: string; minutes: number };

/**
 * Московские сутки, день недели (1 — понедельник) и время.
 *
 * Считаем сами, а не через локаль сервера: контейнер живёт по UTC, а
 * расписание заводов — по Москве, и «сегодня» у них разное.
 */
export function msk(when: Date = new Date()): Moment {
  const d = new Date(when.getTime() + MSK_MS);
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  return {
    date: d.toISOString().slice(0, 10),
    weekday: d.getUTCDay() === 0 ? 7 : d.getUTCDay(),
    time: `${hh}:${mm}`,
    minutes: d.getUTCHours() * 60 + d.getUTCMinutes(),
  };
}

/** Момент слота в обычном времени: дата и ЧЧ:ММ заданы по Москве. */
function slotAt(date: string, at: string): number {
  return Date.parse(`${date}T${at}:00.000Z`) - MSK_MS;
}

export function jobIdOf(o: { date: string; kind: string; at: string }) {
  return `${o.date}_${o.kind}_${o.at.replace(":", "")}`;
}

type Slot = { kind: string; date: string; at: string; late: number; bot: boolean };

/**
 * Слоты, чьё время уже настало — сегодня и вчера.
 *
 * Просроченные тоже возвращаем: заказ на них всё равно заводится и тут же
 * закрывается как пропущенный. Иначе слот, на котором завода не было на
 * связи, исчезал бы бесследно — а пропуск выпуска надо видеть.
 *
 * Вчерашние нужны ради запаса на опоздание: запуск в 23:00 остаётся
 * положенным и в полночь.
 */
async function dueSlots(brand: string, now: Date): Promise<Slot[]> {
  if (!(await ordersEnabled(brand))) return []; // завод пока живёт по-старому

  // Расписания у заводов разные: у MoneyBall дни недели и несколько запусков,
  // у СуперФита один ежедневный час на тип. Наружу оба выглядят одинаково.
  const rules: { kind: string; days: number[]; time: string; bot: boolean }[] = [];
  if (brand === MONEYBALL) {
    const sched = await mbSchedule();
    for (const f of MB_FORMATS) {
      const rule = sched[f.kind];
      if (!rule || rule.mode !== "time") continue;
      for (const s of rule.slots) rules.push({ kind: f.kind, days: s.days, time: s.time, bot: rule.bot !== false });
    }
  } else {
    const sched = await scheduleMap();
    for (const kind of SCHEDULABLE) {
      const s = sched[kind];
      if (s?.mode !== "time" || !s.time) continue;
      rules.push({ kind, days: [1, 2, 3, 4, 5, 6, 7], time: s.time, bot: true });
    }
  }

  const out: Slot[] = [];
  for (const back of [1, 0]) {
    const day = msk(new Date(now.getTime() - back * 864e5));
    for (const r of rules) {
      if (!r.days.includes(day.weekday)) continue;
      const late = (now.getTime() - slotAt(day.date, r.time)) / 60000;
      if (late < 0) continue;
      out.push({ kind: r.kind, date: day.date, at: r.time, late, bot: r.bot });
    }
  }
  return out.sort((a, b) => b.late - a.late); // самый старый — первым
}

/** Событие в журнал производства: он остался общим для всех заводов. */
async function toJournal(o: { brand: string; kind: string; date: string; at: string; topic: string; script: string; seconds: number; cost: number }, event: string, error = "") {
  const jobId = jobIdOf(o);
  const row = await prisma.factoryJob.findUnique({ where: { jobId } });
  await prisma.factoryJob.upsert({
    where: { jobId },
    create: {
      jobId, brand: o.brand, date: o.date, slot: o.kind, kind: o.kind,
      topic: o.topic, script: o.script.slice(0, 3000), event, error,
      seconds: o.seconds, cost: o.cost, links: "[]",
    },
    update: {
      brand: o.brand, topic: o.topic || row?.topic || "", script: (o.script || row?.script || "").slice(0, 3000),
      event, error, seconds: o.seconds || row?.seconds || 0, cost: o.cost || row?.cost || 0,
    },
  });

  // Тема готового ролика встаёт в план, если клетка пуста: у завода, который
  // сам не публикует, «готов» — это и есть выпуск.
  if (event === "готов" && DELIVERY_ONLY.has(o.brand) && o.topic) {
    const key = { brand: o.brand, date: o.date, slot: o.kind };
    const cell = await prisma.planSlot.findUnique({ where: { brand_date_slot: key } });
    if (!cell || !cell.topic.trim()) {
      await prisma.planSlot.upsert({
        where: { brand_date_slot: key },
        create: { ...key, topic: o.topic, facts: "" },
        update: { topic: o.topic },
      });
    }
  }
}

/** Завести заказы на подошедшие слоты и закрыть просроченные. */
export async function refresh(brand: string, now = new Date()) {
  const slots = await dueSlots(brand, now);
  for (const s of slots) {
    const key = { brand_date_kind_at: { brand, date: s.date, kind: s.kind, at: s.at } };
    const known = await prisma.factoryOrder.findUnique({ where: key });
    if (!known) {
      await prisma.factoryOrder.create({
        data: { brand, kind: s.kind, date: s.date, at: s.at, deliverBot: s.bot },
      });
    } else if (known.state === "план" && known.deliverBot !== s.bot) {
      // Тумблер выдачи переключили уже после появления заказа.
      await prisma.factoryOrder.update({ where: key, data: { deliverBot: s.bot } });
    }
  }

  // Заказ, который никто не забрал за запас времени: завода не было на связи.
  const stalePlan = await prisma.factoryOrder.findMany({ where: { brand, state: "план" } });
  for (const o of stalePlan) {
    if ((now.getTime() - slotAt(o.date, o.at)) / 60000 <= GRACE_MIN) continue;
    await prisma.factoryOrder.update({ where: { id: o.id }, data: { state: "пропущен", doneAt: now } });
    await toJournal(o, "ошибка", `Заказ на ${o.at} никто не забрал за ${GRACE_MIN / 60} часа — завод не выходил на связь`);
  }

  // Взятый, но недоведённый заказ. Заново не запускаем: ролик мог успеть
  // собраться и уйти в бот, а вторая сборка — это вторые деньги.
  const lost = await prisma.factoryOrder.findMany({ where: { brand, state: { in: ["выдан", "собирается"] } } });
  for (const o of lost) {
    if (!o.takenAt || (now.getTime() - +o.takenAt) / 60000 <= staleOf(brand)) continue;
    await prisma.factoryOrder.update({ where: { id: o.id }, data: { state: "ошибка", doneAt: now, error: "завод пропал во время сборки" } });
    await toJournal(o, "ошибка", "Завод взял заказ и пропал. Сборку заново не начинаем: проверьте бот выдачи, ролик мог дойти");
  }
}

/**
 * Выдать заводу очередной заказ. null — работы нет.
 *
 * Один заказ за раз: пока предыдущий не закрыт, новый не выдаём. Две сборки
 * разом заводу не нужны — ни по памяти, ни по деньгам.
 */
export async function claim(brand: string, now = new Date()) {
  // Выключенный тумблер должен останавливать выдачу сразу, а не после того,
  // как разойдутся уже заведённые заказы.
  if (!(await ordersEnabled(brand))) return null;
  await refresh(brand, now);

  if (SINGLE.has(brand)) {
    const busy = await prisma.factoryOrder.findFirst({ where: { brand, state: { in: ["выдан", "собирается"] } } });
    if (busy) return null;
  }

  // Берём только то, что не просрочено: Новости девяти утра, собранные к
  // обеду, — это не «догнали», это мусор в ленте.
  const planned = await prisma.factoryOrder.findMany({ where: { brand, state: "план" } });
  const ready = planned
    .filter((o) => {
      const late = (now.getTime() - slotAt(o.date, o.at)) / 60000;
      return late >= 0 && late <= GRACE_MIN;
    })
    .sort((a, b) => slotAt(a.date, a.at) - slotAt(b.date, b.at))[0];
  if (!ready) return null;

  // Тема для форматов, которые берут её из плана: у Новостей и Прогнозов её
  // нет вовсе, у Персонажа — если владелец вписал.
  const cell = await prisma.planSlot.findUnique({
    where: { brand_date_slot: { brand, date: ready.date, slot: ready.kind } },
  });
  const order = await prisma.factoryOrder.update({
    where: { id: ready.id },
    data: { state: "выдан", takenAt: now, topic: cell?.topic || "", facts: cell?.facts || "" },
  });
  await toJournal(order, "создан");
  return order;
}

/** Отчёт завода по заказу: этап, готово или не вышло. */
export async function report(brand: string, id: string, body: any) {
  const order = await prisma.factoryOrder.findUnique({ where: { id } });
  if (!order || order.brand !== brand) return null;
  const event = String(body?.event || "");

  if (event === "progress") {
    return prisma.factoryOrder.update({ where: { id }, data: { state: "собирается" } });
  }

  if (event === "result") {
    const done = await prisma.factoryOrder.update({
      where: { id },
      data: {
        state: "готов", doneAt: new Date(),
        topic: String(body.topic || order.topic || ""),
        script: String(body.script || "").slice(0, 3000),
        file: String(body.file || ""),
        seconds: Math.round(Number(body.seconds || 0)) || 0,
        cost: Number(body.cost || 0) || 0,
      },
    });
    await toJournal(done, "готов");
    return done;
  }

  if (event === "fail") {
    const failed = await prisma.factoryOrder.update({
      where: { id },
      data: { state: "ошибка", doneAt: new Date(), error: String(body.error || "").slice(0, 500) },
    });
    await toJournal(failed, "ошибка", failed.error);
    return failed;
  }

  return null;
}

/** Заказы дня для пульта: план, работа и результат в одном списке. */
export async function ordersOf(brand: string, date?: string) {
  const day = date || msk(new Date()).date;
  return prisma.factoryOrder.findMany({ where: { brand, date: day }, orderBy: { at: "asc" } });
}
