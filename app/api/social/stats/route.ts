import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { inScope, socialScope } from "@/lib/access";
import { brandFor } from "@/lib/insta";
import { publishStates } from "@/lib/publishing";


export const dynamic = "force-dynamic";

// Все аккаунты всех платформ одной формой: платформа + проект (бренд) +
// профиль — три оси, по которым фильтрует дашборд «Соц.Сети».
export async function GET() {
  const scope = await socialScope();
  if (!scope) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  // Источник правды о заводских постах — журнал завода: события «опубликован»
  // несут permalink. Деление по аккаунтам устарело: завод постит и в
  // super.fit24 (автоплан), а woman получает нарезки.
  const factoryLinks = new Set<string>();
  const norm = (u: string) =>
    (u || "").replace(/^https?:\/\//, "").replace(/^www\./, "").split("?")[0].replace(/\/$/, "");
  for (const j of await prisma.factoryJob.findMany({ select: { links: true } })) {
    for (const l of JSON.parse(j.links)) if (l?.link) factoryLinks.add(norm(l.link));
  }

  const accounts: any[] = [];

  // Почему аккаунт публикует или нет — один запрос на всех, а не по карточке.
  const igRows = await prisma.igAccount.findMany({ orderBy: { username: "asc" } });
  const states = await publishStates(igRows.filter((r) => !r.igId.startsWith("bd:")));

  for (const r of igRows) {
    // Аккаунты Лео (business_discovery) — только для нормы СММ в кабинете:
    // это партнёрские страницы, в общей аналитике соцсетей им не место.
    if (r.igId.startsWith("bd:")) continue;
    const p = JSON.parse(r.profile);
    accounts.push({
      id: `ig-${r.igId}`,
      platform: "instagram",
      brand: r.brand,
      username: r.username,
      title: `@${r.username}`,
      avatar: p.avatar || null,
      url: `https://instagram.com/${r.username}`,
      followers: p.followers ?? null,
      history: JSON.parse(r.history),
      media: JSON.parse(r.media).map((m: any) => ({
        ...m,
        source: factoryLinks.has(norm(m.permalink)) ? "factory" : "manual",
      })),
      updatedAt: r.updatedAt.toISOString(),
      // Архив и причина молчания: карточке нужно и то, и другое — значок
      // состояния и подсказка «почему», чтобы не искать по разделам.
      archived: Boolean(r.archivedAt),
      archivedAt: r.archivedAt ? r.archivedAt.toISOString() : null,
      archiveNote: r.archiveNote,
      note: r.note,
      lastSeenAt: (r.lastSeenAt || r.updatedAt).toISOString(),
      postsKept: JSON.parse(r.media).length,
      publishes: states[r.username]?.publishes ?? false,
      suspicious: states[r.username]?.suspicious ?? false,
      reason: states[r.username]?.reason ?? null,
    });
  }

  // Каналы ведут себя так же, как инстаграмы: их тоже блокируют, и их тоже
  // надо уметь убрать в архив, не теряя накопленного.
  const chanRows = await prisma.oracleChannel.findMany({ orderBy: [{ platform: "asc" }, { key: "asc" }] });
  const chanStates = await publishStates(
    chanRows.map((r) => ({ ...r, username: JSON.parse(r.profile).handle || r.key }))
  );

  for (const r of chanRows) {
    const p = JSON.parse(r.profile);
    const handle = p.handle || r.key;
    const history: any[] = JSON.parse(r.history);
    const media: any[] = JSON.parse(r.media);
    accounts.push({
      id: `${r.platform}-${r.key}`,
      platform: r.platform === "yt" ? "youtube" : "tiktok",
      // Бренд канала берём из BRAND_MAP по хэндлу или ключу: так аккаунты
      // СуперФита в TikTok/YouTube попадают в свой фильтр, а не в «Оракл».
      // Не указанные в карте каналы остаются оракловскими, как было.
      brand: [p.handle, r.key]
        .map((x: any) => brandFor(String(x || "").replace(/^@/, "")))
        .find((b: string) => b !== "other") || "oracle",
      username: p.handle || r.key,
      title: p.title || r.key,
      avatar: p.avatar || null,
      url: p.url || "",
      followers: p.followers ?? null,
      totalViews: p.totalViews ?? null,
      lang: r.platform === "yt" ? r.key : undefined,
      source: "factory",
      // И YouTube, и TikTok отдают накопленные с начала времён числа: канал
      // хранит суммарные просмотры, TikTok — сумму по роликам и лайки за всё
      // время. Дашборду нужны дневные величины, поэтому считаем дельту здесь.
      // Раньше дельта была только у YouTube, и суммы по TikTok завышались в
      // разы: неактивный оракловский аккаунт «набирал» 2268 просмотров каждый
      // день, хотя это одно и то же накопленное число.
      history: history.map((h, i) => {
        const prev: any = i > 0 ? history[i - 1] : null;
        const delta = (field: string) =>
          Math.max(0, (h[field] || 0) - (prev ? prev[field] || 0 : h[field] || 0));
        if (r.platform === "yt") return { ...h, views: delta("views") };
        return {
          ...h,
          views: delta("views"),
          likes: delta("likes"),
          comments: delta("comments"),
          shares: delta("shares"),
        };
      }),
      media: media.map((m) => ({ ...m, caption: m.caption ?? m.title ?? "" })),
      updatedAt: r.updatedAt.toISOString(),
      archived: Boolean(r.archivedAt),
      archivedAt: r.archivedAt ? r.archivedAt.toISOString() : null,
      archiveNote: r.archiveNote,
      note: r.note,
      lastSeenAt: (r.lastSeenAt || r.updatedAt).toISOString(),
      postsKept: media.length,
      publishes: chanStates[handle]?.publishes ?? false,
      suspicious: chanStates[handle]?.suspicious ?? false,
      reason: chanStates[handle]?.reason ?? null,
    });
  }

  // Рамки направления режем здесь, а не на показе: клиент фильтрует те же
  // бренды, но у партнёра это единственная граница — отдавать ему чужие
  // аккаунты и надеяться, что браузер их спрячет, значит не иметь границы.
  return NextResponse.json({ accounts: inScope(accounts, scope.brands) });
}
