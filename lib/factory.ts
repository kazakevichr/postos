// Слоты контент-плана завода. Активность и время больше не зашиты в код:
// слот жив, когда его тип в матрице стоит «по времени», и заморожен, когда
// «по запросу», — переключение в маршрутах сразу меняет план и генерацию.
import { prisma } from "@/lib/prisma";
import { brandFor } from "@/lib/insta";
import { scheduleMap } from "@/lib/routes";
import { MONEYBALL } from "@/lib/moneyball";
import { brandFormats, ruleLabel, scheduleOf } from "@/lib/schedule";
import type { SocialScope } from "@/lib/access";

// Все производимые типы, кроме нарезок (чужой контент, темы не планируются)
// и ручных постов (их темы рождаются вне завода).
const PLAN_KINDS = [
  { slot: "make", label: "Персонаж" },
  { slot: "carousel", label: "Карусель" },
  { slot: "carousel_new", label: "Карусель Новая" },
  { slot: "trainer:female", label: "Тренер Ж" },
  { slot: "trainer:male", label: "Тренер М" },
  { slot: "avatar", label: "ИИ-аватар" },
];

/**
 * Завод, чьи данные показываем и правим.
 *
 * Заводов больше одного: у СуперФита и Оракла свои экземпляры, свои темы и
 * свои типы контента. Ось та же, что у соцсетей, — бренд направления, чтобы
 * одно и то же направление везде значило одно и то же.
 *
 * Без выбранного направления берём СуперФит: «все направления» для завода
 * бессмысленно — заводы не складываются, а владелец, ничего не выбравший,
 * должен увидеть то же, что видел вчера.
 */
export const DEFAULT_BRAND = "superfit";

export function factoryBrand(scope: SocialScope): string {
  return scope.brands?.[0] || DEFAULT_BRAND;
}

/**
 * Заводы со своим ключом, и переменная названа по бренду: MONEYBALL_KEY.
 *
 * Отдельная переменная, а не строка в FACTORY_KEYS, по двум причинам. Там уже
 * лежит ключ Оракла, и дописывая MoneyBall в общую строку, её легко испортить
 * целиком. И по имени сразу видно, чей это ключ.
 *
 * Такой завод свой бренд знает точно, поэтому ему верят без догадок: ни
 * аккаунт публикации, ни тип контента его не переспорят. Назваться им чужим
 * ключом тоже нельзя.
 */
const OWN_KEY_ENV: Record<string, string> = { [MONEYBALL]: "MONEYBALL_KEY" };
export const OWN_KEY_BRANDS = new Set(Object.keys(OWN_KEY_ENV));

function ownKeyBrand(key: string): string | null {
  for (const [brand, env] of Object.entries(OWN_KEY_ENV)) {
    const need = (process.env[env] || "").trim();
    if (need && key === need) return brand;
  }
  return null;
}

/**
 * Заводы, которые сами не публикуют: готовое уходит в бот выдачи, выкладывает
 * человек. Для них «готов» — последнее, что завод может сообщить. По нему и
 * вписывается тема в план, и меряется молчание: «опубликован» от них не
 * придёт никогда.
 */
export const DELIVERY_ONLY = new Set([MONEYBALL]);

/**
 * Ключи заводов из настроек: «ключ → бренд».
 *
 * Основной формат — простые пары «бренд:ключ» через запятую:
 *
 *     FACTORY_KEYS=oracle:9f2c…,party:1ab4…
 *
 * Без кавычек и фигурных скобок намеренно: значение вписывают руками в поле
 * панели, а панели любят толковать скобки по-своему — Coolify, например,
 * подставляет по {{…}}. Значение, которое нечем испортить, не придётся
 * потом искать по симптому «ключ верный, а в ответе forbidden».
 *
 * JSON тоже принимаем — он был первым, и уже вписанное менять незачем.
 */
function keyMap(): Record<string, string> {
  const raw = (process.env.FACTORY_KEYS || "").trim();
  if (!raw) return {};

  if (raw.startsWith("{")) {
    try {
      const parsed = JSON.parse(raw);
      const out: Record<string, string> = {};
      for (const [k, v] of Object.entries(parsed)) {
        if (typeof v === "string" && v.trim()) out[k] = v.trim();
      }
      return out;
    } catch {
      // Кривая настройка не должна ронять приём отчётов завода.
      return {};
    }
  }

  const out: Record<string, string> = {};
  for (const pair of raw.split(",")) {
    // Ключ может содержать двоеточие, бренд — нет: режем по первому.
    const at = pair.indexOf(":");
    if (at < 1) continue;
    const brand = pair.slice(0, at).trim();
    const key = pair.slice(at + 1).trim();
    if (brand && key) out[key] = brand;
  }
  return out;
}

/**
 * Бренд завода, приславшего запрос.
 *
 * Экземпляры заводов ходят к нам по ключу. Основной ключ (IG_HOST_KEY) — это
 * СуперФит, как было; ключи остальных перечисляются в FACTORY_KEYS. Так
 * второй завод подключается сменой одной переменной в его окружении, без
 * правки его кода: чужой проект трогать нечем.
 *
 * Если завод всё же умеет представиться сам — заголовком X-Factory-Brand
 * или полем brand в теле, — его слово главнее.
 *
 * Возвращает null, когда ключ не признан: ручка отвечает 403.
 */
export function factoryAuth(req: Request, body?: any): string | null {
  const key = req.headers.get("x-factory-key") || "";
  if (!key) return null;

  const own = ownKeyBrand(key);
  if (own) return own;

  const brand =
    process.env.IG_HOST_KEY && key === process.env.IG_HOST_KEY
      ? DEFAULT_BRAND
      : keyMap()[key] || null;
  if (!brand) return null;

  const said = String(req.headers.get("x-factory-brand") || body?.brand || "").trim();
  // Завод со своим ключом нельзя изобразить чужим: иначе общий ключ открывал
  // бы его расписание и писал бы в его журнал.
  if (said && OWN_KEY_BRANDS.has(said)) return brand;
  return said || brand;
}

/**
 * Чей это заказ — по аккаунту, куда он опубликован.
 *
 * Так же, как в соцсетях: бренд аккаунта берётся из BRAND_MAP, а канал, в
 * карте не названный, остаётся оракловским. Заводы уже докладывают, куда
 * выложили пост, — значит принадлежность известна и настраивать её незачем.
 *
 * Заказ ещё без ссылок (в производстве) относим по типу контента: типы у
 * заводов свои, и тип, который прежде выходил у Оракла, оракловский и
 * сейчас. Не выяснилось ничего — остаётся то, что записано при приёме.
 */
export function jobBrands(
  rows: { jobId: string; kind: string; links: string; brand: string }[]
): Map<string, string> {
  const byJob = new Map<string, string>();
  const byKind = new Map<string, string>();

  for (const r of rows) {
    // Завод со своим ключом назвал себя сам, и догадка тут только навредит:
    // его ссылки ведут на аккаунты вне BRAND_MAP (и стали бы оракловскими), а
    // типы у него те же, что у соседей. Учиться на нём тоже нельзя: иначе его
    // Персонаж (make) научил бы суперфитовские заказы считаться его.
    if (OWN_KEY_BRANDS.has(r.brand)) {
      byJob.set(r.jobId, r.brand);
      continue;
    }
    let links: any[] = [];
    try {
      links = JSON.parse(r.links);
    } catch {
      // Битая строка ссылок не должна прятать заказ целиком.
    }
    if (!links.length) continue;
    const named = links
      .map((l) => brandFor(String(l?.account || "").replace(/^@/, "")))
      .find((b) => b !== "other");
    const brand = named || "oracle";
    byJob.set(r.jobId, brand);
    if (r.kind && !byKind.has(r.kind)) byKind.set(r.kind, brand);
  }

  for (const r of rows) {
    if (byJob.has(r.jobId)) continue;
    byJob.set(r.jobId, byKind.get(r.kind) || r.brand);
  }
  return byJob;
}

/**
 * Строки контент-плана: чем этот завод занят.
 *
 * У СуперФита состав типов задаётся матрицей маршрутов. У остальных матрицы
 * нет, поэтому сетку выводим из журнала: что завод присылал, то и планируем.
 * Пустой журнал даёт пустую сетку — это честнее выдуманных строк.
 */
export async function planSlots(brand: string = DEFAULT_BRAND) {
  // У MoneyBall своё расписание: строки — его форматы, время — его график.
  if (brand === MONEYBALL) {
    const sched = await scheduleOf(MONEYBALL);
    return brandFormats(MONEYBALL).map((f) => {
      const rule = sched[f.kind];
      const active = rule.mode === "time";
      return { slot: f.kind, label: f.label, fromPlan: f.fromPlan, active, time: active ? ruleLabel(rule) : "—" };
    });
  }

  if (brand === DEFAULT_BRAND) {
    const sched = await scheduleMap();
    return PLAN_KINDS.map((k) => {
      const s = sched[k.slot] || { mode: "demand" };
      return {
        ...k,
        active: s.mode === "time",
        time: s.mode === "time" ? s.time || "—" : "—",
      };
    });
  }

  const rows = await prisma.factoryJob.findMany({
    where: { slot: { not: "" } },
    select: { jobId: true, kind: true, links: true, brand: true, slot: true },
    orderBy: { at: "desc" },
    take: 1000,
  });
  const brands = jobBrands(rows);
  const slots = [...new Set(rows.filter((r) => brands.get(r.jobId) === brand).map((r) => r.slot))];
  return slots.sort().map((slot) => ({ slot, label: slot, active: true, time: "—" }));
}
