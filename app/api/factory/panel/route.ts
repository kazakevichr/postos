import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { socialScope } from "@/lib/access";
import { factoryBrand } from "@/lib/factory";
import { panelData } from "@/lib/panel";
import { saveChannel } from "@/lib/channels";
import { setOrders } from "@/lib/orders";

export const dynamic = "force-dynamic";

// Пульт выбранного направления: каналы, форматы, лента дня. Один вид для
// любого завода — особенности каждого разбираются в lib/panel.ts.
export async function GET() {
  const scope = await socialScope();
  if (!scope) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  return NextResponse.json(await panelData(factoryBrand(scope)));
}

// Правка канала: аккаунт, кто выкладывает, заметка. Только владелец —
// это настройка публикации, а не просмотр.
export async function PUT(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "OWNER") {
    return NextResponse.json({ error: "Каналы меняет владелец" }, { status: 403 });
  }
  const scope = await socialScope();
  if (!scope) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const b = await req.json().catch(() => null);
  const brand = factoryBrand(scope);
  try {
    // Кто решает, когда производить: Постос заказом или завод сам. Перевод
    // делается в два действия — тумблер здесь и ORDERS=1 в .env завода, —
    // чтобы вернуться назад можно было одним щелчком.
    if (typeof b?.orders === "boolean") await setOrders(brand, b.orders);
    else if (b?.channel) {
      await saveChannel(brand, String(b.channel), { account: b.account, mode: b.mode, note: b.note });
    } else {
      return NextResponse.json({ error: "нечего менять" }, { status: 400 });
    }
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 400 });
  }
  return NextResponse.json(await panelData(brand));
}
