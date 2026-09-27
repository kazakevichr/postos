import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { sendTo, ownerWithTg } from "@/lib/telegram";
import { CLOSE_H, CLOSE_M, REMIND_H, isWorkday, kratParts, quotaDays } from "@/lib/quota";

export const dynamic = "force-dynamic";

// Контроль нормы СММ: в 19:00 по Красноярску напоминание, в 22:30 закрытие
// дня. Повторы отсекаются отметками в Setting — деплой ничего не дублирует.
export async function POST(req: Request) {
  const need = process.env.IG_HOST_KEY;
  if (!need || req.headers.get("x-factory-key") !== need) {
    return new NextResponse("forbidden", { status: 403 });
  }
  const { date, hour, minute, weekday } = kratParts();
  if (!isWorkday(weekday)) return NextResponse.json({ skipped: "воскресенье" });

  // Норма — договорённость с конкретным человеком. Нет активного СММ — нет и
  // нормы: ни напоминаний, ни ночного «не выполнена» владельцу.
  if (!(await prisma.user.findFirst({ where: { role: "SMM", isActive: true } }))) {
    return NextResponse.json({ skipped: "нет активного СММ" });
  }

  const { rules, days } = await quotaDays(2);
  const today = days.find((d: any) => d.isToday);
  if (!today) return NextResponse.json({ skipped: "нет данных" });

  const tracked = rules.filter((r) => r.accounts.length > 0);
  const lacks = tracked
    .map((r) => ({ r, q: today.rules[r.key] }))
    .filter(({ r, q }) => q.done < r.perDay);
  const bads = tracked
    .map((r) => ({ r, q: today.rules[r.key] }))
    .filter(({ q }) => q.bad > 0);
  const met = lacks.length === 0;

  const smm = await prisma.user.findFirst({
    where: { role: "SMM", isActive: true, tgChatId: { not: null } },
  });
  const out: Record<string, any> = { date, met };

  const once = async (key: string) => {
    const row = await prisma.setting.findUnique({ where: { key } });
    if (row?.value === date) return false;
    await prisma.setting.upsert({
      where: { key }, create: { key, value: date }, update: { value: date },
    });
    return true;
  };
  const lackText = () =>
    lacks.map(({ r, q }) => `${r.label}: ${q.done}/${r.perDay}`).join("\n");

  // Нарушение договорённости: запрещённый тип в аккаунте (карусель в основном).
  if (bads.length && (await once("quota:bad"))) {
    const owner = await ownerWithTg();
    const txt = bads.map(({ r, q }) => `${r.label.split(" ·")[0]}: ${q.bad} шт.`).join("\n");
    if (owner?.tgChatId) {
      await sendTo(owner.tgChatId, `⚠️ <b>Вне договорённости: карусели в основном аккаунте</b>\n${txt}`);
    }
    out.badNotified = true;
  }

  if (hour >= REMIND_H && (hour < CLOSE_H || (hour === CLOSE_H && minute < CLOSE_M)) && !met) {
    if (await once("quota:remind") && smm?.tgChatId) {
      await sendTo(smm.tgChatId,
        `⏳ <b>Норма на сегодня ещё не закрыта</b>\n${lackText()}\n` +
        `День закрывается в ${CLOSE_H}:${String(CLOSE_M).padStart(2, "0")} по Красноярску.`);
      out.reminded = true;
    }
  }

  if (hour > CLOSE_H || (hour === CLOSE_H && minute >= CLOSE_M)) {
    if (await once("quota:close")) {
      if (met) {
        if (smm?.tgChatId) await sendTo(smm.tgChatId, `✅ Норма за ${date} закрыта. Отличная работа!`);
      } else {
        const owner = await ownerWithTg();
        if (owner?.tgChatId) {
          await sendTo(owner.tgChatId,
            `🔴 <b>Норма СММ за ${date} не выполнена</b>\n${lackText()}` +
            (smm ? `\nИсполнитель: ${smm.name}` : "\n⚠️ Нет активного СММ с привязанным Телеграмом"));
        }
        if (smm) {
          const lack = lacks.map(({ r, q }) =>
            `${r.perDay - q.done} ${r.metric === "videos" ? "видео" : "карусели"} (${r.label.split(" ·")[0]})`).join(" и ");
          await prisma.task.create({
            data: {
              assignedToUserId: smm.id,
              title: `Добрать норму за ${date}: ${lack}`,
              dueDate: new Date(Date.now() + 864e5),
              isAuto: true,
              source: "норма СММ",
            },
          });
          if (smm.tgChatId) {
            await sendTo(smm.tgChatId,
              `🔴 <b>Норма за ${date} не закрыта</b>\n${lackText()}\n` +
              `Завёл задачу на добор — дедлайн завтра. Напиши, что случилось, и предложи решение — перешлю Роману.`);
          }
        }
      }
      out.closed = true;
    }
  }
  return NextResponse.json(out);
}
