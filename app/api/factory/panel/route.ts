import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { socialScope } from "@/lib/access";
import { factoryBrand } from "@/lib/factory";
import { panelData } from "@/lib/panel";
import { saveChannel } from "@/lib/channels";

export const dynamic = "force-dynamic";

// Пульт выбранного направления: каналы, форматы, лента дня. Один вид для
// любого завода — особенности каждого разбираются в lib/panel.ts.
export async function GET() {
  const scope = await socialScope();
  if (!scope) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  return NextResponse.json(await panelData(factoryBrand(scope)));
}

// Правка канала: аккаунт, кто выкладывает, заметка. Только владелец —
// это настройка публикации, а не просмотр.
export async function PUT(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "OWNER") {
    return NextResponse.json({ error: "Каналы меняет владелец" }, { status: 403 });
  }
  const scope = await socialScope();
  if (!scope) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const b = await req.json().catch(() => null);
  if (!b?.channel) return NextResponse.json({ error: "нужен канал" }, { status: 400 });
  try {
    await saveChannel(factoryBrand(scope), String(b.channel), {
      account: b.account, mode: b.mode, note: b.note,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 400 });
  }
  return NextResponse.json(await panelData(factoryBrand(scope)));
}
