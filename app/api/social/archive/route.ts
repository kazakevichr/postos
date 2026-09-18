import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { socialScope } from "@/lib/access";
import { setArchived } from "@/lib/insta";
import { platformFor } from "@/lib/routes";

export const dynamic = "force-dynamic";

// Убрать аккаунт в архив или вернуть обратно.
//
// Архивация — не косметика: она отключает аккаунт во всём нашем контуре.
// Перестаём опрашивать площадку (иначе каждый сбор даёт ошибку и за ней
// перестают замечать настоящие), гасим рубильник площадки (иначе завод
// продолжит долбиться в удалённый аккаунт), убираем из сумм и из очереди
// зеркалирования. Чего она НЕ делает — не удаляет строку: подписчики,
// история и все посты остаются, аккаунт можно вернуть одной кнопкой.
//
// Сам аккаунт в Инстаграме отключить нельзя: Graph API такого не умеет, да и
// архивируют обычно тот, который площадка уже удалила.
//
// Опознание по тому же id, каким карточка живёт в дашборде: "ig-<igId>" для
// Инстаграма, "yt-<ключ>" и "tiktok-<ключ>" для каналов Оракла.
export async function POST(req: Request) {
  const scope = await socialScope();
  if (!scope) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  if (!scope.access.canEdit) {
    return NextResponse.json({ error: "Только с правом изменения" }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const id = String(body.id || "");
  const action = String(body.action || "");
  const note = String(body.note || "").slice(0, 200);
  if (!id || !["archive", "restore"].includes(action)) {
    return NextResponse.json({ error: "нужны id и action: archive | restore" }, { status: 400 });
  }
  const archived = action === "archive";

  let username = "";
  if (id.startsWith("ig-")) {
    const igId = id.slice(3);
    const row = await prisma.igAccount.findUnique({ where: { igId } });
    if (!row) return NextResponse.json({ error: "аккаунт не найден" }, { status: 404 });
    username = row.username;
    await setArchived(igId, archived, note);
  } else {
    const dash = id.indexOf("-");
    const platform = id.slice(0, dash) === "youtube" ? "yt" : id.slice(0, dash);
    const key = id.slice(dash + 1);
    const row = await prisma.oracleChannel.findFirst({ where: { platform, key } });
    if (!row) return NextResponse.json({ error: "канал не найден" }, { status: 404 });
    username = JSON.parse(row.profile).handle || row.key;
    await prisma.oracleChannel.update({
      where: { id: row.id },
      data: archived
        ? {
            archivedAt: new Date(),
            archiveNote: note || "убран вручную",
            lastSeenAt: row.lastSeenAt || row.updatedAt,
          }
        : { archivedAt: null, archiveNote: "", lastError: "", lastErrorAt: null, failCount: 0 },
    });
  }

  // Рубильник площадки. Гасим при архивации, но НЕ включаем обратно при
  // возврате: человек мог выключить площадку по своей причине, и возврат
  // аккаунта из архива — не повод публиковать туда без спроса.
  const platform = platformFor(username);
  let routeOff = false;
  if (archived && platform) {
    await prisma.routeFlag.upsert({
      where: { platform_kind: { platform, kind: "*" } },
      create: { platform, kind: "*", enabled: false },
      update: { enabled: false },
    });
    routeOff = true;
  }

  return NextResponse.json({ ok: true, username, archived, routeOff, platform });
}
