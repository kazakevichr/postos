import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { engineAuth } from "@/lib/engine";

export const dynamic = "force-dynamic";

// Файлы проекта для завода: забрать фото ведущего и логотип (GET), положить
// пробную фразу голоса и пробный ролик (POST). Роли, которые кладёт завод,
// перечислены явно — чужие файлы проекта он не перезаписывает.
const PUT_ROLES = ["voice_sample", "trial_video"];

export async function GET(req: Request) {
  if (!engineAuth(req)) return new NextResponse("forbidden", { status: 403 });
  const id = new URL(req.url).searchParams.get("id") || "";
  const row = await prisma.projectAsset.findUnique({ where: { id } });
  if (!row) return new NextResponse("not found", { status: 404 });
  return new NextResponse(row.data, { headers: { "content-type": row.mime } });
}

export async function POST(req: Request) {
  if (!engineAuth(req)) return new NextResponse("forbidden", { status: 403 });
  const form = await req.formData();
  const brand = String(form.get("brand") || "");
  const role = String(form.get("role") || "");
  const file = form.get("file") as File | null;
  if (!brand || !PUT_ROLES.includes(role) || !file) {
    return NextResponse.json({ error: "нужны brand, role и file" }, { status: 400 });
  }
  // Держим по одному файлу роли на проект: новая проба заменяет старую, иначе
  // база пухнет мегабайтами пробных роликов.
  await prisma.projectAsset.deleteMany({ where: { brand, role } });
  const row = await prisma.projectAsset.create({
    data: { brand, role, name: file.name, mime: file.type || "application/octet-stream", data: Buffer.from(await file.arrayBuffer()) },
  });
  return NextResponse.json({ ok: true, id: row.id });
}
