import { NextResponse } from "next/server";
import { socialScope } from "@/lib/access";
import { factoryBrand } from "@/lib/factory";
import { SOURCES, STATUS, mondayOf, save, setSource, sourcesOf, suggest, week, write } from "@/lib/plan";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

// Контент-план проекта: смотреть — весь блок СММ, править — у кого есть право
// изменения в своём направлении. Проект берётся из выбранного направления,
// как у всего блока СММ.

export async function GET(req: Request) {
  const scope = await socialScope();
  if (!scope) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const brand = factoryBrand(scope);
  const u = new URL(req.url);
  const monday = mondayOf(u.searchParams.get("week") || new Date().toISOString().slice(0, 10));
  const [cells, sources] = await Promise.all([week(brand, monday), sourcesOf(brand)]);
  return NextResponse.json({
    brand, week: monday, cells, sources,
    sourceNames: SOURCES, statusNames: STATUS, canEdit: scope.access.canEdit,
  });
}

export async function POST(req: Request) {
  const scope = await socialScope();
  if (!scope) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  if (!scope.access.canEdit) return NextResponse.json({ error: "Только с правом изменения" }, { status: 403 });
  const brand = factoryBrand(scope);
  const b = await req.json().catch(() => ({}));
  const date = String(b.date || "");
  const slot = String(b.slot || "");
  try {
    switch (b.action) {
      case "topic": {
        const topic = String(b.topic || "").trim().slice(0, 140);
        // Своя тема — значит, свой источник, и прежний текст по чужой теме
        // больше не годится.
        await save(brand, date, slot, { topic, source: "manual", origin: "Тема вписана вручную", text: "", status: topic ? "idea" : "" });
        break;
      }
      case "text":
        await save(brand, date, slot, { text: String(b.text || ""), status: "text" });
        break;
      case "approve":
        await save(brand, date, slot, { status: "ok" });
        break;
      case "unapprove":
        await save(brand, date, slot, { status: "text" });
        break;
      case "another": {
        const around = await prisma.planSlot.findMany({ where: { brand }, select: { topic: true }, orderBy: { date: "desc" }, take: 60 });
        const idea = await suggest(brand, slot, around.map((r) => r.topic));
        await save(brand, date, slot, { ...idea, source: "brief", origin: "Идея по брифу проекта", text: "", status: "idea" });
        break;
      }
      case "write": {
        const row = await prisma.planSlot.findUnique({ where: { brand_date_slot: { brand, date, slot } } });
        if (!row?.topic) return NextResponse.json({ error: "сначала нужна тема" }, { status: 400 });
        const text = await write(brand, slot, row.topic, row.facts);
        await save(brand, date, slot, { text, status: "text" });
        break;
      }
      case "source":
        await setSource(brand, String(b.kind || ""), String(b.type || ""), b.config || {});
        break;
      default:
        return NextResponse.json({ error: "неизвестное действие" }, { status: 400 });
    }
  } catch (e: any) {
    return NextResponse.json({ error: String(e?.message || e) }, { status: 400 });
  }
  const monday = mondayOf(date || new Date().toISOString().slice(0, 10));
  return NextResponse.json({ ok: true, cells: await week(brand, monday), sources: await sourcesOf(brand) });
}
