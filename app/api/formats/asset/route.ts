import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { socialScope } from "@/lib/access";
import { factoryBrand } from "@/lib/factory";

export const dynamic = "force-dynamic";

// Файлы проекта: фото лица, логотип. Загрузка — с правом изменения, показ —
// всему блоку СММ своего направления.
const ROLES = ["face_medium", "face_close", "logo", "kb"];
// База знаний — несколько файлов (гайды, статьи); фото и логотип — по одному.
const MANY = ["kb"];
const KB_MIME = /^(text\/|application\/(pdf|json|msword|vnd\.openxmlformats))/;
const MAX = 6 * 1024 * 1024;

export async function POST(req: Request) {
  const scope = await socialScope();
  if (!scope?.access.canEdit) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const brand = factoryBrand(scope);
  const form = await req.formData();
  const role = String(form.get("role") || "");
  const file = form.get("file") as File | null;
  if (!ROLES.includes(role) || !file) return NextResponse.json({ error: "нужны role и file" }, { status: 400 });
  const okType = role === "kb" ? KB_MIME.test(file.type) : /^image\//.test(file.type);
  if (!okType) return NextResponse.json({ error: role === "kb" ? "нужен текст, PDF или Word" : "нужна картинка" }, { status: 400 });
  if (file.size > MAX) return NextResponse.json({ error: "файл больше 6 МБ" }, { status: 400 });
  // Одна картинка на роль: новая заменяет старую, иначе копятся дубли.
  if (!MANY.includes(role)) await prisma.projectAsset.deleteMany({ where: { brand, role } });
  const row = await prisma.projectAsset.create({
    data: { brand, role, name: file.name, mime: file.type, data: Buffer.from(await file.arrayBuffer()) },
  });
  return NextResponse.json({ ok: true, id: row.id, url: `/api/formats/asset?id=${row.id}` });
}

export async function GET(req: Request) {
  const scope = await socialScope();
  if (!scope) return new NextResponse("forbidden", { status: 403 });
  const id = new URL(req.url).searchParams.get("id") || "";
  const row = await prisma.projectAsset.findUnique({ where: { id } });
  if (!row || row.brand !== factoryBrand(scope)) return new NextResponse("not found", { status: 404 });
  return new NextResponse(row.data, { headers: { "content-type": row.mime, "cache-control": "private, max-age=3600" } });
}

export async function DELETE(req: Request) {
  const scope = await socialScope();
  if (!scope?.access.canEdit) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const id = new URL(req.url).searchParams.get("id") || "";
  await prisma.projectAsset.deleteMany({ where: { id, brand: factoryBrand(scope) } });
  return NextResponse.json({ ok: true });
}
