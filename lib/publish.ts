import { channelsOf } from "@/lib/channels";
import { accounts, publishPhotos, publishVideo } from "@/lib/uploadpost";
import { raise } from "@/lib/notices";

// Публикация готового ролика или карусели через upload-post — общая для
// старых заводов (/api/factory/publish) и нового (/api/engine/publish).
//
// Куда выходит, решает Постос: соцсети из блока «Аккаунты», у которых
// включены «Выпускаем сюда» и «Автопубликация». Соцсеть должна быть
// подключена в своём аккаунте (профиле upload-post) — без этого выкладывать
// некуда, и мы честно говорим, почему пропустили.

const PLATFORM: Record<string, string> = { TT: "tiktok", YT: "youtube", IG: "instagram" };
const LABEL: Record<string, string> = { tiktok: "TikTok", youtube: "YouTube", instagram: "Instagram" };
// Карусель картинками берут только эти площадки: YouTube постов из фото нет.
const PHOTO_OK = ["instagram", "tiktok"];

export type PublishResult = { sent: { profile: string; platforms: string[]; request: string }[]; skipped: { account: string; why: string }[] };

export async function publishFor(brand: string, p: {
  video: File | null; photos: File[]; cover: File | null; caption: string; title: string; kind: string;
}): Promise<PublishResult> {
  const { video, photos, cover, caption, title, kind } = p;
  const open = (await channelsOf(brand)).filter((c) => !c.paused && c.mode !== "manual" && PLATFORM[c.net]);
  const skipped: { account: string; why: string }[] = [];
  if (!open.length) {
    return { sent: [], skipped: [{ account: "—", why: "ни у одной соцсети не включены «Выпускаем сюда» и «Автопубликация»" }] };
  }

  const { profiles } = await accounts(brand).catch((e: any) => {
    throw new Error(`upload-post не ответил: ${e?.message || e}`);
  });
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
  return { sent, skipped };
}
