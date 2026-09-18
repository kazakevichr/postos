import { prisma } from "@/lib/prisma";
import { notifyRoles } from "@/lib/telegram";

// Копия важного — в Телеграм.
//
// Шлём ОДИН раз на появление, а не на каждый повтор: заказ, падающий каждый
// час, иначе превращает бота в будильник, и его начинают глушить вместе со
// всем остальным. Повторы видно в самом журнале — там счётчик.
//
// Отметка pushedAt снимается при гашении: беда вернулась через неделю — это
// новость, о ней сообщаем снова.
export async function pushCritical(): Promise<number> {
  const rows = await prisma.notice.findMany({
    where: { resolvedAt: null, pushedAt: null, level: "crit" },
    orderBy: { lastAt: "asc" },
    take: 5, // больше пяти за раз — это уже не уведомление, а спам
  });
  if (!rows.length) return 0;

  for (const n of rows) {
    const roles = n.roles ? n.roles.split(",").filter(Boolean) : ["OWNER"];
    const link = n.href ? `\n\nhttps://postos.dobro-inc.com${n.href}` : "";
    await notifyRoles(roles, `🚨 <b>${n.title}</b>\n${n.body}${link}`);
    await prisma.notice.update({ where: { key: n.key }, data: { pushedAt: new Date() } });
  }
  return rows.length;
}
