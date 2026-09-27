import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import bcrypt from "bcryptjs";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

// Обновление сотрудника владельцем: смена статуса (увольнение/восстановление)
// и/или сброс пароля. Пароль нигде не хранится и не показывается в открытом
// виде — владелец задаёт новый пароль, сотрудник входит с ним заново.
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.user.role !== "OWNER") {
    return NextResponse.json({ error: "Только руководитель может управлять сотрудниками" }, { status: 403 });
  }

  const target = await prisma.user.findUnique({ where: { id: params.id } });
  if (!target) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Некорректные данные" }, { status: 400 });

  const data: Record<string, unknown> = {};

  if (typeof body.isActive === "boolean") {
    if (target.role === "OWNER") {
      return NextResponse.json({ error: "Нельзя уволить руководителя" }, { status: 400 });
    }
    data.isActive = body.isActive;
  }

  if (typeof body.newPassword === "string") {
    if (body.newPassword.length < 6) {
      return NextResponse.json({ error: "Пароль должен быть не короче 6 символов" }, { status: 400 });
    }
    data.passwordHash = await bcrypt.hash(body.newPassword, 10);
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "Нечего обновлять" }, { status: 400 });
  }

  const user = await prisma.user.update({ where: { id: params.id }, data });

  // Уволили — автозадачи нормы («Добрать норму за …») закрываем: их заводила
  // договорённость с этим человеком, и без него они просто висят
  // просроченными. Ручные задачи не трогаем — их передаёт владелец.
  if (body.isActive === false) {
    await prisma.task.updateMany({
      where: { assignedToUserId: user.id, isDone: false, isAuto: true, source: "норма СММ" },
      data: { isDone: true },
    });
  }

  return NextResponse.json({ id: user.id, isActive: user.isActive });
}

// Полное (безвозвратное) удаление сотрудника — например, тестового аккаунта.
// В отличие от "увольнения" (isActive=false), это стирает учётную запись совсем.
// Заодно убирает всех партнёров, которые были закреплены за этим сотрудником,
// и всю их выручку/историю (каскадно по схеме БД), а также его задачи/комментарии.
export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.user.role !== "OWNER") {
    return NextResponse.json({ error: "Только руководитель может удалять сотрудников" }, { status: 403 });
  }

  const target = await prisma.user.findUnique({ where: { id: params.id } });
  if (!target) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (target.role === "OWNER") {
    return NextResponse.json({ error: "Нельзя удалить руководителя" }, { status: 400 });
  }

  await prisma.$transaction([
    prisma.task.deleteMany({ where: { assignedToUserId: params.id } }),
    prisma.comment.deleteMany({ where: { userId: params.id } }),
    prisma.stageHistory.deleteMany({ where: { changedByUserId: params.id } }),
    prisma.transaction.deleteMany({ where: { createdByUserId: params.id } }),
    prisma.partner.deleteMany({ where: { responsibleUserId: params.id } }),
    prisma.payrollRecord.deleteMany({ where: { userId: params.id } }),
    prisma.user.delete({ where: { id: params.id } }),
  ]);

  return NextResponse.json({ ok: true });
}
