import { prisma } from "@/lib/prisma";
import { nextPayment } from "@/lib/walletMoney";

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
  users: string[];         // кто на нём сидит — названиями, для показа
  shared: boolean;         // аккаунт общий для нескольких проектов
  perDay: number | null;   // средний расход в день, в единицах кошелька
  week: number | null;     // потрачено за 7 дней
  month: number | null;    // потрачено с начала месяца
  daysLeft: number | null; // на сколько дней хватит при таком расходе
  resetAt: string | null;  // когда пакет обновится сам
  needManual: string;      // что вписать руками и почему ("" — ничего)
  billing: string;         // sub — подписка, balance — пополняемый, "" — не указано
  subAmount: number | null;
  subCurrency: string;
  nextPay: string | null;  // следующее списание подписки
  paidAt: string | null;
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

// Тексты для проекта, у которого своих нет (MoneyBall, новые проекты на
// «Ведущем»): у них, как у СуперФита, пустой кошелёк останавливает выпуск.
export function labelsOf(project: string, title = "") {
  return PROJECTS[project] || { ...PROJECTS.superfit, title: title || project };
}

export const DEFAULT_PROJECT = "superfit";

// Кто сидит на аккаунте. engine — завод content-factory: он работает на все
// проекты, где добавлен «Ведущий», и разворачивается в них при показе.
export const ENGINE = "engine";
const SHARED_POOL = ["superfit", "moneyball", ENGINE];

// Какие типы роликов жгут сервис. По ним общий расход делится между
// проектами — по числу готовых роликов (честная прикидка: точнее, чем смета,
// которая доходит до Постоса не со всех путей сборки). Нет в списке — сервис
// нужен любому ролику.
const SERVICE_KINDS: Record<string, string[]> = {
  heygen: ["avatar", "news", "forecast", "host"],
  eleven: ["avatar", "make", "trainer", "news", "forecast", "host"],
};

/** Проекты, где добавлен «Ведущий», — на них работает завод content-factory. */
async function engineBrands(): Promise<string[]> {
  const rows = await prisma.projectFormat.findMany({ where: { kind: "host" }, select: { brand: true } });
  return Array.from(new Set(rows.map((r) => r.brand)));
}

/** Пользователи кошелька — брендами (engine развёрнут). */
function expand(users: string[], engine: string[]): string[] {
  return Array.from(new Set(users.flatMap((u) => (u === ENGINE ? engine : [u]))));
}

function usersOf(service: string, row?: { users: string; project: string } | null): string[] {
  const fromRow = (row?.users || "").split(",").map((x) => x.trim()).filter(Boolean);
  if (fromRow.length) return fromRow;
  return SERVICES[service]?.users || [SERVICES[service]?.project || row?.project || DEFAULT_PROJECT];
}

/**
 * Проекты с кошельками, видимые человеку.
 *
 * Кошелёк виден в каждом проекте, который на нём сидит. Поэтому у MoneyBall
 * и у новых проектов на «Ведущем» теперь есть свои кошельки — общие с
 * СуперФитом, с пометкой «общий». null на входе — владелец, видит всё.
 */
export async function walletProjects(brands: string[] | null): Promise<string[]> {
  const engine = await engineBrands();
  const rows = await prisma.wallet.findMany({ select: { service: true, users: true, project: true, custom: true, source: true } });
  const all = new Set<string>(Object.keys(PROJECTS));
  for (const id of Object.keys(SERVICES)) expand(usersOf(id), engine).forEach((b) => all.add(b));
  for (const r of rows) {
    if (!SERVICES[r.service] && !r.custom && r.source !== "collector") continue;
    if (r.custom && r.project) all.add(r.project);
    expand(usersOf(r.service, r), engine).forEach((b) => all.add(b));
  }
  const order = ["superfit", "moneyball", "oracle"];
  const list = Array.from(all).sort((a, b) =>
    (order.indexOf(a) + 1 || 99) - (order.indexOf(b) + 1 || 99) || a.localeCompare(b));
  return brands ? list.filter((p) => brands.includes(p)) : list;
}

/** Проекты, которые сидят на кошельке. */
export async function brandsOfWallet(service: string): Promise<string[]> {
  const row = await prisma.wallet.findUnique({ where: { service }, select: { users: true, project: true, custom: true } });
  if (row?.custom) return [row.project || DEFAULT_PROJECT];
  return expand(usersOf(service, row), await engineBrands());
}

/** Синхронный остаток прежнего вызова: только справочные проекты. */
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
  { project: string; title: string; unit: string; blocks: boolean; link: string; api: string; users?: string[] }
> = {
  // ── СуперФит ────────────────────────────────────────────────────────────
  // Общий пул заводов: СуперФит, MoneyBall и content-factory работают на
  // одних и тех же ключах (сверено по отпечаткам 15.10.2026).
  router: {
    project: "superfit",
    users: SHARED_POOL,
    title: "Роутер (router.cheap)",
    unit: "$",
    blocks: false,
    link: "https://router.cheap",
    api: "расход — да, остаток — нет",
  },
  openai: {
    project: "superfit",
    users: SHARED_POOL,
    title: "OpenAI",
    unit: "$",
    blocks: false,
    link: "https://platform.openai.com/settings/organization/billing",
    api: "остаток не отдаёт",
  },
  eleven: {
    project: "superfit",
    users: SHARED_POOL,
    title: "ElevenLabs (озвучка)",
    unit: "символов",
    blocks: false,
    link: "https://elevenlabs.io/app/settings/billing",
    api: "отдаст после перевыпуска ключа с правом user_read",
  },
  // С октября 2026 HeyGen ведёт баланс в долларах (v3/users/me → wallet).
  heygen: {
    project: "superfit",
    users: SHARED_POOL,
    title: "HeyGen (оживление видео)",
    unit: "$",
    blocks: true,
    link: "https://app.heygen.com",
    api: "остаток — да",
  },
  fal: {
    project: "superfit",
    users: ["superfit", "moneyball"],
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
    unit: "$",
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
  // Поиск TalorData у ЗАВОДОВ: один ключ на СуперФит, MoneyBall,
  // content-factory и завод Оракла (отпечатки совпали 15.10.2026). У сайта
  // Оракла — свой аккаунт, это строка oracle_talor.
  talor: {
    project: "superfit",
    users: [...SHARED_POOL, "oracle"],
    title: "TalorData — поиск заводов",
    unit: "кредитов",
    blocks: false,
    link: "https://dashboard.talordata.com",
    api: "остаток не отдаёт · доступ проверяется пробным запросом",
  },
  oracle_talor: {
    project: "oracle",
    title: "TalorData — поиск сайта Оракла",
    unit: "кредитов",
    blocks: false,
    link: "https://dashboard.talordata.com",
    api: "остаток не отдаёт · доступ проверяется пробным запросом",
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

/**
 * Кошельки проекта: свои, общие, на которых он сидит, и заведённые руками.
 * "all" — все кошельки разом (сводка «Все направления»).
 */
export async function allServicesOf(project: string): Promise<string[]> {
  const engine = await engineBrands();
  const rows = await prisma.wallet.findMany({
    orderBy: { service: "asc" },
    select: { service: true, users: true, project: true, custom: true, source: true },
  });
  const byId = new Map(rows.map((r) => [r.service, r]));
  const mine = (id: string) => {
    if (project === "all") return true;
    const r = byId.get(id);
    if (r?.custom) return r.project === project;
    return expand(usersOf(id, r), engine).includes(project);
  };
  // Вне справочника — только заведённое руками и найденное сборщиком: старые
  // строки снятых со справочника сервисов (oracle_talor) не воскресают.
  const ids = [...Object.keys(SERVICES), ...rows.filter((r) => !SERVICES[r.service] && (r.custom || r.source === "collector")).map((r) => r.service)];
  return Array.from(new Set(ids.filter(mine)));
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

// ── Расход по дням ────────────────────────────────────────────────────────
// Каждый замер обновляет снимок своего дня (последний замер дня и есть его
// итог). Расход дня — разница соседних снимков: по «потрачено всего», если
// сервис его отдаёт, иначе по падению остатка. Остаток вырос — это
// пополнение, а не отрицательный расход: такой день просто не считаем.

const MSK = 3 * 3600e3;
export const mskDay = (t = new Date()) => new Date(t.getTime() + MSK).toISOString().slice(0, 10);
const dayNum = (d: string) => Date.parse(`${d}T00:00:00Z`) / 864e5;

export async function snap(service: string, left: number | null, spent: number | null) {
  const day = mskDay();
  await prisma.walletSnap.upsert({
    where: { service_day: { service, day } },
    create: { service, day, left, spent },
    update: { left, spent, at: new Date() },
  });
}

type Spend = { day: string; amount: number; days: number };

async function spendOf(ids: string[]): Promise<Map<string, Spend[]>> {
  const since = mskDay(new Date(Date.now() - 45 * 864e5));
  const snaps = await prisma.walletSnap.findMany({
    where: { service: { in: ids }, day: { gte: since } }, orderBy: { day: "asc" },
  });
  const out = new Map<string, Spend[]>();
  for (const id of ids) {
    const list = snaps.filter((x) => x.service === id);
    const res: Spend[] = [];
    for (let i = 1; i < list.length; i++) {
      const a = list[i - 1], b = list[i];
      const days = dayNum(b.day) - dayNum(a.day);
      let amount: number | null = null;
      if (a.spent != null && b.spent != null) {
        // Счётчик обнулился (у ElevenLabs — новый месяц): с обнуления
        // потрачено столько, сколько он показывает сейчас.
        amount = b.spent >= a.spent ? b.spent - a.spent : b.spent;
      } else if (a.left != null && b.left != null && b.left <= a.left) {
        amount = a.left - b.left;
      }
      if (amount != null && days > 0) res.push({ day: b.day, amount, days });
    }
    out.set(id, res);
  }
  return out;
}

function stats(list: Spend[]) {
  const today = mskDay();
  const month = today.slice(0, 7);
  const t = dayNum(today);
  const recent = list.filter((x) => t - dayNum(x.day) < 14);
  const days = recent.reduce((a, x) => a + x.days, 0);
  const sum = (xs: Spend[]) => Math.round(xs.reduce((a, x) => a + x.amount, 0) * 100) / 100;
  return {
    perDay: days >= 1 ? recent.reduce((a, x) => a + x.amount, 0) / days : null,
    week: list.length ? sum(list.filter((x) => t - dayNum(x.day) < 7)) : null,
    month: list.length ? sum(list.filter((x) => x.day.startsWith(month))) : null,
  };
}

/** Полная картина по кошелькам проекта: замеры + ручной ввод + пополнения. */
export async function wallets(project = DEFAULT_PROJECT): Promise<WalletRow[]> {
  const ids = await allServicesOf(project);
  const [rows, allTopups, spend, engine] = await Promise.all([
    prisma.wallet.findMany({ where: { service: { in: ids } } }),
    prisma.walletTopup.findMany({ where: { service: { in: ids } } }),
    spendOf(ids),
    engineBrands(),
  ]);
  const byService = new Map(rows.map((r) => [r.service, r]));
  const now = Date.now();
  const { brandTitle } = await import("@/lib/brands");
  const titleCache = new Map<string, string>();
  const titleOf = async (b: string) => {
    if (!titleCache.has(b)) titleCache.set(b, PROJECTS[b]?.title || (await brandTitle(b)));
    return titleCache.get(b)!;
  };

  const out: WalletRow[] = [];
  for (const service of ids) {
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
    const mine = allTopups.filter((t) => t.service === service);
    const paid = mine.reduce((a, t) => a + t.amount, 0);
    const at = w?.at ? w.at.toISOString() : null;
    const fresh = Boolean(w?.at && now - w.at.getTime() < FRESH_MS);
    const unit = w?.unit || meta.unit;

    // ОТКУДА БЕРЁМ ОСТАТОК — в порядке доверия:
    //  1. сервис отдал сам (HeyGen, ElevenLabs, Brevo);
    //  2. человек вписал руками — минус потраченное с тех пор и плюс
    //     пополнения после: так один раз вписанный остаток роутера дальше
    //     ведётся сам по его счётчику расхода;
    //  3. пополнения минус расход.
    let balance: number | null = null;
    let source = "";
    if (w?.left != null && fresh) {
      balance = w.left;
      source = "сервис отдал сам";
    } else if (w?.manual != null) {
      const since = w.manualAt ? mine.filter((t) => t.at > w.manualAt!).reduce((a, t) => a + t.amount, 0) : 0;
      const burnt = w.manualSpent != null && w.spent != null ? Math.max(0, w.spent - w.manualSpent) : 0;
      balance = Math.round((w.manual - burnt + since) * 100) / 100;
      source = burnt ? "вписано руками, минус расход с тех пор" : "внесено руками";
    } else if (paid > 0 && w?.spent != null) {
      balance = Math.round((paid - w.spent) * 100) / 100;
      source = "пополнения минус расход";
    } else if (paid > 0) {
      balance = paid;
      source = "пополнения (расход неизвестен)";
    }

    const st = stats(spend.get(service) || []);
    const resetAt = w?.resetAt ? w.resetAt.toISOString() : null;
    const daysLeft = balance != null && st.perDay && st.perDay > 0 ? Math.floor(balance / st.perDay) : null;
    const brands = expand(usersOf(service, w), engine);
    const users = await Promise.all(brands.map(titleOf));

    // Что вписать руками. Сервис не отдаёт ни остатка, ни расхода — раз в
    // неделю нужна свежая цифра из кабинета. Отдаёт расход, но не остаток
    // (роутер) — цифру нужно вписать один раз, дальше она ведётся сама.
    let needManual = "";
    if (w?.billing === "sub") {
      // Подписка — фиксированная сумма: остаток не нужен, нужна сама сумма.
      if (!w.inactive && w.subAmount == null) needManual = "впишите сумму подписки — она сама попадёт в постоянные расходы";
    } else if (!w?.inactive && w?.ok !== false && w?.left == null) {
      // Сломанному сервису цифра из кабинета не поможет — о нём своя тревога.
      const old = !w?.manualAt || now - w.manualAt.getTime() > 7 * 864e5;
      if (w?.spent != null && w?.manual == null && paid === 0) {
        needManual = "впишите остаток из кабинета один раз — дальше он будет уменьшаться сам по расходу";
      } else if (w?.spent == null && old) {
        needManual = w?.manualAt
          ? "остаток вписан больше недели назад — обновите цифру из кабинета"
          : "сервис не отдаёт ни остатка, ни расхода — впишите остаток из кабинета";
      }
    }

    out.push({
      service,
      title: w?.title || meta.title,
      ok: w?.ok ?? true,
      low: (w?.low ?? false) || (daysLeft != null && daysLeft < 7),
      left: w?.left ?? null,
      unit,
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
      users,
      shared: brands.length > 1,
      perDay: st.perDay == null ? null : Math.round(st.perDay * 100) / 100,
      week: st.week,
      month: st.month,
      daysLeft: w?.billing === "sub" ? null : daysLeft,
      resetAt,
      needManual,
      billing: w?.billing || "",
      subAmount: w?.subAmount ?? null,
      subCurrency: w?.subCurrency || "USD",
      nextPay: (() => { const d = w ? nextPayment(w) : null; return d ? d.toISOString() : null; })(),
      paidAt: w?.paidAt ? w.paidAt.toISOString() : null,
    });
  }
  return out;
}

/**
 * Сводка месяца: сколько ушло денег и на какие проекты.
 *
 * Считаются только кошельки в долларах — символы и запросы в деньги без
 * тарифа не переводятся, они видны в таблице своими единицами. Общий расход
 * делится между проектами по числу готовых роликов, которым этот сервис
 * нужен (SERVICE_KINDS). День без роликов остаётся «не разнесено».
 */
export async function summary(project: string) {
  const ids = await allServicesOf("all");
  const rows = await wallets("all");
  const spend = await spendOf(ids);
  const month = mskDay().slice(0, 7);
  const jobs = await prisma.factoryJob.findMany({
    where: { date: { startsWith: month }, event: { in: ["готов", "опубликован"] } },
    select: { brand: true, kind: true, date: true },
  });
  const engine = await engineBrands();
  const byProject = new Map<string, number>();
  let total = 0;
  for (const r of rows) {
    if (r.unit !== "$" || r.inactive) continue;
    const w = await prisma.wallet.findUnique({ where: { service: r.service }, select: { users: true, project: true } });
    const brands = expand(usersOf(r.service, w), engine);
    const kinds = SERVICE_KINDS[r.service];
    for (const x of (spend.get(r.service) || []).filter((x) => x.day.startsWith(month))) {
      total += x.amount;
      const day = jobs.filter((j) => j.date === x.day && brands.includes(j.brand) && (!kinds || kinds.includes(j.kind)));
      if (brands.length === 1) {
        byProject.set(brands[0], (byProject.get(brands[0]) || 0) + x.amount);
      } else if (!day.length) {
        byProject.set("", (byProject.get("") || 0) + x.amount);
      } else {
        for (const j of day) byProject.set(j.brand, (byProject.get(j.brand) || 0) + x.amount / day.length);
      }
    }
  }
  const { brandTitle } = await import("@/lib/brands");
  const parts = await Promise.all(
    Array.from(byProject.entries()).map(async ([b, v]) => ({
      brand: b, title: b ? PROJECTS[b]?.title || (await brandTitle(b)) : "не разнесено", amount: Math.round(v * 100) / 100,
    })),
  );
  parts.sort((a, b) => b.amount - a.amount);
  const visible = project === "all" ? rows : await wallets(project);
  const ending = visible
    .filter((r) => !r.inactive && r.daysLeft != null)
    .sort((a, b) => a.daysLeft! - b.daysLeft!)
    .slice(0, 3)
    .map((r) => ({ title: r.title, daysLeft: r.daysLeft!, balance: r.balance, unit: r.unit }));
  const mine = project === "all" ? null : parts.find((p) => p.brand === project)?.amount ?? 0;
  return { month, total: Math.round(total * 100) / 100, mine, byProject: parts, ending };
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
