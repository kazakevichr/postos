import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { fillAhead } from "@/lib/topicfill";

export const dynamic = "force-dynamic";

// Плановое заполнение: у форматов, чей источник тем — Постос, ближайшие дни
// не должны стоять пустыми, когда завод придёт за темой. Зовётся расписанием
// из instrumentation.
export async function POST(req: Request) {
  const need = process.env.IG_HOST_KEY;
  if (need && req.headers.get("x-factory-key") !== need) {
    return new NextResponse("forbidden", { status: 403 });
  }
  const brands = new Set<string>();
  for (const r of await prisma.topicSource.findMany({ select: { brand: true } })) brands.add(r.brand);
  for (const r of await prisma.projectFormat.findMany({ select: { brand: true } })) brands.add(r.brand);
  const out: Record<string, any> = {};
  for (const b of brands) out[b] = await fillAhead(b).catch((e) => ({ error: String(e?.message || e) }));
  return NextResponse.json({ ok: true, brands: out });
}
