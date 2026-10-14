import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { socialScope } from "@/lib/access";
import { factoryBrand } from "@/lib/factory";
import { brandTitle } from "@/lib/brands";
import { getAnketa } from "@/lib/anketa";
import { HOST, addTask, cfgOf, hostRow, orderTrial } from "@/lib/engine";

export const dynamic = "force-dynamic";

// Мастер формата «Ведущий»: то, чего нет в общей ручке форматов, — проверка
// фото, проверка голоса через завод, пробный выпуск и его утверждение.

async function patch(brand: string, part: any) {
  const row = await hostRow(brand);
  if (!row) throw new Error("сначала добавьте формат «Ведущий»");
  const cfg = { ...cfgOf(row), ...part };
  await prisma.projectFormat.update({ where: { id: row.id }, data: { config: JSON.stringify(cfg) } });
  return cfg;
}

/**
 * Проверка фото ведущего моделью зрения. Отвечаем причиной, а не «не подходит»:
 * человек должен понять, что переснять. Очки разрешены (решение Романа
 * 14.10.2026) — оживление с ними работает.
 */
async function checkPhoto(data: Buffer, mime: string, w: number, h: number) {
  const issues: string[] = [];
  if (w && h && Math.min(w, h) < 720) issues.push(`мало пикселей: ${w}×${h}, нужно от 1080 по короткой стороне`);
  const key = process.env.OPENAI_API_KEY;
  if (!key) return { ok: issues.length === 0, issues, note: "проверка лица недоступна: нет ключа модели" };
  const r = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: "gpt-4o-mini", max_tokens: 300, temperature: 0,
      messages: [{
        role: "user", content: [
          { type: "text", text: "Это фото для оживления говорящей головы (липсинк). Оцени строго и ответь JSON {\"faces\":число лиц, \"frontal\":лицо смотрит в камеру, \"mouth_visible\":рот виден целиком, \"hands_on_face\":руки или предметы у лица, \"sharp\":лицо резкое, \"headroom\":над головой есть место, \"issues\":[короткие причины по-русски, что мешает оживлению]}. Очки не считаются помехой." },
          { type: "image_url", image_url: { url: `data:${mime};base64,${data.toString("base64")}` } },
        ],
      }],
    }),
  });
  const d = await r.json().catch(() => ({}));
  const text = d.choices?.[0]?.message?.content || "";
  let v: any = {};
  try { v = JSON.parse((text.match(/\{[\s\S]*\}/) || ["{}"])[0]); } catch {}
  if (v.faces !== undefined && v.faces !== 1) issues.push(v.faces === 0 ? "лицо не найдено" : `в кадре ${v.faces} лица — нужно ровно одно`);
  if (v.frontal === false) issues.push("лицо повёрнуто — нужен взгляд в камеру");
  if (v.mouth_visible === false) issues.push("рот закрыт или не виден");
  if (v.hands_on_face) issues.push("руки или предметы у лица");
  if (v.sharp === false) issues.push("лицо нерезкое");
  for (const s of v.issues || []) if (typeof s === "string" && !issues.includes(s) && issues.length < 6) issues.push(s);
  return { ok: issues.length === 0, issues, headroom: v.headroom !== false };
}

export async function GET(req: Request) {
  const scope = await socialScope();
  if (!scope) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const brand = factoryBrand(scope);
  const taskId = new URL(req.url).searchParams.get("task");
  if (taskId) {
    const t = await prisma.engineTask.findUnique({ where: { id: taskId } });
    if (!t || t.brand !== brand) return NextResponse.json({ error: "нет такой задачи" }, { status: 404 });
    const result = JSON.parse(t.result || "{}");
    // Голос проверен — его ID ложится в настройки сам: человек ничего не
    // переносит руками.
    if (t.kind === "voice" && t.state === "done" && result.voice_id) {
      const cfg = cfgOf(await hostRow(brand));
      if (cfg.voice?.id !== result.voice_id) {
        await patch(brand, { voice: { ...(cfg.voice || {}), id: result.voice_id, name: result.name || "" } });
      }
    }
    return NextResponse.json({ state: t.state, result, error: t.error });
  }
  // Пробный выпуск: последний заказ с пометкой trial и ролик, если пришёл.
  const trial = await prisma.factoryOrder.findFirst({
    where: { brand, kind: HOST, trial: true }, orderBy: { createdAt: "desc" },
  });
  const [video, sample] = await Promise.all([
    prisma.projectAsset.findFirst({ where: { brand, role: "trial_video" }, select: { id: true, at: true } }),
    prisma.projectAsset.findFirst({ where: { brand, role: "voice_sample" }, select: { id: true, at: true } }),
  ]);
  return NextResponse.json({
    trial: trial && { id: trial.id, state: trial.state, error: trial.error, topic: trial.topic, at: trial.createdAt },
    video: video && trial && video.at >= trial.createdAt ? `/api/formats/asset?id=${video.id}` : "",
    sample: sample ? `/api/formats/asset?id=${sample.id}` : "",
    status: (await hostRow(brand))?.status || "",
  });
}

export async function POST(req: Request) {
  const scope = await socialScope();
  if (!scope) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  if (!scope.access.canEdit) return NextResponse.json({ error: "Только с правом изменения" }, { status: 403 });
  const brand = factoryBrand(scope);
  const b = await req.json().catch(() => ({}));
  try {
    switch (b.action) {
      case "photo": {
        const a = await prisma.projectAsset.findUnique({ where: { id: String(b.asset || "") } });
        if (!a || a.brand !== brand) throw new Error("фото не найдено");
        const check = await checkPhoto(Buffer.from(a.data), a.mime, Number(b.w || 0), Number(b.h || 0));
        await patch(brand, { photo: { asset: a.id, check, w: b.w, h: b.h } });
        return NextResponse.json({ ok: true, check });
      }
      case "voice": {
        const ref = String(b.ref || "").trim();
        if (!ref) throw new Error("вставьте ссылку или ID голоса");
        const speed = Math.min(1.4, Math.max(0.8, Number(b.speed || 1)));
        const style = Math.min(1, Math.max(0, Number(b.style ?? 0.35)));
        const cfg = cfgOf(await hostRow(brand));
        await patch(brand, { voice: { ...(cfg.voice || {}), ref, speed, style, id: cfg.voice?.ref === ref ? cfg.voice?.id : "" } });
        const a = await getAnketa(brand);
        const title = await brandTitle(brand);
        const text = `Привет! Это ${title}. ${a?.about ? `Здесь — ${a.about}.` : ""} Подписывайся, будет интересно.`.replace(/\s+/g, " ");
        const t = await addTask(brand, "voice", { ref, speed, style, text: text.slice(0, 300) });
        return NextResponse.json({ ok: true, task: t.id });
      }
      case "trial": {
        const cfg = cfgOf(await hostRow(brand));
        if (!cfg.photo?.asset || !cfg.voice?.id) throw new Error("для пробы нужны фото и проверенный голос");
        const o = await orderTrial(brand, String(b.topic || "").slice(0, 200));
        return NextResponse.json({ ok: true, order: o.id });
      }
      case "approve": {
        const row = await hostRow(brand);
        if (!row) throw new Error("формат не добавлен");
        await prisma.projectFormat.update({ where: { id: row.id }, data: { status: "live" } });
        return NextResponse.json({ ok: true });
      }
      case "pause": {
        const row = await hostRow(brand);
        if (!row) throw new Error("формат не добавлен");
        await prisma.projectFormat.update({ where: { id: row.id }, data: { status: "ready" } });
        return NextResponse.json({ ok: true });
      }
      case "config": {
        const cfg = await patch(brand, b.config || {});
        return NextResponse.json({ ok: true, config: cfg });
      }
      default:
        throw new Error("неизвестное действие");
    }
  } catch (e: any) {
    return NextResponse.json({ error: String(e?.message || e) }, { status: 400 });
  }
}
