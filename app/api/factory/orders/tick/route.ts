import { NextResponse } from "next/server";
import { factoryAuth } from "@/lib/factory";
import { orderBrands, refresh } from "@/lib/orders";

export const dynamic = "force-dynamic";

// Внутренний тик: Постос заводит заказы на подошедшие слоты сам, не дожидаясь,
// пока завод спросит работу. Без него слот, на котором завод лежал, исчезал бы
// бесследно — а пропущенный выпуск надо видеть в журнале и в уведомлениях.
//
// Зовётся из instrumentation.ts по HTTP, тем же ключом, что и остальные
// внутренние проверки.
export async function POST(req: Request) {
  if (!factoryAuth(req)) return new NextResponse("forbidden", { status: 403 });
  for (const brand of await orderBrands()) await refresh(brand);
  return NextResponse.json({ ok: true });
}
