import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { socialScope } from "@/lib/access";
import { factoryBrand } from "@/lib/factory";
import { panelData } from "@/lib/panel";
import { setRule } from "@/lib/schedule";

export const dynamic = "force-dynamic";

// Расписание формата — одно устройство на все заводы: дни недели, время по
// Москве и выдача в бот. Раньше у каждого завода была своя ручка и свой вид
// расписания, и экраны получались разными.
export async function PUT(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "OWNER") {
    return NextResponse.json({ error: "Расписание меняет владелец" }, { status: 403 });
  }
  const scope = await socialScope();
  if (!scope) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const brand = factoryBrand(scope);
  const b = await req.json().catch(() => null);
  try {
    await setRule(brand, String(b?.kind || ""), b?.rule);
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 400 });
  }
  return NextResponse.json(await panelData(brand));
}
