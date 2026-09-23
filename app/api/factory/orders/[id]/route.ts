import { NextResponse } from "next/server";
import { factoryAuth } from "@/lib/factory";
import { report } from "@/lib/orders";

export const dynamic = "force-dynamic";

// Отчёт завода по заказу. Одна ручка на три события, потому что все три —
// это одна и та же запись в жизни заказа:
//   {"event":"progress"}                       — взял и собираю;
//   {"event":"result","topic":…,"seconds":…}   — готово;
//   {"event":"fail","error":"…"}               — не вышло, с причиной.
//
// Чужой заказ закрыть нельзя: ключ должен совпасть с брендом заказа.
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const brand = factoryAuth(req);
  if (!brand) return new NextResponse("forbidden", { status: 403 });

  const body = await req.json().catch(() => null);
  const order = await report(brand, params.id, body);
  if (!order) return NextResponse.json({ error: "заказ не найден или событие не распознано" }, { status: 400 });
  return NextResponse.json({ ok: true, state: order.state });
}
