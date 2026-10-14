import { NextResponse } from "next/server";
import { engineAuth, nextOrder } from "@/lib/engine";

export const dynamic = "force-dynamic";

// Новый завод спрашивает работу: заказ Ведущего со всеми настройками проекта.
export async function GET(req: Request) {
  if (!engineAuth(req)) return new NextResponse("forbidden", { status: 403 });
  const got = await nextOrder();
  if (!got) return NextResponse.json({});
  const o = got.order;
  return NextResponse.json({
    order_id: o.id, brand: o.brand, kind: o.kind, date: o.date, at: o.at,
    topic: o.topic, facts: o.facts, trial: o.trial, approval: o.approval,
    deliver_bot: o.deliverBot, config: got.config,
  });
}
