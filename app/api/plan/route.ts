import { NextResponse } from "next/server";
import { socialScope } from "@/lib/access";
import { factoryBrand } from "@/lib/factory";
import { SOURCES, STATUS, mondayOf, month, save, setSource, sourcesOf, week, write } from "@/lib/plan";
import { fillMonth, ideaFor } from "@/lib/topicfill";
import { panelData } from "@/lib/panel";
import { topicWays } from "@/lib/topicsource";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

// Контент-план проекта: смотреть — весь блок СММ, править — у кого есть право
// изменения в своём направлении. Проект берётся из выбранного направления,
// как у всего блока СММ.

// Куда выходит каждый формат — чтобы план можно было смотреть по одному
// аккаунту. Правда та же, что у пульта: включённые маршруты «формат → канал».
async function routesOf(brand: string) {
  try {
    const d: any = await panelData(brand);
    const channels = (d.channels || []).map((c: any) => ({ key: c.key, title: c.title, account: c.account, net: c.net }));
    const byKind: Record<string, string[]> = {};
    for (const g of d.groups || []) {
      for (const f of g.formats || []) byKind[f.kind] = (f.routes || []).filter((r: any) => r.on).map((r: any) => r.ch);
    }
    return { channels, byKind };
  } catch {
    return { channels: [], byKind: {} };
  }
}

export async function GET(req: Request) {
  const scope = await socialScope();
  if (!scope) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const brand = factoryBrand(scope);
  const u = new URL(req.url);
  const m = u.searchParams.get("month");
  const monday = mondayOf(u.searchParams.get("week") || new Date().toISOString().slice(0, 10));
  const cells = m ? await month(brand, m) : await week(brand, monday);
  // Откуда каждый формат берёт темы — правда завода: пустая клетка говорит,
  // чем её заполнят, а не выдумывает «по брифу».
  const ways = await topicWays(brand, [...new Set(cells.map((c) => c.slot))]);
  return NextResponse.json({
    brand, week: monday, month: m || "", cells, sources: await sourcesOf(brand), ways,
    sourceNames: SOURCES, statusNames: STATUS, canEdit: scope.access.canEdit,
    isOwner: scope.access.isOwner, routes: await routesOf(brand),
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
        const idea = await ideaFor(brand, slot, around.map((r) => r.topic));
        await save(brand, date, slot, { ...idea, text: "", status: "idea" });
        break;
      }
      case "fill": {
        const m = String(b.month || new Date().toISOString().slice(0, 7));
        const r = await fillMonth(brand, m);
        const cells = await month(brand, m);
        return NextResponse.json({ ok: true, ...r, cells, ways: await topicWays(brand, [...new Set(cells.map((c) => c.slot))]) });
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
  const cells = await week(brand, monday);
  return NextResponse.json({ ok: true, cells, sources: await sourcesOf(brand),
    ways: await topicWays(brand, [...new Set(cells.map((c) => c.slot))]) });
}
