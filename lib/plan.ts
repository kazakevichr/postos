import { prisma } from "@/lib/prisma";
import { planSlots } from "@/lib/factory";
import { scheduleOf } from "@/lib/schedule";
import { briefOf } from "@/lib/briefs";

// Контент-план проекта: неделя клеток «дата × формат» со всем путём до ролика.
//
// Путь у любой клетки один: ИСТОЧНИК → ИДЕЯ → ТЕКСТ → РОЛИК. Источник — где
// лежит идея (у донора, в интернете, в файлах, в голове человека). Идею завод
// не копирует, а переписывает своими словами. Человек видит и тему, и текст до
// выхода и может поправить любое звено.

export const SOURCES: Record<string, string> = {
  brief: "По брифу",
  donor: "Доноры",
  search: "Поиск в интернете",
  kb: "База знаний",
  manual: "Вручную",
};

export const STATUS: Record<string, string> = {
  idea: "идея",
  text: "текст готов",
  ok: "утверждено",
  out: "вышел",
};

export type Cell = {
  date: string;
  slot: string;
  label: string;
  time: string;
  topic: string;
  facts: string;
  source: string;
  origin: string;
  text: string;
  status: string;
  account: string;
};

const iso = (d: Date) => d.toISOString().slice(0, 10);

/** Понедельник недели, в которую попадает дата. */
export function mondayOf(date: string): string {
  const d = new Date(date + "T00:00:00Z");
  const wd = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() - (wd - 1));
  return iso(d);
}

export function weekDates(monday: string): string[] {
  const d = new Date(monday + "T00:00:00Z");
  return Array.from({ length: 7 }, (_, i) => {
    const x = new Date(d);
    x.setUTCDate(d.getUTCDate() + i);
    return iso(x);
  });
}

/**
 * Неделя плана: клетки по расписанию проекта плюс всё, что уже вписано.
 *
 * Пустая клетка по расписанию показывается тоже — «здесь выйдет ролик, а темы
 * ещё нет» и есть главное, что человеку нужно увидеть в плане. Вписанное вне
 * расписания не теряется: его просто показываем как есть.
 */
export async function week(brand: string, monday: string): Promise<Cell[]> {
  return cellsFor(brand, weekDates(monday));
}

export function monthDates(month: string): string[] {
  const [y, m] = month.split("-").map(Number);
  const n = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return Array.from({ length: n }, (_, i) => `${month}-${String(i + 1).padStart(2, "0")}`);
}

export async function month(brand: string, month: string): Promise<Cell[]> {
  return cellsFor(brand, monthDates(month));
}

async function cellsFor(brand: string, dates: string[]): Promise<Cell[]> {
  const [kinds, sched, rows] = await Promise.all([
    planSlots(brand).catch(() => [] as any[]),
    scheduleOf(brand).catch(() => ({} as Record<string, any>)),
    prisma.planSlot.findMany({ where: { brand, date: { in: dates } } }),
  ]);
  const byKey = new Map(rows.map((r) => [`${r.date}|${r.slot}`, r]));
  const out: Cell[] = [];
  const seen = new Set<string>();

  for (const date of dates) {
    const wd = new Date(date + "T00:00:00Z").getUTCDay() || 7;
    for (const k of kinds as any[]) {
      if (!k.active || k.fromPlan === false) continue;
      const rule = (sched as any)[k.slot];
      const runs = rule?.slots?.filter((s: any) => (s.days || []).includes(wd)) || [];
      if (rule && rule.mode === "time" && runs.length === 0) continue;
      const key = `${date}|${k.slot}`;
      seen.add(key);
      const r = byKey.get(key);
      out.push({
        date,
        slot: k.slot,
        label: k.label || k.slot,
        time: runs[0]?.time || (k.time && k.time !== "—" ? k.time : ""),
        topic: r?.topic || "",
        facts: r?.facts || "",
        source: r?.source || "",
        origin: r?.origin || "",
        text: r?.text || "",
        status: r?.status || (r?.topic ? "idea" : ""),
        account: r?.account || "",
      });
    }
  }
  const labels = new Map((kinds as any[]).map((k) => [k.slot, k.label || k.slot]));
  for (const r of rows) {
    if (seen.has(`${r.date}|${r.slot}`)) continue;
    out.push({
      date: r.date, slot: r.slot, label: labels.get(r.slot) || r.slot, time: "",
      topic: r.topic, facts: r.facts, source: r.source, origin: r.origin,
      text: r.text, status: r.status || (r.topic ? "idea" : ""), account: r.account,
    });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time));
}

/** Записать в клетку. Клетки нет — заводится: план не требует «создать строку». */
export async function save(brand: string, date: string, slot: string, data: Partial<Cell>) {
  const clean: any = {};
  for (const k of ["topic", "facts", "source", "origin", "text", "status", "account"] as const) {
    if (data[k] !== undefined) clean[k] = String(data[k]);
  }
  return prisma.planSlot.upsert({
    where: { brand_date_slot: { brand, date, slot } },
    create: { brand, date, slot, ...clean },
    update: clean,
  });
}

export async function sourcesOf(brand: string): Promise<Record<string, { type: string; config: any }>> {
  const rows = await prisma.topicSource.findMany({ where: { brand } });
  const out: Record<string, { type: string; config: any }> = {};
  for (const r of rows) {
    let config: any = {};
    try { config = JSON.parse(r.config); } catch {}
    out[r.kind] = { type: r.type, config };
  }
  return out;
}

export async function setSource(brand: string, kind: string, type: string, config: any) {
  if (!SOURCES[type]) throw new Error("источник: brief | donor | search | kb | manual");
  const value = JSON.stringify(config || {});
  return prisma.topicSource.upsert({
    where: { brand_kind: { brand, kind } },
    create: { brand, kind, type, config: value },
    update: { type, config: value },
  });
}

// ── Модель: идея и текст ──────────────────────────────────────────────────
// Постос сам пишет идею по брифу и текст по теме: это дёшево и нужно сразу,
// пока человек смотрит план. Доноры, поиск и база знаний требуют скачать
// ролик, сходить в интернет, прочитать файлы — это работа завода, он и
// заполнит такие клетки.

const LEN: Record<string, string> = {
  avatar: "монолог на 30–45 секунд: 80–110 слов",
  make: "монолог персонажа на 20–40 секунд: 60–100 слов",
  news: "комментарий на 30–50 секунд: 80–120 слов",
  carousel: "7 слайдов, каждый с новой строки в виде «Слайд N · текст», до 12 слов на слайд",
  carousel_new: "7 слайдов, каждый с новой строки в виде «Слайд N · текст», до 10 слов на слайд",
};

async function llm(prompt: string, maxTokens = 1200): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("нет OPENAI_API_KEY");
  const r = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.8,
      max_tokens: maxTokens,
    }),
  });
  const d = await r.json();
  const out = d.choices?.[0]?.message?.content;
  if (!out) throw new Error(`модель не ответила: ${JSON.stringify(d).slice(0, 160)}`);
  return String(out);
}

/** Новая идея для клетки по брифу проекта, непохожая на соседние темы. */
export async function suggest(brand: string, slot: string, avoid: string[]) {
  const brief = await briefOf(brand);
  if (!brief) throw new Error("у проекта нет брифа — заполните анкету проекта");
  const text = await llm(`${brief.intro}
${brief.rules}
Смысл формата: ${brief.hints[slot] || slot}.
Не повторяй эти темы и не делай похожих: ${JSON.stringify(avoid.filter(Boolean).slice(0, 40))}.
Дай ОДНУ тему (topic, до 90 символов, без кавычек и хэштегов) и 2–3 конкретных тезиса для сценариста (facts, до 300 символов).
Ответ — строго JSON {"topic","facts"} без пояснений.`, 400);
  const m = text.match(/\{[\s\S]*\}/);
  const d = JSON.parse(m ? m[0] : "{}");
  if (!d.topic) throw new Error("модель не дала тему");
  return { topic: String(d.topic).slice(0, 140), facts: String(d.facts || "").slice(0, 600) };
}

/** Текст по теме: то, что завод прочитает голосом или вёрстает на слайдах. */
export async function write(brand: string, slot: string, topic: string, facts: string) {
  const brief = await briefOf(brand);
  if (!brief) throw new Error("у проекта нет брифа — заполните анкету проекта");
  const text = await llm(`${brief.intro}
${brief.rules}
Смысл формата: ${brief.hints[slot] || slot}.
Напиши текст на тему «${topic}». ${facts ? `Опирайся на тезисы: ${facts}.` : ""}
Объём: ${LEN[slot.split(":")[0]] || LEN.avatar}.
Первая фраза цепляет. Одна мысль. Пиши своими словами, живым разговорным языком.
Ответ — только сам текст, без заголовков и пояснений.`);
  return text.trim();
}
