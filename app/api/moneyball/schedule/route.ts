import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { socialScope } from "@/lib/access";
import { factoryAuth } from "@/lib/factory";
import { MB_FORMATS, MONEYBALL, mbSchedule, scheduleLabels, setMbRule } from "@/lib/moneyball";

export const dynamic = "force-dynamic";

// Расписание завода MoneyBall.
//
// GET — заводу MoneyBall по его ключу (заголовок X-Factory-Key) и людям блока
// СММ; PUT — владельцу. Завод забирает расписание раз в минуту и при
// недоступности Постоса работает по последнему полученному.
export async function GET(req: Request) {
  if (req.headers.get("x-factory-key")) {
    // Чужой завод получает отказ, а не чужое расписание: ключ СуперФита,
    // пришедший сюда, — это ошибка настройки, и её надо увидеть сразу.
    if (factoryAuth(req) !== MONEYBALL) return new NextResponse("forbidden", { status: 403 });
  } else if (!(await socialScope())) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const schedule = await mbSchedule();
  return NextResponse.json({
    brand: MONEYBALL,
    tz: "Europe/Moscow",
    formats: MB_FORMATS,
    schedule,
    labels: scheduleLabels(schedule),
  });
}

export async function PUT(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "OWNER") {
    return NextResponse.json({ error: "Расписание меняет владелец" }, { status: 403 });
  }
  const b = await req.json().catch(() => null);
  try {
    const schedule = await setMbRule(String(b?.kind || ""), b?.rule);
    return NextResponse.json({ ok: true, schedule, labels: scheduleLabels(schedule) });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 400 });
  }
}
