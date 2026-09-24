import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { factoryAuth } from "@/lib/factory";
import { report } from "@/lib/orders";

export const dynamic = "force-dynamic";

// Чем кончилось согласование. Завод, отправив текст, спрашивает это раз в
// полминуты: «на согласовании» — ждём дальше, «собирается» — человек сказал
// «да», «отклонён» — не сказал, и сборки не будет.
export async function GET(req: Request, { params }: { params: { id: string } }) {
  const brand = factoryAuth(req);
  if (!brand) return new NextResponse("forbidden", { status: 403 });
  const order = await prisma.factoryOrder.findUnique({ where: { id: params.id } });
  if (!order || order.brand !== brand) return NextResponse.json({ error: "заказ не найден" }, { status: 404 });
  // forget — вернуть ли разобранные матчи в пул. «Отклонить» возвращает:
  // человеку не понравился набор. «Другие матчи» — нет: эти он уже видел.
  return NextResponse.json({ order_id: order.id, state: order.state, forget: !order.reroll });
}

// Отчёт завода по заказу. Одна ручка на три события, потому что все три —
// это одна и та же запись в жизни заказа:
//   {"event":"progress"}                       — взял и собираю;
//   {"event":"script","script":"…"}            — текст готов, спрашиваю «да»;
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
