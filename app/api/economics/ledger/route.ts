import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { currentAccess } from "@/lib/access";

export const dynamic = "force-dynamic";

const CATEGORIES = ["реклама", "зарплата", "нейросети", "сервис", "прочее", "продажи"];

export async function POST(req: Request) {
  const s = await getServerSession(authOptions);
  const access = await currentAccess();
  if (!s || !access?.canEdit) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const b = await req.json();
  const amount = Number(b.amount);
  if (!Number.isFinite(amount) || amount <= 0) {
    return NextResponse.json({ error: "Укажите сумму больше нуля" }, { status: 400 });
  }
  if (!String(b.title || "").trim()) {
    return NextResponse.json({ error: "Напишите, за что деньги" }, { status: 400 });
  }
  const date = b.date ? new Date(`${b.date}T12:00:00Z`) : new Date();
  if (Number.isNaN(date.getTime())) {
    return NextResponse.json({ error: "Дата не разобралась" }, { status: 400 });
  }
  const entry = await prisma.ledger.create({
    data: {
      kind: b.kind === "in" ? "in" : "out",
      date,
      category: CATEGORIES.includes(b.category) ? b.category : "прочее",
      title: String(b.title).trim(),
      amount,
      currency: ["USD", "THB", "EUR"].includes(b.currency) ? b.currency : "RUB",
      note: String(b.note || "").trim(),
      // Направление берём из контекста: запись всегда ложится туда, где
      // человек сейчас находится.
      projectId: access.projectId,
      byUserId: s.user.id,
    },
  });
  return NextResponse.json(entry);
}

export async function DELETE(req: Request) {
  const s = await getServerSession(authOptions);
  if (!s || s.user.role !== "OWNER") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Нет id" }, { status: 400 });
  // Записи из внешних источников удалять нечего: следующее обновление
  // принесёт их обратно. Убирать такой доход нужно в самом источнике.
  const entry = await prisma.ledger.findUnique({ where: { id } });
  if (entry && entry.source !== "руками") {
    return NextResponse.json(
      { error: "Эта запись пришла из источника — удалять её нужно там" },
      { status: 400 }
    );
  }
  await prisma.ledger.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
