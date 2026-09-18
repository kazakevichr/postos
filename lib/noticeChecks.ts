import { prisma } from "@/lib/prisma";
import { plural, raise, resolve, resolveOthers } from "@/lib/notices";
import { PROJECTS, wallets } from "@/lib/wallets";
import { SUSPICIOUS_AFTER } from "@/lib/insta";

// Проверяльщики: единственное место, где уведомления рождаются и гаснут.
//
// Все они устроены одинаково: посчитать беды своего вида, поднять их и
// погасить то, чего в списке больше нет. Поэтому пополненный кошелёк и
// заработавший завод убирают строку сами, без участия человека.
//
// Порядок внутри не важен, каждая проверка независима: упавшая не должна
// мешать остальным, поэтому вызываются они через safely().

const DAY = 24 * 60 * 60 * 1000;
const dt = (d: Date | string) =>
  new Date(d).toLocaleDateString("ru-RU", { day: "numeric", month: "long" });

async function safely(name: string, fn: () => Promise<void>) {
  try {
    await fn();
  } catch (e: any) {
    console.error(`[уведомления] проверка «${name}» упала:`, e?.message || e);
  }
}

// ── Деньги ────────────────────────────────────────────────────────────────
// Пустой кошелёк у сервиса без замены останавливает работу — это «важное».
// Просто «на исходе» — внимание. Молчащие замеры значат, что сам завод не
// выходит на связь, и это отдельная беда: цифры на странице кошельков
// выглядят нормально, просто они вчерашние.
async function checkWallets() {
  const keep: string[] = [];
  for (const project of Object.keys(PROJECTS)) {
    const rows = await wallets(project);
    for (const w of rows) {
      if (w.inactive) continue;
      const key = `wallet:dry:${w.service}`;
      if (!w.ok && w.blocks) {
        keep.push(key);
        await raise({
          key, kind: "wallet", level: "crit", brand: project,
          title: `${w.title}: платить нечем`,
          body: `${PROJECTS[project].blockedTitle} ${PROJECTS[project].blockedNote}`,
          href: "/wallets", actionText: "Пополнить", roles: ["OWNER"],
        });
      } else if (w.low || (!w.ok && !w.blocks)) {
        keep.push(key);
        await raise({
          key, kind: "wallet", level: "warn", brand: project,
          title: `${w.title} на исходе${w.balance != null ? `: ${w.balance} ${w.unit}` : ""}`,
          body: w.blocks
            ? "Кончится — работа встанет посреди заказа."
            : PROJECTS[project].dryNote,
          href: "/wallets", actionText: "Пополнить", roles: ["OWNER"],
        });
      }
    }

    // Замеры присылает сам завод. Молчат дольше суток — молчит завод.
    const freshest = rows.filter((r) => !r.inactive && r.at).map((r) => +new Date(r.at!));
    if (freshest.length && Date.now() - Math.max(...freshest) > DAY) {
      const key = `wallet:stale:${project}`;
      keep.push(key);
      await raise({
        key, kind: "wallet", level: "warn", brand: project,
        title: `${PROJECTS[project].title}: замеры балансов не приходят больше суток`,
        body: "Цифры на странице кошельков выглядят нормально, но они старые: замеры шлёт завод, и раз их нет — молчит он.",
        href: "/wallets", actionText: "К кошелькам", roles: ["OWNER"],
      });
    }
  }
  await resolveOthers("wallet:", keep);
}

// ── Площадки ──────────────────────────────────────────────────────────────
// Аккаунт перестал читаться — кандидат в архив. Архивируем не сами: суточное
// ограничение Меты проходит само, а вот увести живой аккаунт из сумм без
// спроса — испортить отчётность молча.
async function checkAccounts() {
  const keep: string[] = [];
  const rows = await prisma.igAccount.findMany({ where: { archivedAt: null } });
  const alive = rows.filter((r) => !r.igId.startsWith("bd:"));
  const broken = alive.filter((r) => r.failCount >= SUSPICIOUS_AFTER);

  // Упали ВСЕ разом — дело не в аккаунтах, а в токене. Отдельное уведомление:
  // иначе человек пойдёт архивировать по одному то, что чинится одной
  // переменной окружения.
  if (alive.length >= 2 && broken.length === alive.length) {
    const key = "meta:token";
    keep.push(key);
    await raise({
      key, kind: "meta", level: "crit",
      title: "Мета не отдаёт ни одного аккаунта",
      body: `Все ${alive.length} перестали читаться разом — так выглядит истёкший или отозванный META_TOKEN, а не блокировка аккаунтов. Долгоживущий токен Графа живёт 60 дней.`,
      href: "/social", actionText: "К аккаунтам", roles: ["OWNER"],
    });
  } else {
    for (const r of broken) {
      const key = `meta:unread:${r.igId}`;
      keep.push(key);
      await raise({
        key, kind: "meta", level: "warn", brand: r.brand,
        title: `@${r.username} не читается ${plural(r.failCount, "сбор", "сбора", "сборов")} подряд`,
        body: r.lastError
          ? `Последний ответ Меты: ${r.lastError.slice(0, 200)}`
          : "Ответ площадки не записан.",
        href: "/social", actionText: "В архив",
      });
    }
  }
  await resolveOthers("meta:", keep);
}

// ── Завод ─────────────────────────────────────────────────────────────────
// Падения заказов склеиваем по типу: «make падает 4 раза» полезнее четырёх
// одинаковых строк. Молчание завода считаем по журналу, а не по постам: пост
// мог выйти руками.
async function checkFactory() {
  const keep: string[] = [];
  const since = new Date(Date.now() - 3 * DAY);
  const bad = await prisma.factoryJob.findMany({
    where: { at: { gte: since }, event: { in: ["ошибка", "не принят"] } },
    orderBy: { at: "desc" },
  });

  const byKind = new Map<string, typeof bad>();
  for (const j of bad) {
    const k = `${j.brand}:${j.kind}`;
    byKind.set(k, [...(byKind.get(k) || []), j]);
  }
  for (const [k, list] of byKind) {
    const key = `factory:fail:${k}`;
    keep.push(key);
    const last = list[0];
    await raise({
      key, kind: "factory", level: list.length >= 3 ? "crit" : "warn", brand: last.brand,
      times: list.length,
      title: list.length > 1
        ? `Заказ «${last.kind}» падает ${plural(list.length, "раз", "раза", "раз")} за три дня`
        : `Заказ «${last.kind}» не вышел: ${last.event}`,
      body: (last.error || "").slice(0, 300) || "Завод не прислал текст ошибки.",
      href: "/factory", actionText: "Открыть журнал",
    });
  }

  // Молчание: последнее «опубликован» по бренду.
  for (const brand of ["superfit", "oracle"]) {
    const last = await prisma.factoryJob.findFirst({
      where: { brand, event: "опубликован" },
      orderBy: { at: "desc" },
    });
    if (!last) continue;
    const days = Math.floor((Date.now() - +last.at) / DAY);
    if (days >= 3) {
      const key = `factory:silent:${brand}`;
      keep.push(key);
      await raise({
        key, kind: "factory", level: days >= 7 ? "crit" : "warn", brand,
        title: `Завод ${brand === "oracle" ? "Оракла" : "СуперФита"} молчит ${plural(days, "день", "дня", "дней")}`,
        body: `Последняя публикация — ${dt(last.at)}. Проверьте маршруты и кошельки: завод не производит, если выпускать некуда или платить нечем.`,
        href: "/factory", actionText: "К заводу",
      });
    }
  }
  await resolveOthers("factory:", keep);
}

// ── Люди и планы ──────────────────────────────────────────────────────────
async function checkPeople() {
  const keep: string[] = [];

  const overdue = await prisma.task.count({ where: { isDone: false, dueDate: { lt: new Date() } } });
  if (overdue > 0) {
    keep.push("tasks:overdue");
    await raise({
      key: "tasks:overdue", kind: "tasks", level: overdue >= 10 ? "warn" : "info",
      title: `${plural(overdue, "просроченная задача", "просроченные задачи", "просроченных задач")}`,
      body: "Задачи с прошедшим сроком, которые никто не закрыл.",
      href: "/tasks", actionText: "К задачам",
    });
  }

  const signups = await prisma.tgSignup.count({ where: { status: "new" } });
  if (signups > 0) {
    keep.push("access:signups");
    await raise({
      key: "access:signups", kind: "access", level: "warn",
      title: `${plural(signups, "заявка", "заявки", "заявок")} на доступ ${signups === 1 ? "ждёт" : "ждут"} ответа`,
      body: "Человек написал боту и ждёт, пока ему заведут учётную запись.",
      href: "/settings/users", actionText: "Посмотреть", roles: ["OWNER"],
    });
  }

  const recs = await prisma.recommendation.count({ where: { status: "new" } });
  if (recs >= 3) {
    keep.push("analytics:recs");
    await raise({
      key: "analytics:recs", kind: "analytics", level: "info",
      title: `${plural(recs, "рекомендацию", "рекомендации", "рекомендаций")} никто не открыл`,
      body: "Нейро-аналитика предложила правки контента, они висят непрочитанными.",
      href: "/analytics", actionText: "Посмотреть",
    });
  }

  const today = new Date().toISOString().slice(0, 10);
  for (const brand of ["superfit", "oracle"]) {
    const ahead = await prisma.planSlot.count({ where: { brand, date: { gte: today } } });
    if (ahead > 0 && ahead <= 3) {
      const key = `plan:thin:${brand}`;
      keep.push(key);
      await raise({
        key, kind: "plan", level: "info", brand,
        title: `План тем ${brand === "oracle" ? "Оракла" : "СуперФита"} заканчивается: ${plural(ahead, "слот", "слота", "слотов")}`,
        body: "Когда слоты кончатся, завод начнёт придумывать темы сам.",
        href: "/factory", actionText: "К плану",
      });
    }
  }

  await resolveOthers("tasks:", keep);
  await resolveOthers("access:", keep);
  await resolveOthers("analytics:", keep);
  await resolveOthers("plan:", keep);
}

/** Полный обход. Зовётся из instrumentation вместе со сбором статистики. */
export async function runChecks() {
  await safely("кошельки", checkWallets);
  await safely("площадки", checkAccounts);
  await safely("завод", checkFactory);
  await safely("люди и планы", checkPeople);
}

export { resolve };
