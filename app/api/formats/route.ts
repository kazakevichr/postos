import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { socialScope } from "@/lib/access";
import { factoryBrand } from "@/lib/factory";
import { brandTitle } from "@/lib/brands";
import { CATALOG, catalogStats } from "@/lib/formatCatalog";
import { getAnketa, hasCodeBrief, saveAnketa } from "@/lib/anketa";
import { setSource } from "@/lib/plan";
import { topicWay } from "@/lib/topicsource";
import { raise } from "@/lib/notices";

export const dynamic = "force-dynamic";

// Каталог форматов для выбранного проекта: что уже работает, что добавлено и
// в каком оно состоянии, что можно добавить. Смотреть — весь блок СММ,
// добавлять и настраивать — с правом изменения.

// Что уже делают работающие заводы. Их форматы описаны их кодом и живут в
// пульте; сюда — только чтобы не предлагать добавить то, что и так работает.
const RUNNING: Record<string, string[]> = {
  superfit: ["make", "carousel", "carousel_new", "trainer", "avatar", "repost"],
  moneyball: ["news", "forecast", "recap", "make"],
};

// Что должно быть заполнено, чтобы формат считался готовым к запуску.
function readiness(kind: string, cfg: any, anketa: boolean, source: boolean) {
  const f = CATALOG.find((x) => x.kind === kind);
  const need: Record<string, boolean> = {
    brief: anketa, source,
    face: Boolean(cfg.face?.medium && cfg.face?.close) || Boolean(cfg.face?.persona),
    voice: Boolean(cfg.voice),
    schedule: Boolean(cfg.schedule?.perWeek && (cfg.schedule?.times || []).length),
  };
  const steps = (f?.steps || []).map((s) => ({ step: s, done: Boolean(need[s]) }));
  return { steps, ready: steps.every((s) => s.done) };
}

async function state(brand: string) {
  const [stats, added, anketa, assets] = await Promise.all([
    catalogStats(),
    prisma.projectFormat.findMany({ where: { brand } }),
    getAnketa(brand),
    prisma.projectAsset.findMany({ where: { brand }, select: { id: true, role: true, name: true }, orderBy: { at: "asc" } }),
  ]);
  const coded = hasCodeBrief(brand);
  const catalog = [];
  for (const f of CATALOG) {
    const row = added.find((a) => a.kind === f.kind);
    let cfg: any = {};
    try { cfg = JSON.parse(row?.config || "{}"); } catch {}
    const src = await prisma.topicSource.findUnique({ where: { brand_kind: { brand, kind: f.kind } } });
    const r = readiness(f.kind, cfg, Boolean(anketa) || coded, Boolean(src));
    catalog.push({
      ...f,
      stats: stats[f.kind] || null,
      running: (RUNNING[brand] || []).includes(f.kind),
      added: row ? { status: row.status === "live" ? "live" : r.ready ? "ready" : "setup", config: cfg, steps: r.steps } : null,
      way: row ? await topicWay(brand, f.kind) : null,
    });
  }
  const sources: Record<string, any> = {};
  for (const r of await prisma.topicSource.findMany({ where: { brand } })) {
    try { sources[r.kind] = { type: r.type, config: JSON.parse(r.config) }; } catch { sources[r.kind] = { type: r.type, config: {} }; }
  }
  return { brand, title: await brandTitle(brand), coded, anketa, assets, sources, catalog };
}

// Статус в базе — для завода: он возьмёт в работу только «ready». Формат,
// только что ставший готовым, — повод владельцу включить запуск: без
// уведомления настроенный проект молча лежал бы, пока кто-то не заглянет.
async function markReady(brand: string, s: Awaited<ReturnType<typeof state>>) {
  for (const f of s.catalog) {
    if (!f.added) continue;
    const row = await prisma.projectFormat.findUnique({ where: { brand_kind: { brand, kind: f.kind } } });
    if (!row || row.status === "live") continue;
    const next = f.added.status;
    if (row.status === next) continue;
    await prisma.projectFormat.update({ where: { id: row.id }, data: { status: next } });
    if (next === "ready") {
      await raise({
        key: `format:ready:${brand}:${f.kind}`, kind: "format", level: "info", brand,
        title: `«${s.title}»: ${f.name} настроен и ждёт запуска`,
        body: "Анкета, источник тем и расписание заполнены. Осталось включить формат на заводе и снять пробный ролик.",
        href: "/formats", actionText: "Открыть", roles: ["OWNER"],
      });
    }
  }
}

export async function GET() {
  const scope = await socialScope();
  if (!scope) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  return NextResponse.json({ ...(await state(factoryBrand(scope))), canEdit: scope.access.canEdit });
}

export async function POST(req: Request) {
  const scope = await socialScope();
  if (!scope) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  if (!scope.access.canEdit) return NextResponse.json({ error: "Только с правом изменения" }, { status: 403 });
  const brand = factoryBrand(scope);
  const b = await req.json().catch(() => ({}));
  const kind = String(b.kind || "");
  const f = CATALOG.find((x) => x.kind === kind);
  try {
    switch (b.action) {
      case "add":
        if (!f) throw new Error("нет такого формата");
        if (f.blocked) throw new Error(f.blocked);
        await prisma.projectFormat.upsert({
          where: { brand_kind: { brand, kind } },
          create: { brand, kind }, update: {},
        });
        break;
      case "config": {
        const row = await prisma.projectFormat.findUnique({ where: { brand_kind: { brand, kind } } });
        if (!row) throw new Error("сначала добавьте формат");
        let cfg: any = {};
        try { cfg = JSON.parse(row.config); } catch {}
        await prisma.projectFormat.update({
          where: { brand_kind: { brand, kind } },
          data: { config: JSON.stringify({ ...cfg, ...(b.config || {}) }) },
        });
        break;
      }
      case "anketa":
        await saveAnketa(brand, b.anketa || {});
        break;
      case "source":
        await setSource(brand, kind, String(b.type || ""), b.config || {});
        break;
      case "remove":
        await prisma.projectFormat.deleteMany({ where: { brand, kind } });
        break;
      default:
        throw new Error("неизвестное действие");
    }
  } catch (e: any) {
    return NextResponse.json({ error: String(e?.message || e) }, { status: 400 });
  }
  const now = await state(brand);
  await markReady(brand, now);
  return NextResponse.json({ ok: true, ...now });
}
