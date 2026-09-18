import { NextResponse } from "next/server";
import { accessBrands, currentAccess } from "@/lib/access";
import { listOpen, markRead, snooze } from "@/lib/notices";

export const dynamic = "force-dynamic";

// Список открытых уведомлений для того, кто спрашивает: роль решает, что ему
// показывать (деньги — владельцу), направление — про чей завод речь.
export async function GET() {
  const access = await currentAccess();
  if (!access) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json({
    notices: await listOpen({
      role: access.role,
      brands: await accessBrands(access),
      userId: access.userId,
    }),
  });
}

// Отметить прочитанным. Прочтение у каждого своё: владелец уже видел, СММ ещё
// нет — одно и то же уведомление должно вести себя для них по-разному.
export async function POST(req: Request) {
  const access = await currentAccess();
  if (!access) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => ({}));

  // Отложить — отдельное действие, не разновидность «прочитано».
  if (body.action === "snooze" && body.key) {
    const days = Math.min(90, Math.max(1, Number(body.days) || 7));
    const until = await snooze(String(body.key), days);
    return NextResponse.json({ ok: true, until: until.toISOString() });
  }

  const keys: string[] = Array.isArray(body.keys) ? body.keys.map(String) : [];
  if (!keys.length) {
    const all = await listOpen({
      role: access.role,
      brands: await accessBrands(access),
      userId: access.userId,
    });
    await markRead(access.userId, all.map((n) => n.key));
  } else {
    await markRead(access.userId, keys);
  }
  return NextResponse.json({ ok: true });
}
