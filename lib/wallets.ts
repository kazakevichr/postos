import { prisma } from "@/lib/prisma";

// Кошельки платных сервисов: справочник, расчёт остатка и состояние.
//
// Главное правило раздела: таблица показывает ВСЕ сервисы всегда, даже пока
// никто не прислал ни одного замера. Пустой раздел неотличим от сломанного, а
// человек открывает его именно тогда, когда что-то встало.
//
// ДВА ПРОЕКТА В ОДНОЙ ТАБЛИЦЕ. Кошельки ведут и завод СуперФита, и Оракл, и
// «Роутер» есть у обоих. Проект зашит В САМ ИДЕНТИФИКАТОР сервиса
// (`router` против `oracle_router`), а не вынесен в колонку базы. Так строки
// двух проектов не могут столкнуться первичным ключом, а схема не меняется
// вовсе: `Wallet.service` как был единственным ключом, так и остался, и выкат
// не требует ни миграции, ни простоя. Принадлежность проекту знает
// справочник ниже — он же единственное место, где её надо править.

export type WalletRow = {
  service: string;
  title: string;
  ok: boolean;
  low: boolean;
  left: number | null;
  unit: string;
  spent: number | null;
  note: string;
  link: string;
  manual: number | null;
  manualAt: string | null;
  at: string | null;
  fresh: boolean;          // замер свежий (моложе трёх часов)
  topups: number;          // сумма пополнений, $
  balance: number | null;  // остаток к показу
  source: string;          // откуда взят остаток
  blocks: boolean;         // останавливает ли работу
  custom: boolean;         // заведён руками — можно удалить
  inactive: boolean;       // сервисом не пользуются — вне рабочего списка
  state: string;
};

// Проекты, у которых есть свои кошельки. Тексты предупреждений разные не для
// красоты: у завода пустой кошелёк останавливает ПРОИЗВОДСТВО и заказы ждут
// пополнения, у Оракла — ломает часть продукта у живых подписчиков. Одна
// формулировка на оба случая врала бы в одном из них.
export const PROJECTS: Record<
  string,
  { title: string; blockedTitle: string; blockedNote: string; dryTitle: string; dryNote: string }
> = {
  superfit: {
    title: "СуперФит",
    blockedTitle: "Производство приостановлено.",
    blockedNote:
      "Заказы ждут пополнения и поднимутся сами, как только оно придёт.",
    dryTitle: "Контент выходит на замене.",
    dryNote:
      "Завод платит другому исполнителю, производство не остановлено — но замена дороже, стоит пополнить.",
  },
  oracle: {
    title: "Оракл",
    blockedTitle: "Часть продукта не работает у подписчиков.",
    blockedNote:
      "Без этих сервисов разбор не собирается вовсе. Люди платят и не получают ответа.",
    dryTitle: "Продукт работает урезанным.",
    dryNote:
      "Разбор выходит, но без части данных — котировок, свежих фактов или озвучки. Качество ниже обещанного.",
  },
};

export const DEFAULT_PROJECT = "superfit";

/**
 * Кошельки направления.
 *
 * Ключ проекта у кошельков — тот же бренд, что делит соцсети и завод: одна
 * ось на всё приложение, чтобы «Оракл» везде значил одно и то же. Раньше
 * привязка шла через источник дохода направления, и незаполненное поле
 * оставляло раздел пустым, хотя кошельки у направления есть.
 *
 * null на входе (владелец смотрит всё сразу) отдаёт все проекты.
 */
export function walletProjectsOf(brands: string[] | null): string[] {
  const all = Object.keys(PROJECTS);
  return brands ? all.filter((p) => brands.includes(p)) : all;
}

// Справочник сервисов. Порядок — как в таблице: сперва то, без чего проект
// не работает вовсе.
//
// blocks говорит, останавливает ли пустой кошелёк работу. У роутера и OpenAI
// СуперФита он false не по недосмотру: это ЗАМЕНА ДРУГ ДРУГУ. Пуст роутер —
// завод платит OpenAI и продолжает выпускать контент (решение Романа 01.09).
// Останавливает только то, у чего замены нет.
export const SERVICES: Record<
  string,
  { project: string; title: string; unit: string; blocks: boolean; link: string; api: string }
> = {
  // ── СуперФит ────────────────────────────────────────────────────────────
  router: {
    project: "superfit",
    title: "Роутер (router.cheap)",
    unit: "$",
    blocks: false,
    link: "https://router.cheap",
    api: "расход — да, остаток — нет",
  },
  openai: {
    project: "superfit",
    title: "OpenAI",
    unit: "$",
    blocks: false,
    link: "https://platform.openai.com/settings/organization/billing",
    api: "остаток не отдаёт",
  },
  eleven: {
    project: "superfit",
    title: "ElevenLabs (озвучка)",
    unit: "символов",
    blocks: false,
    link: "https://elevenlabs.io/app/settings/billing",
    api: "отдаст после перевыпуска ключа с правом user_read",
  },
  heygen: {
    project: "superfit",
    title: "HeyGen (ИИ-аватар)",
    unit: "с видео",
    blocks: true,
    link: "https://app.heygen.com",
    api: "остаток — да",
  },
  fal: {
    project: "superfit",
    title: "fal.ai (вырезание фона)",
    unit: "$",
    blocks: false,
    link: "https://fal.ai/dashboard",
    api: "остаток не отдаёт",
  },

  // ── Оракл ───────────────────────────────────────────────────────────────
  // Сайт OracleAi.Link и контент-завод @CONTENT_ZAVOD_INSHALAG_bot. Роутер у
  // них ОДИН НА ДВОИХ — один ключ, один счёт, и разделить расход по API
  // нельзя (total_usage у обоих контейнеров совпадает до копейки). Поэтому
  // строка роутера здесь одна на весь Оракл, а не две.
  oracle_router: {
    project: "oracle",
    title: "Роутер (router.cheap)",
    unit: "$",
    blocks: true,
    link: "https://router.cheap",
    api: "расход — да, остаток — нет",
  },
  oracle_football: {
    project: "oracle",
    title: "API-Football (футбол)",
    unit: "запросов/сутки",
    blocks: true,
    link: "https://dashboard.api-football.com/",
    api: "остаток — да",
  },
  oracle_heygen: {
    project: "oracle",
    title: "HeyGen (ИИ-аватар завода)",
    unit: "с видео",
    blocks: true,
    link: "https://app.heygen.com",
    api: "остаток — да",
  },
  oracle_betsapi: {
    project: "oracle",
    title: "BetsAPI (теннис, баскетбол, киберспорт)",
    unit: "запросов",
    blocks: false,
    link: "https://betsapi.com/mm/account",
    api: "остаток не отдаёт",
  },
  oracle_odds: {
    project: "oracle",
    title: "The Odds API (котировки)",
    unit: "запросов",
    blocks: false,
    link: "https://the-odds-api.com/account/",
    api: "остаток — да",
  },
  // Два разных ключа ElevenLabs, а не один на два места: у сайта и у завода
  // это РАЗНЫЕ аккаунты (проверено 02.09 — ключ сайта отвечает «Invalid API
  // key», ключ завода живой, ему лишь не хватает права user_read). Одна строка
  // на оба означала бы, что сайт и завод по очереди перезаписывают друг другу
  // состояние, и раздел мигал бы между «работает» и «пусто».
  oracle_eleven: {
    project: "oracle",
    title: "ElevenLabs — озвучка разборов (сайт)",
    unit: "символов",
    blocks: false,
    link: "https://elevenlabs.io/app/settings/billing",
    api: "отдаст после перевыпуска ключа с правом user_read",
  },
  oracle_eleven_zavod: {
    project: "oracle",
    title: "ElevenLabs — озвучка роликов (завод)",
    unit: "символов",
    blocks: false,
    link: "https://elevenlabs.io/app/settings/billing",
    api: "отдаст после перевыпуска ключа с правом user_read",
  },
  oracle_talor: {
    project: "oracle",
    title: "TalorData (веб-поиск)",
    unit: "кредитов",
    blocks: false,
    link: "https://talordata.net",
    api: "остаток не отдаёт",
  },
  oracle_uploadpost: {
    project: "oracle",
    title: "upload-post (публикации)",
    unit: "публикаций",
    blocks: false,
    link: "https://www.upload-post.com",
    api: "остаток не отдаёт",
  },
  oracle_brevo: {
    project: "oracle",
    title: "Brevo (письма)",
    unit: "писем",
    blocks: false,
    link: "https://app.brevo.com/",
    api: "остаток — да",
  },
  oracle_sportdb: {
    project: "oracle",
    title: "SportDB.dev (топ-события)",
    unit: "запросов",
    blocks: false,
    link: "https://dashboard.sportdb.dev",
    api: "остаток не отдаёт",
  },
};

/** Справочные сервисы проекта — в том порядке, в каком идут в таблице. */
export function servicesOf(project: string): string[] {
  return Object.keys(SERVICES).filter((id) => SERVICES[id].project === project);
}

/** Все сервисы проекта: справочные плюс заведённые руками. */
export async function allServicesOf(project: string): Promise<string[]> {
  const custom = await prisma.wallet.findMany({
    where: { custom: true, project },
    orderBy: { service: "asc" },
    select: { service: true },
  });
  return [...servicesOf(project), ...custom.map((c) => c.service)];
}

/** Проект сервиса; неизвестный сервис считается проектом по умолчанию. */
export function projectOf(service: string): string {
  return SERVICES[service]?.project || DEFAULT_PROJECT;
}

/** Проект сервиса с учётом ручных кошельков — им он записан в строке. */
export async function projectOfAsync(service: string): Promise<string> {
  if (SERVICES[service]) return SERVICES[service].project;
  const row = await prisma.wallet.findUnique({
    where: { service },
    select: { project: true },
  });
  return row?.project || DEFAULT_PROJECT;
}

/**
 * Имя для нового кошелька: из названия, латиницей, с приставкой проекта.
 *
 * Проект зашит в сам идентификатор, как и у справочных сервисов, — тогда
 * строки двух направлений не столкнутся первичным ключом. Занятое имя
 * получает номер: два кошелька «Роутер» у одного проекта — не ошибка
 * человека, а обычная жизнь.
 */
export async function freeServiceId(project: string, title: string): Promise<string> {
  const translit: Record<string, string> = {
    а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "e", ж: "zh", з: "z", и: "i",
    й: "y", к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r", с: "s", т: "t",
    у: "u", ф: "f", х: "h", ц: "c", ч: "ch", ш: "sh", щ: "sch", ъ: "", ы: "y", ь: "",
    э: "e", ю: "yu", я: "ya",
  };
  const slug =
    [...title.toLowerCase()]
      .map((ch) => translit[ch] ?? ch)
      .join("")
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 30) || "wallet";

  const base = `${project}_${slug}`;
  for (let n = 0; n < 100; n++) {
    const id = n ? `${base}_${n + 1}` : base;
    if (SERVICES[id]) continue;
    const busy = await prisma.wallet.findUnique({ where: { service: id }, select: { service: true } });
    if (!busy) return id;
  }
  return `${base}_${Date.now()}`;
}

// Сколько замер считается свежим. Замеры приходят раз в час; три часа — это
// два пропущенных цикла подряд, то есть источник молчит не случайно.
const FRESH_MS = 3 * 60 * 60 * 1000;

export function stateOf(w: { ok: boolean; low: boolean }): string {
  if (!w.ok) return "down";
  return w.low ? "low" : "ok";
}

/** Полная картина по кошелькам проекта: замеры + ручной ввод + пополнения. */
export async function wallets(project = DEFAULT_PROJECT): Promise<WalletRow[]> {
  const ids = await allServicesOf(project);
  const [rows, topups] = await Promise.all([
    prisma.wallet.findMany({ where: { service: { in: ids } } }),
    prisma.walletTopup.groupBy({
      by: ["service"],
      where: { service: { in: ids } },
      _sum: { amount: true },
    }),
  ]);
  const byService = new Map(rows.map((r) => [r.service, r]));
  const topupSum = new Map(topups.map((t) => [t.service, t._sum.amount || 0]));
  const now = Date.now();

  return ids.map((service) => {
    const w = byService.get(service);
    // У ручного кошелька справочника нет — всё, что о нём известно, записано
    // в самой строке.
    const meta = SERVICES[service] || {
      project,
      title: w?.title || service,
      unit: w?.unit || "$",
      blocks: w?.blocks ?? false,
      link: w?.link || "",
      api: "",
    };
    const paid = topupSum.get(service) || 0;
    const at = w?.at ? w.at.toISOString() : null;
    const fresh = Boolean(w?.at && now - w.at.getTime() < FRESH_MS);

    // ОТКУДА БЕРЁМ ОСТАТОК — три источника, в порядке доверия:
    //  1. сервис отдал сам (HeyGen, Brevo, ElevenLabs с правом user_read);
    //  2. человек вписал руками — свежее любых расчётов;
    //  3. считаем: пополнения минус расход (роутер, OpenAI, fal).
    let balance: number | null = null;
    let source = "";
    if (w?.left != null && fresh) {
      balance = w.left;
      source = "сервис отдал сам";
    } else if (w?.manual != null) {
      balance = w.manual;
      source = "внесено руками";
    } else if (paid > 0 && w?.spent != null) {
      balance = Math.round((paid - w.spent) * 100) / 100;
      source = "пополнения минус расход";
    } else if (paid > 0) {
      balance = paid;
      source = "пополнения (расход неизвестен)";
    }

    return {
      service,
      title: w?.title || meta.title,
      ok: w?.ok ?? true,
      low: w?.low ?? false,
      left: w?.left ?? null,
      unit: w?.unit || meta.unit,
      spent: w?.spent ?? null,
      note: w?.note || (w ? "" : "замер ещё не приходил"),
      link: w?.link || meta.link,
      manual: w?.manual ?? null,
      manualAt: w?.manualAt ? w.manualAt.toISOString() : null,
      at,
      fresh,
      topups: Math.round(paid * 100) / 100,
      balance,
      source,
      blocks: SERVICES[service] ? meta.blocks : w?.blocks ?? false,
      custom: w?.custom ?? false,
      inactive: w?.inactive ?? false,
      state: w?.state || "",
    };
  });
}

/** История пополнений проекта — новые сверху. */
export async function topups(project = DEFAULT_PROJECT, limit = 50) {
  const rows = await prisma.walletTopup.findMany({
    where: { service: { in: await allServicesOf(project) } },
    orderBy: { at: "desc" },
    take: Math.min(limit, 200),
  });
  // Названия ручных кошельков живут в их строках, а не в справочнике.
  const titles = new Map(
    (
      await prisma.wallet.findMany({
        where: { service: { in: rows.map((r) => r.service) } },
        select: { service: true, title: true },
      })
    ).map((w) => [w.service, w.title])
  );

  return rows.map((r) => ({
    id: r.id,
    service: r.service,
    title: SERVICES[r.service]?.title || titles.get(r.service) || r.service,
    amount: r.amount,
    at: r.at.toISOString(),
    who: r.who,
    note: r.note,
  }));
}
