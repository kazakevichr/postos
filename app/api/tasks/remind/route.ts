import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { sendTo, ownerWithTg } from "@/lib/telegram";

export const dynamic = "force-dynamic";

// Утренние напоминания по задачам. Дёргает instrumentation по расписанию —
// через HTTP, а не импортом: lib/telegram тянет node:crypto, который ломает
// edge-сборку instrumentation (та же история, что с lib/oracle и node:fs).
export async function POST(req: Request) {
  const need = process.env.IG_HOST_KEY;
  if (!need || req.headers.get("x-factory-key") !== need) {
    return new NextResponse("forbidden", { status: 403 });
  }
  // Защита от повтора: отметка о рассылке живёт в базе, а не в памяти
  // процесса. Раньше при каждом деплое контейнер стартовал с чистой памятью
  // и в течение того же девятого часа присылал напоминания заново.
  const day = new Date().toISOString().slice(0, 10);
  const force = new URL(req.url).searchParams.get("force") === "1";
  const stamp = await prisma.setting.findUnique({ where: { key: "tasks:remind" } });
  if (!force && stamp?.value === day) {
    return NextResponse.json({ skipped: "уже рассылали сегодня", day });
  }
  await prisma.setting.upsert({
    where: { key: "tasks:remind" },
    create: { key: "tasks:remind", value: day },
    update: { value: day },
  });

  const endOfToday = new Date();
  endOfToday.setUTCHours(23, 59, 59, 999);
  // Задачи уволенных не напоминаем ни им, ни владельцу. Раньше рассылка
  // шла мимо статуса: уволенной СММ каждое утро приходили её «Добрать норму»,
  // а владелец получал их же списком просроченных (27.09.2026).
  const tasks = await prisma.task.findMany({
    where: { isDone: false, dueDate: { lte: endOfToday }, assignedTo: { isActive: true } },
    include: { assignedTo: true },
  });
  const now = new Date();
  const overdue: string[] = [];
  for (const t of tasks) {
    const late = t.dueDate! < now;
    const line = `${late ? "🔴 просрочено" : "🟡 дедлайн сегодня"}: ${t.title}`;
    if (t.assignedTo.tgChatId) await sendTo(t.assignedTo.tgChatId, `⏰ ${line}`);
    if (late) overdue.push(`${t.title} — ${t.assignedTo.name}`);
  }
  const owner = await ownerWithTg();
  if (owner?.tgChatId && overdue.length) {
    await sendTo(owner.tgChatId, `🔴 <b>Просроченные задачи (${overdue.length})</b>\n` + overdue.join("\n"));
  }
  return NextResponse.json({ day, reminded: tasks.length, overdue: overdue.length });
}
