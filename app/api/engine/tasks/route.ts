import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { engineAuth, takeTasks } from "@/lib/engine";

export const dynamic = "force-dynamic";

// Служебные задачи завода: забрать новые (GET) и ответить результатом (POST).
export async function GET(req: Request) {
  if (!engineAuth(req)) return new NextResponse("forbidden", { status: 403 });
  return NextResponse.json({ tasks: await takeTasks() });
}

export async function POST(req: Request) {
  if (!engineAuth(req)) return new NextResponse("forbidden", { status: 403 });
  const b = await req.json().catch(() => ({}));
  const id = String(b.id || "");
  const row = await prisma.engineTask.findUnique({ where: { id } });
  if (!row) return NextResponse.json({ error: "нет такой задачи" }, { status: 404 });
  await prisma.engineTask.update({
    where: { id },
    data: {
      state: b.ok ? "done" : "fail", doneAt: new Date(),
      result: JSON.stringify(b.result || {}), error: String(b.error || "").slice(0, 500),
    },
  });
  return NextResponse.json({ ok: true });
}
