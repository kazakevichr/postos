import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { engineAuth } from "@/lib/engine";
import { publishFor } from "@/lib/publish";

export const dynamic = "force-dynamic";

// Публикация ролика нового завода. Бренд — из заказа (order_id), площадки —
// из блока «Аккаунты» этого проекта. Пробный выпуск сюда не приходит: он
// только для просмотра в мастере.

export async function POST(req: Request) {
  if (!engineAuth(req)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const form = await req.formData();
  const order = await prisma.factoryOrder.findUnique({ where: { id: String(form.get("order_id") || "") } });
  if (!order) return NextResponse.json({ error: "заказ не найден" }, { status: 404 });
  if (order.trial) return NextResponse.json({ error: "пробный выпуск не публикуется" }, { status: 400 });
  const video = form.get("video") as File | null;
  const coverRaw = form.get("cover");
  const cover = coverRaw && typeof coverRaw !== "string" ? (coverRaw as File) : null;
  if (!video) return NextResponse.json({ error: "нет video" }, { status: 400 });
  try {
    const r = await publishFor(order.brand, {
      video, photos: [], cover, caption: String(form.get("caption") || ""),
      title: String(form.get("title") || ""), kind: order.kind,
    });
    return NextResponse.json({ ok: true, ...r });
  } catch (e: any) {
    return NextResponse.json({ error: String(e?.message || e) }, { status: 502 });
  }
}
