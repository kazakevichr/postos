// Аналитика контент-завода Оракла: шесть языковых YouTube-каналов читаем
// напрямую YouTube Data API (OAuth-токены завода примонтированы с хоста,
// ORACLE_SECRETS_DIR), TikTok — через Analytics API сервиса upload-post,
// которым завод и постит (UPLOAD_POST_KEY).
import fs from "fs";
import path from "path";
import { prisma } from "@/lib/prisma";

const SECRETS = process.env.ORACLE_SECRETS_DIR || "/factory-secrets";
const UP_KEY = process.env.UPLOAD_POST_KEY || "";

function ytLangs(): string[] {
  try {
    return fs.readdirSync(SECRETS)
      .map((f) => f.match(/^yt_token_(.+)\.json$/)?.[1])
      .filter(Boolean) as string[];
  } catch {
    return [];
  }
}

// Обновление access-токена по refresh-токену завода. client_id/secret лежат
// либо в самом файле токена, либо в общем yt_client_secret.json.
async function ytAccessToken(lang: string): Promise<string> {
  const tok = JSON.parse(fs.readFileSync(path.join(SECRETS, `yt_token_${lang}.json`), "utf8"));
  let clientId = tok.client_id;
  let clientSecret = tok.client_secret;
  if (!clientId || !clientSecret) {
    const cs = JSON.parse(fs.readFileSync(path.join(SECRETS, "yt_client_secret.json"), "utf8"));
    const c = cs.installed || cs.web || {};
    clientId = clientId || c.client_id;
    clientSecret = clientSecret || c.client_secret;
  }
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: tok.refresh_token,
      client_id: clientId,
      client_secret: clientSecret,
    }),
  });
  const d = await r.json();
  if (!d.access_token) {
    throw new Error(`yt_${lang}: refresh не дал токен: ${JSON.stringify(d).slice(0, 150)}`);
  }
  return d.access_token;
}

async function ytApi(access: string, resource: string, params: Record<string, string>) {
  const url = new URL(`https://www.googleapis.com/youtube/v3/${resource}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const r = await fetch(url, { headers: { authorization: `Bearer ${access}` } });
  const d = await r.json();
  if (d.error) throw new Error(`yt ${resource}: ${d.error.message}`);
  return d;
}

function mergeMedia(prev: any[], fresh: any[]) {
  const byId = new Map(prev.map((m) => [m.id, m]));
  for (const m of fresh) byId.set(m.id, m);
  return [...byId.values()]
    .sort((a, b) => (b.timestamp || "").localeCompare(a.timestamp || ""))
    .slice(0, 200);
}

async function upsertChannel(platform: string, key: string, profile: any, snap: any, fresh: any[]) {
  const row = await prisma.oracleChannel.findUnique({ where: { platform_key: { platform, key } } });
  let history: any[] = row ? JSON.parse(row.history) : [];
  history = history.filter((h) => h.date !== snap.date);
  history.push(snap);
  history = history.slice(-365);
  const media = mergeMedia(row ? JSON.parse(row.media) : [], fresh);
  // Счётчик канала YouTube (channels.statistics.viewCount) отстаёт от жизни
  // до суток, аповидеошная статистика свежая: во время всплеска канал
  // «терял» тысячи просмотров (исп. канал: счётчик 6.5k при 20.7k по
  // роликам). Берём максимум из двух — свежее и не занижает.
  if (platform === "yt") {
    const sumVideos = media.reduce((acc: number, m: any) => acc + (m.views || 0), 0);
    snap.views = Math.max(snap.views || 0, sumVideos);
    if (profile && typeof profile === "object") {
      profile.totalViews = Math.max(profile.totalViews || 0, sumVideos);
    }
  }
  const fields = {
    profile: JSON.stringify(profile),
    history: JSON.stringify(history),
    media: JSON.stringify(media),
  };
  await prisma.oracleChannel.upsert({
    where: { platform_key: { platform, key } },
    create: { platform, key, ...fields },
    update: fields,
  });
}

// Приём статистики от завода: у СуперФита TikTok читается его приложением
// (Display API), а не сервисом upload-post, поэтому цифры приходят к нам
// снаружи и просто ложатся в ту же таблицу каналов.
export async function ingestChannel(body: any) {
  const platform = String(body?.platform || "");
  const key = String(body?.key || "").replace(/^@/, "");
  if (!["tiktok", "yt"].includes(platform) || !key) {
    throw new Error("нужны platform (tiktok|yt) и key");
  }
  const date = String(body?.date || new Date().toISOString().slice(0, 10));
  const p = body.profile || {};
  const profile = {
    title: p.title || `TikTok @${key}`,
    handle: p.handle || key,
    avatar: p.avatar ?? null,
    followers: p.followers ?? 0,
    videoCount: p.videoCount ?? null,
    url: p.url || `https://tiktok.com/@${key}`,
  };
  const snap = {
    date,
    followers: body.snapshot?.followers ?? profile.followers ?? 0,
    views: body.snapshot?.views ?? 0,
    likes: body.snapshot?.likes ?? 0,
    comments: body.snapshot?.comments ?? 0,
    shares: body.snapshot?.shares ?? 0,
  };
  const media = Array.isArray(body.media) ? body.media.slice(0, 200) : [];
  await upsertChannel(platform, key, profile, snap, media);
  return { platform, key, date, media: media.length };
}

async function collectYt(lang: string, date: string) {
  const access = await ytAccessToken(lang);
  const ch = await ytApi(access, "channels", { part: "snippet,statistics,contentDetails", mine: "true" });
  const c = ch.items?.[0];
  if (!c) throw new Error(`yt_${lang}: канал не найден`);

  let videos: any[] = [];
  const uploads = c.contentDetails?.relatedPlaylists?.uploads;
  if (uploads) {
    const pl = await ytApi(access, "playlistItems", {
      part: "contentDetails", playlistId: uploads, maxResults: "25",
    });
    const ids = (pl.items || []).map((i: any) => i.contentDetails?.videoId).filter(Boolean);
    if (ids.length) {
      const vs = await ytApi(access, "videos", { part: "snippet,statistics", id: ids.join(",") });
      videos = (vs.items || []).map((v: any) => ({
        id: v.id,
        title: v.snippet?.title || "",
        thumbnail: v.snippet?.thumbnails?.medium?.url || v.snippet?.thumbnails?.default?.url || null,
        timestamp: v.snippet?.publishedAt || "",
        permalink: `https://youtube.com/shorts/${v.id}`,
        views: +(v.statistics?.viewCount ?? 0),
        likes: +(v.statistics?.likeCount ?? 0),
        comments: +(v.statistics?.commentCount ?? 0),
      }));
    }
  }

  const handle = c.snippet?.customUrl || "";
  const profile = {
    title: c.snippet?.title || `yt_${lang}`,
    handle,
    avatar: c.snippet?.thumbnails?.default?.url || null,
    followers: +(c.statistics?.subscriberCount ?? 0),
    totalViews: +(c.statistics?.viewCount ?? 0),
    videoCount: +(c.statistics?.videoCount ?? 0),
    url: handle ? `https://youtube.com/${handle}` : `https://youtube.com/channel/${c.id}`,
  };
  await upsertChannel("yt", lang, profile,
    { date, followers: profile.followers, views: profile.totalViews }, videos);
}

// TikTok собираем только с профилей, где он реально подключён, — список
// профилей и их соцсети спрашиваем у upload-post, а не держим в конфиге.
async function upProfiles(): Promise<any[]> {
  const r = await fetch("https://api.upload-post.com/api/uploadposts/users", {
    headers: { authorization: `Apikey ${UP_KEY}` },
  });
  const d = await r.json();
  if (!d.success) throw new Error(`upload-post users: ${JSON.stringify(d).slice(0, 150)}`);
  return d.profiles || [];
}

async function collectTiktok(profileName: string, handle: string, avatar: string | null, date: string) {
  const r = await fetch(
    `https://api.upload-post.com/api/analytics/${encodeURIComponent(profileName)}?platforms=tiktok`,
    { headers: { authorization: `Apikey ${UP_KEY}` } },
  );
  const d = await r.json();
  const t = d.tiktok;
  if (!t || t.error) throw new Error(`${profileName}: tiktok-аналитика не пришла`);
  const profile = {
    title: `TikTok @${handle}`,
    handle,
    avatar,
    followers: t.followers ?? 0,
    videoCount: t.video_count ?? 0,
    url: `https://tiktok.com/@${handle}`,
  };
  await upsertChannel("tiktok", profileName, profile, {
    date,
    followers: t.followers ?? 0,
    views: t.impressions ?? 0,
    likes: t.likes ?? 0,
    comments: t.comments ?? 0,
    shares: t.shares ?? 0,
  }, []);
}

// ── Наш аккаунт upload-post ────────────────────────────────────────────────
// Соцсети, подключённые в блоке «Аккаунты» (профили на UPLOAD_POST_MAIN_KEY):
// MoneyBall, СуперФит и новые проекты. Цифры берём у upload-post — у Instagram
// после удаления аккаунтов СуперФита другого доступа нет. Строки ложатся в ту
// же таблицу каналов, с ключом «up:<профиль>» и брендом из имени профиля
// («superfit-igum-ai» → superfit), чтобы статистика и блок «Аккаунты» узнали
// их сами.
//
// Instagram отдаёт дневной охват рядом (reach_timeseries) — его и пишем в
// историю по дням; подписчики — только сегодняшним числом, прошлых upload-post
// не хранит.
const MAIN_KEY = (process.env.UPLOAD_POST_MAIN_KEY || "").trim();

async function upGet(key: string, path: string) {
  const r = await fetch(`https://api.upload-post.com/api${path}`, { headers: { authorization: `Apikey ${key}` } });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || d.success === false) throw new Error(`upload-post ${path}: ${String(d.message || r.status).slice(0, 120)}`);
  return d;
}

async function collectOwnInstagram(profileName: string, acc: any, date: string) {
  const d = await upGet(MAIN_KEY, `/analytics/${encodeURIComponent(profileName)}?platforms=instagram`);
  const ig = d.instagram;
  if (!ig || ig.error) throw new Error(`${profileName}: instagram-аналитика не пришла`);
  const handle = String(acc.handle || acc.username || profileName).replace(/^@/, "");
  const key = `up:${profileName}`;
  const profile = {
    title: `@${handle}`, handle, avatar: acc.social_images || null,
    followers: ig.followers ?? null, url: `https://instagram.com/${handle}`,
    brand: profileName.split("-")[0], via: "upload-post",
  };
  const row = await prisma.oracleChannel.findUnique({ where: { platform_key: { platform: "upig", key } } });
  const byDate = new Map<string, any>((row ? JSON.parse(row.history) : []).map((h: any) => [h.date, h]));
  for (const t of ig.reach_timeseries || []) {
    if (!t?.date) continue;
    byDate.set(t.date, { ...(byDate.get(t.date) || {}), date: t.date, views: Math.round(t.value || 0), reach: Math.round(t.value || 0) });
  }
  byDate.set(date, { ...(byDate.get(date) || { date }), followers: ig.followers ?? null });
  const history = [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date)).slice(-365);
  const fields = { profile: JSON.stringify(profile), history: JSON.stringify(history), media: row?.media || "[]" };
  await prisma.oracleChannel.upsert({
    where: { platform_key: { platform: "upig", key } },
    create: { platform: "upig", key, ...fields },
    update: fields,
  });
}

async function collectOwn(date: string, summary: { channels: number; errors: string[] }) {
  if (!MAIN_KEY) return;
  const users = await upGet(MAIN_KEY, "/uploadposts/users");
  for (const p of users.profiles || []) {
    const ig = p.social_accounts?.instagram;
    if (ig && typeof ig === "object") {
      try { await collectOwnInstagram(p.username, ig, date); summary.channels++; }
      catch (e: any) { summary.errors.push(e.message); }
    }
  }
}

export async function runOracleCollect() {
  const date = new Date().toISOString().slice(0, 10);
  const summary = { date, channels: 0, errors: [] as string[] };

  for (const lang of ytLangs()) {
    try {
      await collectYt(lang, date);
      summary.channels++;
    } catch (e: any) {
      summary.errors.push(e.message);
    }
  }
  if (!ytLangs().length) summary.errors.push(`нет YouTube-токенов в ${SECRETS}`);

  if (UP_KEY) {
    try {
      for (const p of await upProfiles()) {
        const tk = p.social_accounts?.tiktok;
        if (!tk) continue;
        try {
          await collectTiktok(p.username, tk.handle || p.username, tk.social_images || null, date);
          summary.channels++;
        } catch (e: any) {
          summary.errors.push(e.message);
        }
      }
    } catch (e: any) {
      summary.errors.push(e.message);
    }
  } else {
    summary.errors.push("UPLOAD_POST_KEY не задан — TikTok пропущен");
  }
  try { await collectOwn(date, summary); } catch (e: any) { summary.errors.push(e.message); }
  return summary;
}

export async function oracleStats() {
  const rows = await prisma.oracleChannel.findMany({ orderBy: [{ platform: "asc" }, { key: "asc" }] });
  return {
    channels: rows.map((r) => ({
      platform: r.platform,
      key: r.key,
      profile: JSON.parse(r.profile),
      history: JSON.parse(r.history),
      media: JSON.parse(r.media),
      updatedAt: r.updatedAt.toISOString(),
    })),
  };
}
