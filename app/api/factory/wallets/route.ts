import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { accessBrands, currentAccess } from "@/lib/access";
import { factoryAuth } from "@/lib/factory";
import { notifyRoles } from "@/lib/telegram";
import { brandTitle } from "@/lib/brands";
import { dropTopupLedger, syncSubscription, topupToLedger } from "@/lib/walletMoney";
import {
  DEFAULT_PROJECT,
  PROJECTS,
  SERVICES,
  brandsOfWallet,
  freeServiceId,
  labelsOf,
  snap,
  stateOf,
  summary,
  topups,
  wallets,
  walletProjects,
} from "@/lib/wallets";

export const dynamic = "force-dynamic";

// Кошельки — деньги сервисов, а не работа с контентом: СММ сюда не ходит.
// Партнёр смотрит кошельки своего направления: сервисы, которые оно жжёт,
// оплачены из его же денег. Пополняет по-прежнему только владелец.
//
// Возвращает проекты кошельков, которые человеку видны, — пустой список
// означает «нечего показывать», а не «показать всё».
async function visibleProjects(): Promise<string[] | null> {
  const access = await currentAccess();
  if (!access || !["OWNER", "PARTNER"].includes(access.role)) return null;
  return walletProjects(await accessBrands(access));
}
/**
 * Кто правит кошельки и какие.
 *
 * Партнёр здесь не наблюдатель: сервисы его направления оплачены из его же
 * денег, и вести их счёт — его работа, а не одолжение. Поэтому он заводит,
 * удаляет и пополняет — но только в своих рамках; за них не пускает уже не
 * интерфейс, а эта проверка.
 */
async function editor(): Promise<{ name: string; projects: string[] } | null> {
  const access = await currentAccess();
  if (!access || !["OWNER", "PARTNER"].includes(access.role)) return null;
  const projects = await walletProjects(await accessBrands(access));
  return projects.length ? { name: access.name, projects } : null;
}
// Замеры шлёт не только СуперФит.
//
// Раньше здесь сверялся один IG_HOST_KEY, и завод MoneyBall со своим ключом
// получал 403 на каждый замер: его кошельки не доходили вовсе, а в разделе
// «Деньги» жили только строки СуперФита. Признаём любой заводской ключ — тот
// же, которым заводы пишут в журнал и спрашивают маршруты.
function byKey(req: Request) {
  return factoryAuth(req) !== null;
}

const money = (n: number) => `$${n.toFixed(2)}`;

// Проект, который спрашивают, — но не дальше рамок направления. Неизвестное
// или чужое имя не ошибка, а старая ссылка либо попытка заглянуть за свои
// границы: отдаём первый доступный, а не пустую страницу и не чужие деньги.
// «all» — сводка по всем кошелькам: есть только у того, кто видит больше
// одного проекта.
function askedProject(req: Request, allowed: string[]) {
  const p = new URL(req.url).searchParams.get("project") || "";
  if (p === "all" && allowed.length > 1) return p;
  if (allowed.includes(p)) return p;
  return allowed.length > 1 ? "all" : allowed[0];
}

/** Можно ли этому человеку править кошелёк: сидит ли на нём его проект. */
async function mayEdit(service: string, projects: string[]) {
  return (await brandsOfWallet(service)).some((b) => projects.includes(b));
}

// Тексты предупреждений и список проектов едут вместе с данными: справочник
// живёт в lib/wallets.ts рядом с prisma, а таблица — клиентский компонент, и
// импортировать одно в другое нельзя.
async function picture(project: string, allowed: string[]) {
  const projects = await Promise.all(allowed.map(async (id) => ({ id, title: PROJECTS[id]?.title || (await brandTitle(id)) })));
  return {
    project,
    projects: allowed.length > 1 ? [{ id: "all", title: "Сводка" }, ...projects] : projects,
    labels: project === "all" ? labelsOf(DEFAULT_PROJECT) : labelsOf(project, projects.find((p) => p.id === project)?.title),
    wallets: await wallets(project),
    topups: await topups(project),
    summary: await summary(project),
  };
}

// Источники замеров присылают раз в час: {wallets: [{service, ok, low, left,
// spent, note, link, title}]}. Имя сервиса несёт в себе проект (`router` —
// СуперФит, `oracle_router` — Оракл), поэтому отдельного поля проекта в теле
// нет: незнакомое имя молча отбрасывается, как и раньше.
//
// Пуш в Телеграм уходит ТОЛЬКО на смену состояния — иначе за неделю простоя
// раздел превратится в спам и настоящее предупреждение потеряется среди
// одинаковых.
export async function POST(req: Request) {
  const b = await req.json().catch(() => null);

  // Тот же адрес заводит кошелёк руками: человек присылает название, машина —
  // массив замеров. Платят люди и за сервисы, которых нет в справочнике, и
  // единственный способ их учесть — вписать самому.
  if (!byKey(req)) {
    const who = await editor();
    if (!who) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const title = String(b?.title || "").trim().slice(0, 120);
    if (!title) return NextResponse.json({ error: "нужно название" }, { status: 400 });

    const project = String(b?.project || who.projects[0]);
    if (!who.projects.includes(project)) {
      return NextResponse.json({ error: "чужое направление" }, { status: 403 });
    }

    const service = await freeServiceId(project, title);
    await prisma.wallet.create({
      data: {
        service,
        project,
        custom: true,
        title,
        unit: String(b?.unit || "$").slice(0, 20),
        link: String(b?.link || "").slice(0, 300),
        blocks: Boolean(b?.blocks),
        note: "замер ещё не приходил",
      },
    });
    return NextResponse.json({ ok: true, ...(await picture(project, who.projects)) });
  }

  const list = Array.isArray(b?.wallets) ? b.wallets : null;
  if (!list) return NextResponse.json({ error: "нужен массив wallets" }, { status: 400 });

  // Сборщик на сервере (content-factory/ops/wallets.py) видит ключи всех
  // заводов разом и знает, кто на каком аккаунте сидит. Его замер главнее
  // заводского: пока он свежий, заводы не перетирают строку своими.
  const collector = req.headers.get("x-wallet-source") === "collector";
  const msgs: string[] = [];
  for (const w of list) {
    const service = String(w?.service || "").trim();
    if (!service) continue;
    const prev = await prisma.wallet.findUnique({ where: { service } });
    if (!SERVICES[service] && !(collector || prev?.custom)) continue;
    if (!collector && prev?.source === "collector" && prev.at && Date.now() - +prev.at < 3 * 3600e3) continue;
    const users: string[] = Array.isArray(w.users) ? w.users.map(String) : [];
    const meta = SERVICES[service] || {
      project: users[0] || DEFAULT_PROJECT, title: String(w.title || service), unit: String(w.unit || "$"),
      blocks: Boolean(w.blocks), link: String(w.link || ""), api: "",
    };
    const fields = {
      // Название знакомого сервиса — из справочника: там оно уточнено
      // («ElevenLabs — озвучка роликов (завод)»), а источники шлют общее.
      title: String(SERVICES[service] ? meta.title : w.title || meta.title).slice(0, 120),
      ok: w.ok !== false,
      low: Boolean(w.low),
      left: w.left == null ? null : Number(w.left),
      unit: collector && w.unit ? String(w.unit) : meta.unit,
      spent: w.spent == null ? null : Number(w.spent),
      note: String(w.note || "").slice(0, 400),
      link: String(w.link || meta.link).slice(0, 300),
      at: new Date(),
      ...(collector ? {
        source: "collector",
        ...(users.length ? { users: users.join(",") } : {}),
        resetAt: w.reset_at ? new Date(Number(w.reset_at) * 1000) : null,
      } : {}),
    };
    const next = stateOf(fields);
    await prisma.wallet.upsert({
      where: { service },
      create: { service, project: meta.project, blocks: meta.blocks, ...fields, state: next },
      update: { ...fields, state: next },
    });
    await snap(service, fields.left, fields.spent);
    if (prev?.state === next) continue;      // ничего не изменилось — молчим
    // Сервис, помеченный «не пользуемся», молчит и при пустом балансе. Замеры
    // по нему приходить не перестают (завод не знает о пометке), но будить
    // человека из-за денег на том, чем он сознательно не пользуется, незачем:
    // ровно так 29.09 прилетело «кончился баланс fal» по отключённому fal.
    if (prev?.inactive) continue;

    const name = fields.title;
    const brands = await brandsOfWallet(service);
    const proj = labelsOf(brands[0] || meta.project);
    const where = `[${(await Promise.all(brands.map((x) => PROJECTS[x]?.title || brandTitle(x)))).join(", ")}] `;
    if (next === "down") {
      msgs.push(
        where +
          (meta.blocks
            ? `⛔️ <b>${name}</b>: ${fields.note || "деньги кончились"}\n${proj.blockedTitle}`
            : `⚠️ <b>${name}</b>: ${fields.note || "деньги кончились"}\n${proj.dryTitle}`) +
          `\nПополнить: ${fields.link}`,
      );
    } else if (next === "low" && prev?.state !== "down") {
      msgs.push(
        `${where}⚠️ <b>${name}</b>: остаток ${fields.left ?? "?"} ${fields.unit}, скоро кончится.` +
          `\nПополнить: ${fields.link}`,
      );
    } else if (next === "ok" && prev && prev.state !== "ok") {
      msgs.push(`${where}✅ <b>${name}</b> снова работает.`);
    }
  }
  if (msgs.length) void notifyRoles(["OWNER"], msgs.join("\n\n"));
  return NextResponse.json({ ok: true, pushed: msgs.length });
}

// Картина для раздела. Источникам замеров по ключу отдаём то же самое: по этим
// данным завод решает, начинать ли производство.
export async function GET(req: Request) {
  // Источникам замеров рамки направления не нужны: они спрашивают про свой
  // проект по имени и ходят по ключу, а не сессией.
  const allowed = byKey(req) ? await walletProjects(null) : await visibleProjects();
  if (!allowed) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  if (!allowed.length) {
    return NextResponse.json({ project: "", projects: [], labels: null, wallets: [], topups: [] });
  }
  return NextResponse.json(await picture(askedProject(req, allowed), allowed));
}

// Ручной ввод — то, чего сервисы не отдают по API.
//  · {service, amount, note}  — записать пополнение (история сохраняется);
//  · {service, manual}        — вписать текущий остаток;
//  · {service, manual: null}  — стереть ручной остаток и вернуться к расчёту.
export async function PUT(req: Request) {
  const who = await editor();
  if (!who) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const b = await req.json().catch(() => null);
  const service = String(b?.service || "").trim();
  const known =
    Boolean(SERVICES[service]) ||
    Boolean(await prisma.wallet.findUnique({ where: { service }, select: { service: true } }));
  if (!known) {
    return NextResponse.json({ error: "неизвестный сервис" }, { status: 400 });
  }
  if (!(await mayEdit(service, who.projects))) {
    return NextResponse.json({ error: "чужое направление" }, { status: 403 });
  }
  const project = askedProject(req, who.projects);
  const home = (await brandsOfWallet(service))[0] || DEFAULT_PROJECT;

  if (b?.amount != null) {
    const amount = Number(b.amount);
    if (!Number.isFinite(amount) || amount === 0) {
      return NextResponse.json({ error: "сумма должна быть числом" }, { status: 400 });
    }
    const paid = b.paid == null || b.paid === "" ? null : Number(b.paid);
    if (paid != null && (!Number.isFinite(paid) || paid <= 0)) {
      return NextResponse.json({ error: "сумма оплаты должна быть числом" }, { status: 400 });
    }
    const t = await prisma.walletTopup.create({
      data: {
        service,
        amount,
        paid,
        paidCurrency: ["RUB", "THB", "EUR"].includes(b.paidCurrency) ? b.paidCurrency : "USD",
        who: who.name,
        note: String(b.note || "").slice(0, 200),
        // Дату можно задать задним числом: пополнение вносится не в ту же
        // минуту, когда сделано, а когда до раздела дошли руки.
        ...(b.at ? { at: new Date(b.at) } : {}),
      },
    });
    // Пополнение — это трата: она же уходит в журнал денег экономики, чтобы
    // её не вносили там второй раз.
    await topupToLedger(t);
    // Запись пополнения снимает ручной остаток: он относился к «до», и
    // оставлять его — значит показывать вчерашнюю цифру как сегодняшнюю.
    await prisma.wallet.upsert({
      where: { service },
      create: {
        service, project: home,
        title: SERVICES[service]?.title || service,
        unit: SERVICES[service]?.unit || "$",
      },
      update: { manual: null, manualAt: null },
    });
    const title = SERVICES[service]?.title || service;
    void notifyRoles(
      ["OWNER"],
      `💳 <b>${title}</b>: пополнение ${money(amount)}` +
        (paid != null ? ` (заплачено ${t.paidCurrency === "USD" ? money(paid) : `${paid.toLocaleString("ru-RU")} ${({ RUB: "₽", THB: "฿", EUR: "€" } as any)[t.paidCurrency]}`})` : ""),
    );
    return NextResponse.json({ ok: true, ...(await picture(project, who.projects)) });
  }

  // Как платим: подписка (сумма в месяц) или пополняемый баланс. Подписка
  // сама ведёт свою строку в «Постоянных расходах».
  if ("billing" in (b || {})) {
    const billing = ["sub", "balance"].includes(b.billing) ? b.billing : "";
    const subAmount = b.subAmount == null || b.subAmount === "" ? null : Number(b.subAmount);
    if (subAmount != null && (!Number.isFinite(subAmount) || subAmount < 0)) {
      return NextResponse.json({ error: "сумма подписки должна быть числом" }, { status: 400 });
    }
    const data = {
      billing,
      subAmount: billing === "sub" ? subAmount : null,
      subCurrency: b.subCurrency === "RUB" ? "RUB" : "USD",
    };
    await prisma.wallet.upsert({
      where: { service },
      create: { service, project: home, title: SERVICES[service]?.title || service, unit: SERVICES[service]?.unit || "$", ...data },
      update: data,
    });
    await syncSubscription(service);
    return NextResponse.json({ ok: true, ...(await picture(project, who.projects)) });
  }

  // «Оплатил»: от этой даты считается следующее списание подписки. Даты
  // списаний нигде по API не отдаются, поэтому их узнаём по первой отметке.
  if ("paid" in (b || {})) {
    const at = b.paid ? new Date(b.paid) : new Date();
    if (Number.isNaN(+at)) return NextResponse.json({ error: "непонятная дата" }, { status: 400 });
    await prisma.wallet.update({ where: { service }, data: { paidAt: at } });
    return NextResponse.json({ ok: true, ...(await picture(project, who.projects)) });
  }

  // Пометка «не пользуемся»: строка уходит из рабочего списка и перестаёт
  // поднимать тревогу. Замеры по ней приходят и дальше, история пополнений
  // остаётся — вернуть в строй можно тем же переключателем.
  if ("inactive" in (b || {})) {
    const inactive = Boolean(b.inactive);
    await prisma.wallet.upsert({
      where: { service },
      create: {
        service, project: home, inactive,
        title: SERVICES[service]?.title || service,
        unit: SERVICES[service]?.unit || "$",
      },
      update: { inactive },
    });
    // Выключенная подписка больше не платится — закрываем её строку.
    await syncSubscription(service);
    return NextResponse.json({ ok: true, ...(await picture(project, who.projects)) });
  }

  if ("manual" in (b || {})) {
    const manual = b.manual == null || b.manual === "" ? null : Number(b.manual);
    if (manual != null && !Number.isFinite(manual)) {
      return NextResponse.json({ error: "остаток должен быть числом" }, { status: 400 });
    }
    await prisma.wallet.upsert({
      where: { service },
      create: {
        service, project: home,
        title: SERVICES[service]?.title || service,
        unit: SERVICES[service]?.unit || "$",
        manual, manualAt: manual == null ? null : new Date(),
      },
      // Расход на момент ввода: дальше остаток = вписанное − потрачено с тех
      // пор. Так роутер, который отдаёт только расход, вписывается один раз.
      update: {
        manual, manualAt: manual == null ? null : new Date(),
        manualSpent: manual == null ? null : (await prisma.wallet.findUnique({ where: { service } }))?.spent ?? null,
      },
    });
    return NextResponse.json({ ok: true, ...(await picture(project, who.projects)) });
  }

  return NextResponse.json({ error: "нужны amount, manual, billing, paid или inactive" }, { status: 400 });
}

// Ошиблись в сумме — пополнение удаляется. Правки на месте нет намеренно:
// история денег должна читаться как список событий, а не как текущее мнение.
export async function DELETE(req: Request) {
  const who = await editor();
  if (!who) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const url = new URL(req.url);

  // Удаление кошелька, заведённого руками, — вместе с его пополнениями:
  // деньги, внесённые по несуществующему сервису, не история, а мусор.
  // Справочные кошельки не удаляются: их присылает сбор замеров, и строка
  // вернулась бы через час сама, только уже без названия и ссылки.
  const service = String(url.searchParams.get("service") || "").trim();
  if (service) {
    const row = await prisma.wallet.findUnique({ where: { service } });
    if (!row || !row.custom) {
      return NextResponse.json(
        { error: "этот кошелёк ведёт сбор замеров — его нельзя удалить" },
        { status: 400 }
      );
    }
    if (!who.projects.includes(row.project || DEFAULT_PROJECT)) {
      return NextResponse.json({ error: "чужое направление" }, { status: 403 });
    }
    const project = askedProject(req, who.projects);
    for (const t of await prisma.walletTopup.findMany({ where: { service }, select: { id: true } })) await dropTopupLedger(t.id);
    await prisma.walletTopup.deleteMany({ where: { service } });
    await prisma.wallet.delete({ where: { service } });
    await syncSubscription(service);
    return NextResponse.json({ ok: true, ...(await picture(project, who.projects)) });
  }

  const id = Number(url.searchParams.get("id") || 0);
  if (!id) return NextResponse.json({ error: "нужен id" }, { status: 400 });
  // Проект узнаём ДО удаления: после него сервис уже не спросить, а вернуть
  // нужно картину того же раздела, из которого нажали «удалить».
  const row = await prisma.walletTopup.findUnique({ where: { id } });
  const project = askedProject(req, who.projects);
  if (row && !(await mayEdit(row.service, who.projects))) {
    return NextResponse.json({ error: "чужое направление" }, { status: 403 });
  }
  await prisma.walletTopup.delete({ where: { id } }).catch(() => {});
  await dropTopupLedger(id);
  return NextResponse.json({ ok: true, ...(await picture(project, who.projects)) });
}
