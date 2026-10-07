import { NextResponse } from "next/server";
import { DEFAULT_BRAND, factoryAuth } from "@/lib/factory";
import { channelsOf } from "@/lib/channels";
import { accounts, publishPhotos, publishVideo } from "@/lib/uploadpost";
import { raise } from "@/lib/notices";

export const dynamic = "force-dynamic";

// Публикация готового ролика через upload-post.
//
// Завод отдаёт ролик сюда, а Постос решает, куда он выходит: соцсети из блока
// «Аккаунты», у которых включены «Выпускаем сюда» и «Автопубликация».
// Соцсеть должна быть подключена в своём аккаунте (профиле upload-post) —
// без этого выкладывать некуда, и мы честно говорим, почему пропустили.
//
// Так переключатели в Постосе перестают быть бутафорией для заводов, которые
// сами публиковать не умеют (MoneyBall): решение принимается здесь, в одном
// месте. СуперФит публикует сам — ему эта ручка отказывает, иначе ролик
// вышел бы дважды.

const PLATFORM: Record<string, string> = { TT: "tiktok", YT: "youtube", IG: "instagram" };
const LABEL: Record<string, string> = { tiktok: "TikTok", youtube: "YouTube", instagram: "Instagram" };
// Карусель картинками берут только эти площадки: YouTube постов из фото нет.
const PHOTO_OK = ["instagram", "tiktok"];

export async function POST(req: Request) {
  const brand = factoryAuth(req);
  if (!brand) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  if (brand === DEFAULT_BRAND) {
    return NextResponse.json({ error: "СуперФит публикует сам — сюда ролики не шлёт" }, { status: 400 });
  }
  const form = await req.formData();
  const video = form.get("video") as File | null;
  const photos = (form.getAll("photos") as File[]).filter((x) => x && typeof x !== "string");
  const coverRaw = form.get("cover");
  const cover = coverRaw && typeof coverRaw !== "string" ? (coverRaw as File) : null;
  if (!video && !photos.length) return NextResponse.json({ error: "нет ни video, ни photos" }, { status: 400 });
  const caption = String(form.get("caption") || "");
  const title = String(form.get("title") || "");
  const kind = String(form.get("kind") || "");

  const open = (await channelsOf(brand)).filter((c) => !c.paused && c.mode !== "manual" && PLATFORM[c.net]);
  const skipped: { account: string; why: string }[] = [];
  if (!open.length) {
    return NextResponse.json({ ok: true, sent: [], skipped: [{ account: "—", why: "ни у одной соцсети не включены «Выпускаем сюда» и «Автопубликация»" }] });
  }

  let profiles: Awaited<ReturnType<typeof accounts>>["profiles"] = [];
  try {
    profiles = (await accounts(brand)).profiles;
  } catch (e: any) {
    return NextResponse.json({ error: `upload-post не ответил: ${e?.message || e}` }, { status: 502 });
  }
  const main = profiles.find((p) => p.main)?.username || brand;

  // Одна загрузка на профиль: все его площадки разом.
  const byProfile = new Map<string, string[]>();
  for (const c of open) {
    const platform = PLATFORM[c.net];
    const user = c.profile || main;
    const prof = profiles.find((p) => p.username === user);
    const conn = prof?.platforms.find((x) => x.platform === platform);
    const name = `${LABEL[platform]} ${c.account || c.title}`.trim();
    if (!prof) { skipped.push({ account: name, why: `аккаунта «${user}» нет в upload-post` }); continue; }
    if (!conn?.connected) { skipped.push({ account: name, why: `${LABEL[platform]} не подключён в аккаунте «${prof.title}»` }); continue; }
    if (!video && !PHOTO_OK.includes(platform)) { skipped.push({ account: name, why: `${LABEL[platform]} не принимает карусели из картинок` }); continue; }
    const list = byProfile.get(user) || [];
    if (!list.includes(platform)) list.push(platform);
    byProfile.set(user, list);
  }

  const sent: { profile: string; platforms: string[]; request: string }[] = [];
  for (const [user, platforms] of byProfile) {
    try {
      const request = video
        ? await publishVideo(brand, user, platforms, video, video.name || "video.mp4", caption, title, cover)
        : await publishPhotos(brand, user, platforms, photos.map((p) => ({ blob: p, name: p.name || "slide.png" })), caption);
      sent.push({ profile: user, platforms, request });
    } catch (e: any) {
      for (const p of platforms) skipped.push({ account: `${LABEL[p]} (${user})`, why: String(e?.message || e) });
    }
  }

  if (skipped.length) {
    await raise({
      key: `publish:${brand}:${kind || "video"}`, kind: "publish", level: sent.length ? "warn" : "crit", brand,
      title: sent.length ? "Ролик вышел не везде" : "Ролик не опубликован",
      body: skipped.map((s) => `${s.account}: ${s.why}`).join("; "),
      href: "/factory", actionText: "К аккаунтам", roles: ["OWNER"],
    }).catch(() => {});
  }
  return NextResponse.json({ ok: true, sent, skipped });
}
