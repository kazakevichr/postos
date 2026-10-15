import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { currentAccess } from "@/lib/access";
import { isMonth } from "@/lib/ledger";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const access = await currentAccess();
  if (!access?.canEdit) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const b = await req.json();
  const amount = Number(b.amount);
  if (!Number.isFinite(amount) || amount <= 0) {
    return NextResponse.json({ error: "Укажите сумму больше нуля" }, { status: 400 });
  }
  if (!String(b.title || "").trim()) {
    return NextResponse.json({ error: "Напишите, за что платим" }, { status: 400 });
  }
  const fromMonth = isMonth(b.fromMonth) ? b.fromMonth : new Date().toISOString().slice(0, 7);
  const cost = await prisma.recurringCost.create({
    data: {
      title: String(b.title).trim(),
      category: String(b.category || "сервис"),
      amount,
      currency: b.currency === "USD" ? "USD" : "RUB",
      fromMonth,
      toMonth: isMonth(b.toMonth) ? b.toMonth : null,
      projectId: access.projectId,
    },
  });
  return NextResponse.json(cost);
}

// Платёж не удаляем, а закрываем месяцем — иначе прошлые периоды потеряют
// расход, который в них действительно был.
export async function PATCH(req: Request) {
  const access = await currentAccess();
  if (!access?.canEdit) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const b = await req.json();
  if (!b.id) return NextResponse.json({ error: "Нет id" }, { status: 400 });
  const row = await prisma.recurringCost.findUnique({ where: { id: b.id }, select: { wallet: true } });
  if (row?.wallet) {
    return NextResponse.json({ error: "Эта подписка ведётся в кошельке — отключите её там" }, { status: 400 });
  }
  const toMonth = isMonth(b.toMonth) ? b.toMonth : null;
  const cost = await prisma.recurringCost.update({
    where: { id: b.id },
    data: { toMonth },
  });
  return NextResponse.json(cost);
}
