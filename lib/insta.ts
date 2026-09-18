// Инста-аналитика: сбор статистики аккаунтов через Graph API и чтение для
// дашборда. Перенос netlify/functions/_meta.js из insta-hq: хранилище вместо
// Netlify Blobs — таблица IgAccount, доступ вместо DASH_KEY — сессия NextAuth.
import { prisma } from "@/lib/prisma";

const G = "https://graph.facebook.com/v23.0";

export function brandMap(): Record<string, string[]> {
  try {
    return JSON.parse(process.env.BRAND_MAP || "{}");
  } catch {
    return {};
  }
}

export function brandNames(): string[] {
  return [...Object.keys(brandMap()), "other"];
}

// Какие аккаунты наполняет контент-завод (остальные считаются ручными).
// Разделение по аккаунтам точное: woman и training целиком заводские,
// super.fit24 — только ручные публикации из бота.
function factoryAccounts(): string[] {
  return (process.env.IG_FACTORY_ACCOUNTS || "superfit24_woman,superfit24_training")
    .split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
}

export function sourceFor(username: string): "factory" | "manual" {
  return factoryAccounts().includes((username || "").toLowerCase()) ? "factory" : "manual";
}

export function brandFor(username: string): string {
  const u = (username || "").toLowerCase();
  for (const [brand, users] of Object.entries(brandMap())) {
    if ((users || []).some((x) => x.toLowerCase().replace(/^@/, "") === u)) return brand;
  }
  return "other";
}

async function gfetch(url: string | URL) {
  const res = await fetch(url);
  const data = await res.json();
  if (data.error) throw new Error(data.error.message);
  return data;
}

async function gget(path: string, params: Record<string, string>, token: string) {
  const url = new URL(`${G}/${path}`);
  for (const [k, v] of Object.entries(params || {})) url.searchParams.set(k, v);
  url.searchParams.set("access_token", token);
  return gfetch(url);
}

// IG-аккаунты, назначенные системному пользователю напрямую (META_IG_IDS через
// запятую); запасной путь — через страницы Facebook (me/accounts)
async function discoverAccounts(token: string, errors: string[] = []) {
  const accounts: any[] = [];
  const ids = (process.env.META_IG_IDS || "").split(",").map((s) => s.trim()).filter(Boolean);
  // Архивные не опрашиваем вовсе: аккаунт удалён площадкой, и каждый заход к
  // Мете за ним — гарантированная ошибка в сводке, из-за которой перестают
  // замечать настоящие.
  const archived = new Set(
    (await prisma.igAccount.findMany({
      where: { NOT: { archivedAt: null } },
      select: { igId: true },
    })).map((r) => r.igId)
  );

  if (ids.length) {
    for (const id of ids) {
      if (archived.has(id)) continue;
      // Один недоступный аккаунт (отвязали в Business Manager, ограничение
      // Меты) не должен хоронить сбор по остальным: 19.08 ровно так пропал
      // весь сбор из-за одного superfit24_training.
      try {
        const ig = await gget(id, {
          fields: "id,username,followers_count,media_count,profile_picture_url",
        }, token);
        accounts.push({
          igId: ig.id,
          username: ig.username,
          followers: ig.followers_count,
          mediaCount: ig.media_count,
          avatar: ig.profile_picture_url,
        });
      } catch (e: any) {
        errors.push(`${id}: ${e.message}`);
        await noteFailure(id, e.message);
      }
    }
    return accounts;
  }

  let data = await gget("me/accounts", {
    fields: "name,instagram_business_account{id,username,followers_count,media_count,profile_picture_url}",
    limit: "50",
  }, token);
  while (data) {
    for (const page of data.data || []) {
      const ig = page.instagram_business_account;
      if (!ig) continue;
      accounts.push({
        pageId: page.id,
        pageName: page.name,
        igId: ig.id,
        username: ig.username,
        followers: ig.followers_count,
        mediaCount: ig.media_count,
        avatar: ig.profile_picture_url,
      });
    }
    data = data.paging?.next ? await gfetch(data.paging.next) : null;
  }
  return accounts;
}

// Дневные метрики аккаунта; каждая группа — отдельный запрос, падение одной
// не валит сбор
async function accountInsights(igId: string, token: string) {
  const out: Record<string, number | null> = {};
  // Все метрики одним разрезом — total_value за сутки. Раньше охват брался
  // без metric_type: тот запрос отдаёт ряд ЗАВЕРШЁННЫХ суток по часовому поясу
  // аккаунта, и последнее значение относилось к позавчера, а писалось под
  // сегодняшнюю дату — охват выходил сдвинутым и занижённым втрое.
  try {
    const r = await gget(`${igId}/insights`, {
      metric: "views,reach,profile_views,accounts_engaged",
      metric_type: "total_value",
      period: "day",
    }, token);
    for (const m of r.data || []) out[m.name] = m.total_value?.value ?? null;
  } catch {}
  if (out.reach == null) {
    // Запасной путь, если total_value недоступен для аккаунта.
    try {
      const r = await gget(`${igId}/insights`, { metric: "reach", period: "day" }, token);
      out.reach = r.data?.[0]?.values?.at(-1)?.value ?? null;
    } catch {}
  }
  return out;
}

function normalizeInsights(insights: any) {
  const out: Record<string, number | null> = {};
  for (const m of insights?.data || []) {
    out[m.name] = m.values?.[0]?.value ?? m.total_value?.value ?? null;
  }
  return out;
}

const MEDIA_FIELDS = "id,caption,media_type,media_product_type,timestamp,permalink,like_count,comments_count,thumbnail_url,media_url";
const MEDIA_METRICS = "views,reach,shares,saved,total_interactions";

async function mediaWithInsights(igId: string, token: string, limit = 25) {
  let items: any[];
  try {
    const r = await gget(`${igId}/media`, {
      fields: `${MEDIA_FIELDS},insights.metric(${MEDIA_METRICS})`,
      limit: String(limit),
    }, token);
    items = (r.data || []).map((m: any) => ({ ...m, insights: normalizeInsights(m.insights) }));
  } catch {
    // Инлайновые insights падают на отдельных типах медиа — добираем по одному
    const r = await gget(`${igId}/media`, { fields: MEDIA_FIELDS, limit: String(limit) }, token);
    items = [];
    for (const m of r.data || []) {
      let insights = {};
      try {
        const ir = await gget(`${m.id}/insights`, { metric: MEDIA_METRICS }, token);
        insights = normalizeInsights(ir);
      } catch {
        try {
          const ir = await gget(`${m.id}/insights`, { metric: "views,reach" }, token);
          insights = normalizeInsights(ir);
        } catch {}
      }
      items.push({ ...m, insights });
    }
  }
  return items.map((m) => ({
    id: m.id,
    caption: (m.caption || "").slice(0, 500),
    type: m.media_product_type || m.media_type,
    // media_product_type у карусели — просто FEED, как у фото; для нормы СММ
    // нужен исходный media_type (CAROUSEL_ALBUM/VIDEO/IMAGE).
    mediaType: m.media_type || null,
    timestamp: m.timestamp,
    permalink: m.permalink,
    thumbnail: m.thumbnail_url || m.media_url || null,
    likes: m.like_count ?? null,
    comments: m.comments_count ?? null,
    ...m.insights,
  }));
}

function mergeMedia(prev: any[], fresh: any[]) {
  const byId = new Map(prev.map((m) => [m.id, m]));
  for (const m of fresh) byId.set(m.id, m);
  return [...byId.values()]
    .sort((a, b) => (b.timestamp || "").localeCompare(a.timestamp || ""))
    .slice(0, 200);
}

// Чужие публичные бизнес-аккаунты (Лео и т.п.): читаются через
// business_discovery от имени нашего аккаунта, разрешений не требуется.
// Список юзернеймов живёт в Setting bd:list — пополняется без деплоя.
async function bdList(): Promise<string[]> {
  const row = await prisma.setting.findUnique({ where: { key: "bd:list" } });
  try { return row ? JSON.parse(row.value) : []; } catch { return []; }
}

async function collectDiscovery(username: string, token: string, date: string) {
  const own = (process.env.META_IG_IDS || "").split(",")[0]?.trim();
  if (!own) throw new Error("нет META_IG_IDS для business_discovery");
  const fields = `business_discovery.username(${username}){username,name,followers_count,media_count,profile_picture_url,media.limit(30){media_type,media_product_type,timestamp,permalink,like_count,comments_count,caption}}`;
  const d = await gget(own, { fields }, token);
  const bd = d.business_discovery;
  if (!bd) throw new Error(`${username}: business_discovery пуст`);
  const media = (bd.media?.data || []).map((m: any) => ({
    id: m.id,
    caption: (m.caption || "").slice(0, 500),
    type: m.media_product_type || m.media_type,
    mediaType: m.media_type || null,
    timestamp: m.timestamp,
    permalink: m.permalink,
    thumbnail: null,
    likes: m.like_count ?? null,
    comments: m.comments_count ?? null,
  }));
  const igId = `bd:${bd.username}`;
  const row = await prisma.igAccount.findUnique({ where: { igId } });
  let history: any[] = row ? JSON.parse(row.history) : [];
  history = history.filter((h) => h.date !== date);
  history.push({ date, followers: bd.followers_count ?? null });
  history = history.slice(-365);
  const fields2 = {
    username: bd.username,
    brand: brandFor(bd.username),
    profile: JSON.stringify({
      username: bd.username,
      name: bd.name || bd.username,
      profile_picture_url: bd.profile_picture_url || null,
      followers: bd.followers_count ?? null,
      mediaCount: bd.media_count ?? null,
      discovery: true,
    }),
    history: JSON.stringify(history),
    media: JSON.stringify(mergeMedia(row ? JSON.parse(row.media) : [], media)),
  };
  await prisma.igAccount.upsert({
    where: { igId },
    create: { igId, ...fields2 },
    update: fields2,
  });
}

export async function runCollect() {
  const date = new Date().toISOString().slice(0, 10);
  const token = process.env.META_TOKEN;
  const summary = { date, accounts: 0, errors: [] as string[] };
  if (!token) {
    summary.errors.push("META_TOKEN не задан");
    return summary;
  }
  await pruneRemoved();

  let accounts: any[] = [];
  try {
    accounts = await discoverAccounts(token, summary.errors);
  } catch (e: any) {
    summary.errors.push(`discover: ${e.message}`);
  }

  for (const acc of accounts) {
    const brand = brandFor(acc.username);
    try {
      const ins = await accountInsights(acc.igId, token);
      const media = await mediaWithInsights(acc.igId, token);
      const row = await prisma.igAccount.findUnique({ where: { igId: acc.igId } });
      let history: any[] = row ? JSON.parse(row.history) : [];
      const prevMedia: any[] = row ? JSON.parse(row.media) : [];
      history = history.filter((h) => h.date !== date);
      history.push({ date, followers: acc.followers, ...ins });
      history = history.slice(-365);
      const merged = mergeMedia(prevMedia, media);
      const fields = {
        username: acc.username,
        brand,
        profile: JSON.stringify(acc),
        history: JSON.stringify(history),
        media: JSON.stringify(merged),
        // Удачный сбор стирает след неудач: аккаунт, который вчера не читался
        // из-за суточного ограничения Меты, не должен всю неделю числиться
        // подозрительным.
        lastSeenAt: new Date(),
        lastError: "",
        lastErrorAt: null,
        failCount: 0,
      };
      // Аккаунт, который не читался, снова отвечает. Молча вернуть его в строй
      // мало: человек мог неделю ждать документов от Меты и об этом же
      // спрашивать. Пропажу заметили уведомлением — возвращение тоже.
      if (row && row.failCount >= SUSPICIOUS_AFTER) {
        const { raise } = await import("@/lib/notices");
        await raise({
          key: `meta:back:${acc.igId}`,
          kind: "meta",
          level: "info",
          brand,
          title: `@${acc.username} снова читается`,
          body: row.note
            ? `Площадка опять отдаёт данные. Заметка «${row.note}» больше не актуальна — снимите её.`
            : "Площадка опять отдаёт данные, сбор пошёл как обычно.",
          href: "/social",
          actionText: "К аккаунту",
        }).catch(() => {});
      }

      // Упавший аккаунт в базу не пишется вовсе — в Netlify-версии он попадал
      // в индекс даже после ошибки и чтение его отфильтровывало.
      await prisma.igAccount.upsert({
        where: { igId: acc.igId },
        create: { igId: acc.igId, ...fields },
        update: fields,
      });
      summary.accounts++;
    } catch (e: any) {
      summary.errors.push(`${acc.username}: ${e.message}`);
      await noteFailure(acc.igId, e.message);
    }
  }
  for (const u of await bdList()) {
    try {
      await collectDiscovery(u, token!, date);
      summary.accounts++;
    } catch (e: any) {
      summary.errors.push(`bd ${u}: ${e.message}`);
    }
  }
  return summary;
}

// Сколько сборов подряд аккаунт должен не читаться, чтобы считаться
// подозрительным. Меньше трёх — ловим суточные ограничения Меты, которые
// проходят сами; больше — узнаём о блокировке через сутки.
export const SUSPICIOUS_AFTER = 3;

// Аккаунт не прочитался: запоминаем ответ площадки и считаем неудачи подряд.
// Раньше ошибка жила только в ответе сбора и пропадала вместе с ним, поэтому
// на вопрос «почему не публикуется» ответить было нечем.
async function noteFailure(igId: string, message: string) {
  try {
    const row = await prisma.igAccount.findUnique({ where: { igId } });
    if (!row || row.archivedAt) return;
    await prisma.igAccount.update({
      where: { igId },
      data: {
        lastError: (message || "").slice(0, 500),
        lastErrorAt: new Date(),
        failCount: row.failCount + 1,
      },
    });
  } catch {
    // Учёт неудач не должен ронять сбор по остальным аккаунтам.
  }
}

// Аккаунты, убранные из META_IG_IDS, уходят В АРХИВ, а не в небытие.
//
// Раньше здесь стоял deleteMany, и это была мина: достаточно было убрать ID из
// переменной окружения — например, меняя удалённый аккаунт на новый, — и
// следующий же сбор стирал строку со всей историей подписчиков и всеми
// постами. Так в августе 2026 бесследно исчез superfit24_training.
//
// Теперь строка остаётся с отметкой archivedAt: к Мете за ней больше не
// ходим, в суммы она не входит, но цифры на месте и аккаунт можно вернуть.
export async function pruneRemoved() {
  const ids = (process.env.META_IG_IDS || "").split(",").map((s) => s.trim()).filter(Boolean);
  if (!ids.length) return;
  await prisma.igAccount.updateMany({
    where: { igId: { notIn: ids }, archivedAt: null, NOT: { igId: { startsWith: "bd:" } } },
    data: { archivedAt: new Date(), archiveNote: "убран из META_IG_IDS" },
  });
}

// Убрать аккаунт в архив или вернуть обратно. Гашение маршрутов делает вызов
// в app/api/social/archive: здесь только само хранилище.
export async function setArchived(igId: string, archived: boolean, note = "") {
  const row = await prisma.igAccount.findUnique({ where: { igId } });
  if (!row) return null;
  return prisma.igAccount.update({
    where: { igId },
    data: archived
      ? {
          archivedAt: new Date(),
          archiveNote: note || "убран вручную",
          // Дата живых цифр: если сбор ни разу не проходил после добавления
          // поля, считаем ею последнюю запись.
          lastSeenAt: row.lastSeenAt || row.updatedAt,
        }
      : { archivedAt: null, archiveNote: "", lastError: "", lastErrorAt: null, failCount: 0 },
  });
}

export async function statsForBrand(brand: string) {
  const rows = await prisma.igAccount.findMany({
    where: { brand },
    orderBy: { username: "asc" },
  });
  return {
    brand,
    accounts: rows.map((r) => ({
      profile: JSON.parse(r.profile),
      source: sourceFor(r.username),
      history: JSON.parse(r.history),
      media: JSON.parse(r.media),
      updatedAt: r.updatedAt.toISOString(),
    })),
  };
}
