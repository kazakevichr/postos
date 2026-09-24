import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { socialScope } from "@/lib/access";
import { factoryBrand } from "@/lib/factory";
import { panelData } from "@/lib/panel";
import { createChannel, saveChannel } from "@/lib/channels";
import { setBrandBot, setFormat } from "@/lib/formats";
import { decide, orderNow, setOrders } from "@/lib/orders";

export const dynamic = "force-dynamic";

// Пульт выбранного направления: каналы, форматы, лента дня. Один вид для
// любого завода — особенности каждого разбираются в lib/panel.ts.
export async function GET() {
  const scope = await socialScope();
  if (!scope) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  return NextResponse.json(await panelData(factoryBrand(scope)));
}

// Правка из пульта: канал, формат, выдача или то, кто решает, когда
// производить. Только владелец — это настройки производства и публикации.
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
    // Разовая сборка: заказ на текущую минуту, вне расписания.
    else if (b?.now) await orderNow(brand, String(b.now));
    // Ответ на согласование текста: собираем или нет.
    else if (b?.decide) await decide(String(b.decide), b.ok === true, b.other === true);
    else if (typeof b?.brandBot === "boolean") await setBrandBot(brand, b.brandBot);
    else if (b?.newChannel) await createChannel(brand, b.newChannel);
    else if (b?.channel) {
      await saveChannel(brand, String(b.channel), {
        account: b.account, connected: b.connected, paused: b.paused, archived: b.archived,
      });
    } else if (b?.format) {
      const patch: Record<string, boolean> = {};
      for (const f of ["bot", "approval", "off"]) {
        if (typeof b[f] === "boolean") patch[f] = b[f];
      }
      if (!Object.keys(patch).length) return NextResponse.json({ error: "нечего менять в формате" }, { status: 400 });
      await setFormat(brand, String(b.format), patch);
    } else {
      return NextResponse.json({ error: "нечего менять" }, { status: 400 });
    }
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 400 });
  }
  return NextResponse.json(await panelData(brand));
}
