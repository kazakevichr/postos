import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { accessBrands, currentAccess } from "@/lib/access";
import { notifyRoles } from "@/lib/telegram";
import {
  DEFAULT_PROJECT,
  PROJECTS,
  SERVICES,
  freeServiceId,
  projectOfAsync,
  stateOf,
  topups,
  wallets,
  walletProjectsOf,
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
  return walletProjectsOf(await accessBrands(access));
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
  const projects = walletProjectsOf(await accessBrands(access));
  return projects.length ? { name: access.name, projects } : null;
}
function byKey(req: Request) {
  const need = process.env.IG_HOST_KEY;
  return Boolean(need) && req.headers.get("x-factory-key") === need;
}

const money = (n: number) => `$${n.toFixed(2)}`;

// Проект, который спрашивают, — но не дальше рамок направления. Неизвестное
// или чужое имя не ошибка, а старая ссылка либо попытка заглянуть за свои
// границы: отдаём первый доступный, а не пустую страницу и не чужие деньги.
function askedProject(req: Request, allowed: string[]) {
  const p = new URL(req.url).searchParams.get("project") || "";
  if (PROJECTS[p] && allowed.includes(p)) return p;
  return allowed.includes(DEFAULT_PROJECT) ? DEFAULT_PROJECT : allowed[0];
}

// Тексты предупреждений и список проектов едут вместе с данными: справочник
// живёт в lib/wallets.ts рядом с prisma, а таблица — клиентский компонент, и
// импортировать одно в другое нельзя.
async function picture(project: string, allowed: string[]) {
  return {
    project,
    projects: allowed.map((id) => ({ id, title: PROJECTS[id].title })),
    labels: PROJECTS[project],
    wallets: await wallets(project),
    topups: await topups(project),
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

  const msgs: string[] = [];
  for (const w of list) {
    const service = String(w?.service || "").trim();
    if (!service || !SERVICES[service]) continue;
    const meta = SERVICES[service];
    const fields = {
      title: String(w.title || meta.title).slice(0, 120),
      ok: w.ok !== false,
      low: Boolean(w.low),
      left: w.left == null ? null : Number(w.left),
      unit: meta.unit,
      spent: w.spent == null ? null : Number(w.spent),
      note: String(w.note || "").slice(0, 400),
      link: String(w.link || meta.link).slice(0, 300),
      at: new Date(),
    };
    const next = stateOf(fields);
    const prev = await prisma.wallet.findUnique({ where: { service } });
    await prisma.wallet.upsert({
      where: { service },
      create: { service, ...fields, state: next },
      update: { ...fields, state: next },
    });
    if (prev?.state === next) continue;      // ничего не изменилось — молчим

    const name = fields.title;
    const proj = PROJECTS[meta.project] || PROJECTS[DEFAULT_PROJECT];
    const where = `[${proj.title}] `;
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
        `${where}⚠️ <b>${name}</b>: остаток ${fields.left ?? "?"} ${meta.unit}, скоро кончится.` +
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
  const allowed = byKey(req) ? Object.keys(PROJECTS) : await visibleProjects();
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
  const project = await projectOfAsync(service);
  if (!who.projects.includes(project)) {
    return NextResponse.json({ error: "чужое направление" }, { status: 403 });
  }

  if (b?.amount != null) {
    const amount = Number(b.amount);
    if (!Number.isFinite(amount) || amount === 0) {
      return NextResponse.json({ error: "сумма должна быть числом" }, { status: 400 });
    }
    await prisma.walletTopup.create({
      data: {
        service,
        amount,
        who: who.name,
        note: String(b.note || "").slice(0, 200),
        // Дату можно задать задним числом: пополнение вносится не в ту же
        // минуту, когда сделано, а когда до раздела дошли руки.
        ...(b.at ? { at: new Date(b.at) } : {}),
      },
    });
    // Запись пополнения снимает ручной остаток: он относился к «до», и
    // оставлять его — значит показывать вчерашнюю цифру как сегодняшнюю.
    await prisma.wallet.upsert({
      where: { service },
      create: {
        service, project,
        title: SERVICES[service]?.title || service,
        unit: SERVICES[service]?.unit || "$",
      },
      update: { manual: null, manualAt: null },
    });
    const title = SERVICES[service]?.title || service;
    void notifyRoles(
      ["OWNER"],
      `💳 [${PROJECTS[project].title}] <b>${title}</b>: пополнение ${money(amount)}`,
    );
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
        service, project, inactive,
        title: SERVICES[service]?.title || service,
        unit: SERVICES[service]?.unit || "$",
      },
      update: { inactive },
    });
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
        service, project,
        title: SERVICES[service]?.title || service,
        unit: SERVICES[service]?.unit || "$",
        manual, manualAt: manual == null ? null : new Date(),
      },
      update: { manual, manualAt: manual == null ? null : new Date() },
    });
    return NextResponse.json({ ok: true, ...(await picture(project, who.projects)) });
  }

  return NextResponse.json({ error: "нужны amount, manual или inactive" }, { status: 400 });
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
    const project = row.project || DEFAULT_PROJECT;
    if (!who.projects.includes(project)) {
      return NextResponse.json({ error: "чужое направление" }, { status: 403 });
    }
    await prisma.walletTopup.deleteMany({ where: { service } });
    await prisma.wallet.delete({ where: { service } });
    return NextResponse.json({ ok: true, ...(await picture(project, who.projects)) });
  }

  const id = Number(url.searchParams.get("id") || 0);
  if (!id) return NextResponse.json({ error: "нужен id" }, { status: 400 });
  // Проект узнаём ДО удаления: после него сервис уже не спросить, а вернуть
  // нужно картину того же раздела, из которого нажали «удалить».
  const row = await prisma.walletTopup.findUnique({ where: { id } });
  const project = row ? await projectOfAsync(row.service) : askedProject(req, who.projects);
  if (row && !who.projects.includes(project)) {
    return NextResponse.json({ error: "чужое направление" }, { status: 403 });
  }
  await prisma.walletTopup.delete({ where: { id } }).catch(() => {});
  return NextResponse.json({ ok: true, ...(await picture(project, who.projects)) });
}
