import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { OWN_KEY_BRANDS, factoryAuth } from "@/lib/factory";

export const dynamic = "force-dynamic";

// Завод спрашивает тему дня: GET ?date=YYYY-MM-DD&slot=make
// Ключ говорит не только «свой», но и «чей»: у каждого завода свой план.
export async function GET(req: Request) {
  const brand = factoryAuth(req);
  if (!brand) return new NextResponse("forbidden", { status: 403 });
  const url = new URL(req.url);
  const date = url.searchParams.get("date") || "";
  const slot = url.searchParams.get("slot") || "";

  // Клетки этого дня по такому слоту. Обычно заводы ходят общим ключом, и
  // сказать по нему, кто спрашивает, нельзя — зато типы контента у них свои:
  // «shorts» бывает только у Оракла, «carousel» только у СуперФита. Поэтому
  // сначала ищем клетку своего бренда, а если слот принадлежит ровно одному
  // заводу — отдаём её и без совпадения по ключу.
  //
  // Угадывание — только между заводами на общем ключе. Завод со своим ключом
  // получает строго своё: у MoneyBall и СуперФита есть общий слот make, и без
  // этой оговорки MoneyBall в день без своей темы получил бы фитнес-тему, а
  // СуперФит — спортивную аналитику.
  const rows = await prisma.planSlot.findMany({ where: { date, slot } });
  const guess = OWN_KEY_BRANDS.has(brand) ? [] : rows.filter((r) => !OWN_KEY_BRANDS.has(r.brand));
  const row = rows.find((r) => r.brand === brand) ?? (guess.length === 1 ? guess[0] : null);

  if (!row || !row.topic.trim()) return NextResponse.json({});
  return NextResponse.json({ topic: row.topic, facts: row.facts });
}
