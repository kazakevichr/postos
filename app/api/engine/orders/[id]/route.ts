import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { report } from "@/lib/orders";
import { engineAuth } from "@/lib/engine";

export const dynamic = "force-dynamic";

// Отчёт нового завода по заказу — те же события, что у старых заводов
// (/api/factory/orders/[id]), но бренд берётся из самого заказа: завод один на
// все проекты, а у MoneyBall свой ключ, и общим ключом им не представиться.

export async function GET(req: Request, { params }: { params: { id: string } }) {
  if (!engineAuth(req)) return new NextResponse("forbidden", { status: 403 });
  const order = await prisma.factoryOrder.findUnique({ where: { id: params.id } });
  if (!order) return NextResponse.json({ error: "заказ не найден" }, { status: 404 });
  return NextResponse.json({ order_id: order.id, state: order.state });
}

export async function POST(req: Request, { params }: { params: { id: string } }) {
  if (!engineAuth(req)) return new NextResponse("forbidden", { status: 403 });
  const order = await prisma.factoryOrder.findUnique({ where: { id: params.id } });
  if (!order) return NextResponse.json({ error: "заказ не найден" }, { status: 404 });
  const done = await report(order.brand, order.id, await req.json().catch(() => null));
  if (!done) return NextResponse.json({ error: "событие не распознано" }, { status: 400 });
  return NextResponse.json({ ok: true, state: done.state });
}
