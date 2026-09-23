import { NextResponse } from "next/server";
import { socialScope } from "@/lib/access";
import { MB_FORMATS, MONEYBALL, mbSchedule, scheduleLabels } from "@/lib/moneyball";
import { msk, ordersOf, refresh } from "@/lib/orders";

export const dynamic = "force-dynamic";

// Пульт завода MoneyBall одной выдачей: форматы с расписанием, заказы дня и
// московское «сейчас».
//
// Время считает сервер: у браузера свой часовой пояс, и «сегодня» в нём может
// не совпадать с московскими сутками, по которым живёт расписание.
export async function GET() {
  if (!(await socialScope())) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  // Открытая страница — тоже повод завести заказы на подошедшие слоты:
  // человек видит то же, что увидит завод, когда спросит работу.
  await refresh(MONEYBALL).catch(() => {});

  const schedule = await mbSchedule();
  const now = msk();
  const orders = await ordersOf(MONEYBALL, now.date);
  return NextResponse.json({
    brand: MONEYBALL,
    tz: "Europe/Moscow",
    now,
    formats: MB_FORMATS,
    schedule,
    labels: scheduleLabels(schedule),
    bot: "@autopostingdobro_bot",
    orders: orders.map((o) => ({
      id: o.id, at: o.at, kind: o.kind, state: o.state, topic: o.topic,
      error: o.error, seconds: o.seconds, deliverBot: o.deliverBot,
    })),
  });
}
