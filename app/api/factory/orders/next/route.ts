import { NextResponse } from "next/server";
import { factoryAuth } from "@/lib/factory";
import { claim, rememberCan } from "@/lib/orders";

export const dynamic = "force-dynamic";

// Завод спрашивает, нет ли для него работы. Пусто — значит, работы нет:
// время ещё не подошло, запас опоздания вышел или предыдущий заказ не закрыт.
//
// Заказ выдаётся один и тем, кто его спросил: бренд берём из ключа, а не из
// параметра запроса, — иначе чужой ключ мог бы забрать чужую работу.
export async function GET(req: Request) {
  const brand = factoryAuth(req);
  if (!brand) return new NextResponse("forbidden", { status: 403 });

  // Завод представляется тем, что умеет: по этому пульт решает, живые у него
  // тумблеры или запертые.
  await rememberCan(brand, req.headers.get("x-factory-can")).catch(() => {});

  const order = await claim(brand);
  if (!order) return NextResponse.json({});
  return NextResponse.json({
    order_id: order.id,
    kind: order.kind,
    date: order.date,
    at: order.at,
    topic: order.topic,
    facts: order.facts,
    deliver_bot: order.deliverBot,
    // Спросить «да» перед платными вызовами: завод присылает текст событием
    // script и ждёт, пока состояние заказа станет «собирается».
    approval: order.approval,
  });
}
