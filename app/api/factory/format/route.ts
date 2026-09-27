import { NextResponse } from "next/server";
import { factoryAuth } from "@/lib/factory";
import { brandBot, formatOf } from "@/lib/formats";

export const dynamic = "force-dynamic";

// Заводу: тумблеры формата, который работает по событию, а не по заказу.
// Заказ приносит их сам (deliver_bot), а у формата по событию заказа нет —
// завод спрашивает перед сборкой. Бренд — по ключу завода.
//
// on  — производить ли вовсе;
// bot — отдавать ли готовое в бот: тумблер формата И общий рубильник завода.
export async function GET(req: Request) {
  const brand = factoryAuth(req);
  if (!brand) return new NextResponse("forbidden", { status: 403 });
  const kind = new URL(req.url).searchParams.get("kind") || "";
  if (!kind) return NextResponse.json({ error: "kind required" }, { status: 400 });
  const set = await formatOf(brand, kind);
  return NextResponse.json({ brand, kind, on: !set.off, bot: set.bot && (await brandBot(brand)) });
}
