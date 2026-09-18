import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

const G = "https://graph.facebook.com/v23.0";
const VIDEO_TYPES = ["REELS", "VIDEO", "CLIPS"];

function guard(req: Request) {
  const need = process.env.IG_HOST_KEY;
  return Boolean(need) && req.headers.get("x-factory-key") === need;
}

// Очередь на зеркалирование: какие видео из Instagram ещё не уехали на
// площадку. Ссылку на файл берём у Graph API в момент запроса — она живёт
// недолго, поэтому не храним, а выдаём свежей.
export async function GET(req: Request) {
  if (!guard(req)) return new NextResponse("forbidden", { status: 403 });
  const u = new URL(req.url);
  const platform = u.searchParams.get("platform") || "youtube";
  const account = u.searchParams.get("account") || "super.fit24";
  const limit = Math.min(Number(u.searchParams.get("limit") || 30), 60);
  const token = process.env.META_TOKEN;
  if (!token) return NextResponse.json({ error: "нет META_TOKEN" }, { status: 500 });

  const row = await prisma.igAccount.findFirst({ where: { username: account } });
  if (!row) return NextResponse.json({ error: `аккаунт ${account} не найден` }, { status: 404 });
  // Архивный аккаунт очередь не отдаёт: ссылки на файлы у Graph API берутся в
  // момент запроса, а по удалённому аккаунту он ответит ошибкой на каждый
  // ролик. Пусть завод сразу видит причину, а не тридцать пустых file_url.
  if (row.archivedAt) {
    return NextResponse.json(
      { error: `аккаунт ${account} в архиве: ${row.archiveNote || "убран"}`, total: 0, items: [] },
      { status: 409 }
    );
  }

  const done = new Set(
    (await prisma.mirrorLog.findMany({ where: { platform }, select: { permalink: true } }))
      .map((m) => m.permalink)
  );
  const media: any[] = JSON.parse(row.media);
  const queue = media
    .filter((m) => VIDEO_TYPES.includes(String(m.type || "").toUpperCase()))
    .filter((m) => m.permalink && !done.has(m.permalink))
    .sort((a, b) => (a.timestamp || "").localeCompare(b.timestamp || ""))
    .slice(0, limit);

  const items = [];
  for (const m of queue) {
    let fileUrl: string | null = null;
    try {
      const r = await fetch(`${G}/${m.id}?fields=media_url&access_token=${token}`);
      const d = await r.json();
      fileUrl = d.media_url || null;
    } catch {}
    items.push({
      id: m.id,
      permalink: m.permalink,
      caption: m.caption || "",
      timestamp: m.timestamp,
      views: m.views ?? null,
      file_url: fileUrl,
    });
  }
  return NextResponse.json({ platform, account, total: items.length, items });
}

// Завод отмечает, что ролик уехал: {platform, permalink, link}
export async function POST(req: Request) {
  if (!guard(req)) return new NextResponse("forbidden", { status: 403 });
  const b = await req.json().catch(() => null);
  if (!b?.platform || !b?.permalink) {
    return NextResponse.json({ error: "нужны platform и permalink" }, { status: 400 });
  }
  const row = await prisma.mirrorLog.upsert({
    where: { platform_permalink: { platform: b.platform, permalink: b.permalink } },
    create: { platform: b.platform, permalink: b.permalink, link: b.link || "" },
    update: { link: b.link || "" },
  });
  return NextResponse.json({ ok: true, id: row.id });
}
