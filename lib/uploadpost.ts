import { prisma } from "@/lib/prisma";
import { slugOf } from "@/lib/brands";
export { slugOf };

// upload-post: аккаунты публикации проекта — подключаются прямо из Постоса.
//
// Зачем. Соцсети подключаются к профилю в upload-post, и раньше это делалось
// в их кабинете: отдельный вход, и никто из команды не видел, что куда
// подключено. Теперь «Соц.Сети» показывают все аккаунты проекта и выдают
// ссылку на страницу подключения.
//
// СКОЛЬКО УГОДНО АККАУНТОВ НА ПРОЕКТ. Профиль upload-post вмещает ровно по
// одному аккаунту на площадку — один TikTok, один YouTube, один Instagram.
// А у проекта их бывает много: у СуперФита общий, мужской и женский, у
// MoneyBall — под каждый вид спорта и каждый язык. Поэтому аккаунт проекта —
// это ПРОФИЛЬ, и профилей у проекта сколько нужно. Так же с августа устроен
// Оракл: профиль на язык.
//
// Профили проекта опознаются по имени: основной зовётся как бренд
// («superfit»), остальные — «бренд-что-то» («superfit-muzhskoy»). Отдельной
// таблицы не нужно: источник правды — сам upload-post, а человеческие
// названия («Мужской») лежат в Setting.
//
// ОДИН КЛЮЧ НА ВСЕ ПРОЕКТЫ. Все проекты живут в одном аккаунте upload-post
// (UPLOAD_POST_MAIN_KEY) и различаются только именами профилей. Новый проект
// поэтому не требует ничего: ни переменной, ни перезапуска — блок появляется
// у него сам. Ключ на проект держать было бы ошибкой: каждый новый бренд
// превращался бы в правку настроек сервера.
//
// Исключения — только осознанные. Проект со СВОИМ аккаунтом upload-post
// вписывается в UPLOAD_POST_KEYS парой «проект:ключ». Оракл сюда не
// попадает вовсе: у него чужой аккаунт (партнёра), его ключ UPLOAD_POST_KEY
// нужен только для аналитики TikTok, и заводить профили в чужом аккаунте из
// нашей панели нельзя.

const API = "https://api.upload-post.com/api";

export const PLATFORMS = ["tiktok", "youtube", "instagram"] as const;
export const PLATFORM_LABEL: Record<string, string> = {
  tiktok: "TikTok",
  youtube: "YouTube",
  instagram: "Instagram",
};

// Лимит профилей по тарифу — на ВЕСЬ аккаунт upload-post, а не на проект.
// Цифры с их страницы тарифов на 29.09.2026.
const PLAN_LIMIT: Record<string, number> = {
  free: 2,
  basic: 5,
  professional: 25,
  advanced: 75,
  business: 225,
};

function keyMap(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const pair of (process.env.UPLOAD_POST_KEYS || "").split(",")) {
    const i = pair.indexOf(":");
    if (i <= 0) continue;
    const brand = pair.slice(0, i).trim();
    const key = pair.slice(i + 1).trim();
    if (brand && key) out[brand] = key;
  }
  return out;
}

export function upKey(brand: string): string {
  const own = keyMap()[brand];
  if (own) return own;
  if (brand === "oracle" || brand === "other") return "";
  return (process.env.UPLOAD_POST_MAIN_KEY || "").trim();
}

const belongs = (brand: string, username: string) =>
  username === brand || username.startsWith(`${brand}-`);

async function call(brand: string, path: string, init: RequestInit = {}) {
  const key = upKey(brand);
  if (!key) throw new Error(`для проекта «${brand}» не задан ключ upload-post`);
  const r = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      authorization: `Apikey ${key}`,
      "content-type": "application/json",
      ...(init.headers || {}),
    },
    cache: "no-store",
  });
  const d = await r.json().catch(() => ({}));
  // upload-post отвечает 200 и success:false — это отказ, а не успех.
  if (!r.ok || d.success === false) {
    throw new Error(String(d.message || d.error || `upload-post ответил ${r.status}`));
  }
  return d;
}

// ── Названия профилей ─────────────────────────────────────────────────────
// Имя профиля в upload-post — латиница без пробелов, а человеку нужно
// «Мужской» и «Футбол · English». Имя делаем из названия транслитом, само
// название храним рядом.

const titleKey = (username: string) => `upprofile:${username}`;

async function titles(usernames: string[]): Promise<Record<string, string>> {
  const rows = await prisma.setting.findMany({
    where: { key: { in: usernames.map(titleKey) } },
  });
  return Object.fromEntries(rows.map((r) => [r.key.slice("upprofile:".length), r.value]));
}

// ── Чтение ────────────────────────────────────────────────────────────────

export type Connection = { platform: string; label: string; connected: boolean; handle: string };
export type Profile = { username: string; title: string; main: boolean; platforms: Connection[] };
export type Accounts = { plan: string; limit: number | null; used: number; profiles: Profile[] };

function parseConnections(soc: any): Connection[] {
  return PLATFORMS.map((p) => {
    const v = soc?.[p];
    // Не подключено — пустая строка; подключено — объект с данными аккаунта.
    const connected = Boolean(v && (typeof v !== "string" || v.trim()));
    const handle =
      v && typeof v === "object" ? String(v.username || v.display_name || v.handle || "") : "";
    return { platform: p, label: PLATFORM_LABEL[p], connected, handle };
  });
}

/** Все аккаунты публикации проекта и занятость тарифа. */
export async function accounts(brand: string): Promise<Accounts> {
  const [me, users] = await Promise.all([
    call(brand, "/uploadposts/me"),
    call(brand, "/uploadposts/users"),
  ]);
  const all: any[] = users.profiles || [];
  const mine = all.filter((p) => belongs(brand, String(p.username || "")));
  const names = await titles(mine.map((p) => p.username));
  const plan = String(me.plan || "");
  return {
    plan,
    limit: PLAN_LIMIT[plan.toLowerCase()] ?? null,
    // Лимит тарифа считается по всему аккаунту — включая профили других
    // проектов на том же ключе и безымянный «default».
    used: all.length,
    profiles: mine
      .map((p) => ({
        username: p.username,
        title: names[p.username] || (p.username === brand ? "Основной" : p.username),
        main: p.username === brand,
        platforms: parseConnections(p.social_accounts),
      }))
      .sort((a, b) => Number(b.main) - Number(a.main) || a.title.localeCompare(b.title, "ru")),
  };
}

// ── Изменение ─────────────────────────────────────────────────────────────

/**
 * Завести аккаунт проекта. Первый становится основным и зовётся как бренд —
 * именно в него по умолчанию публикует завод (brand.json →
 * upload_post.profile). Следующие — «бренд-название».
 */
export async function addProfile(brand: string, title: string): Promise<Profile> {
  const clean = title.trim().slice(0, 60);
  if (!clean) throw new Error("нужно название аккаунта — например «Мужской» или «Футбол»");
  const state = await accounts(brand);
  if (state.limit !== null && state.used >= state.limit) {
    throw new Error(
      `тариф ${state.plan} вмещает ${state.limit} профилей, заняты все. ` +
        `Удалите лишний в кабинете upload-post или поднимите тариф`,
    );
  }
  const hasMain = state.profiles.some((p) => p.main);
  const slug = slugOf(clean);
  if (hasMain && !slug) throw new Error("из названия не вышло имени латиницей — добавьте букв или цифр");
  const username = hasMain ? `${brand}-${slug}` : brand;
  if (state.profiles.some((p) => p.username === username)) {
    throw new Error(`аккаунт «${clean}» у проекта уже есть`);
  }
  await call(brand, "/uploadposts/users", {
    method: "POST",
    body: JSON.stringify({ username }),
  });
  await prisma.setting.upsert({
    where: { key: titleKey(username) },
    create: { key: titleKey(username), value: clean },
    update: { value: clean },
  });
  return {
    username,
    title: clean,
    main: username === brand,
    platforms: parseConnections({}),
  };
}

/**
 * Ссылка на страницу подключения соцсетей к аккаунту проекта. Живёт 48
 * часов, после подключения возвращает в «Соц.Сети».
 */
export async function connectLink(brand: string, username: string, redirect: string): Promise<string> {
  if (!belongs(brand, username)) throw new Error("этот аккаунт не принадлежит проекту");
  const d = await call(brand, "/uploadposts/users/generate-jwt", {
    method: "POST",
    body: JSON.stringify({
      username,
      redirect_url: redirect,
      platforms: [...PLATFORMS],
      redirect_button_text: "Вернуться в Постос",
    }),
  });
  if (!d.access_url) throw new Error("upload-post не выдал ссылку");
  return String(d.access_url);
}
