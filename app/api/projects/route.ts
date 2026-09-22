import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

// Новое направление.
//
// Раньше направления заводились только сидом, и новому проекту — заводу
// MoneyBall — негде было появиться в переключателе: без направления нельзя
// выбрать его завод, а значит, увидеть план, журнал и расписание. Заводится
// с настройками по умолчанию, остальное правится в той же форме, что у всех.
export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "OWNER") {
    return NextResponse.json({ error: "Направления заводит владелец" }, { status: 403 });
  }
  const b = await req.json().catch(() => null);
  const name = String(b?.name || "").trim();
  if (!name) return NextResponse.json({ error: "Нужно название" }, { status: 400 });
  if (name.length > 60) return NextResponse.json({ error: "Название длиннее 60 знаков" }, { status: 400 });

  // Два направления с одним именем не различить в переключателе, а бренды
  // выводятся из названия — у двойника они совпали бы целиком.
  const names = await prisma.project.findMany({ select: { name: true } });
  if (names.some((p) => p.name.trim().toLowerCase() === name.toLowerCase())) {
    return NextResponse.json({ error: "Такое направление уже есть" }, { status: 400 });
  }

  const project = await prisma.project.create({ data: { name } });
  return NextResponse.json(project);
}
