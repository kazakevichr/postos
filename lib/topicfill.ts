import { prisma } from "@/lib/prisma";
import { briefOf } from "@/lib/briefs";
import { llm, month as monthCells, save, suggest, week as weekCells, type Cell } from "@/lib/plan";
import { topicWay } from "@/lib/topicsource";

// Постос сам достаёт темы из источника, выбранного у формата.
//
// Путь один: ИСТОЧНИК → ИДЕЯ → ТЕМА СВОИМИ СЛОВАМИ. У донора берём только
// мысль ролика, у поиска — свежий факт, у базы знаний — кусок файла; тему
// модель всегда формулирует заново, под анкету проекта. Готовая тема ложится
// в план, а завод берёт тему из плана — так источник, выбранный в Постосе,
// действует и на старые заводы, хоть их код ничего о нём не знает.

export type Idea = { topic: string; facts: string; source: string; origin: string };

// Источники, которые Постос отрабатывает сам. «Вручную» и «как у завода» —
// это как раз отказ Постоса заполнять.
export const POSTOS_SOURCES = ["brief", "search", "donor", "kb"];

const json = (text: string): any => {
  const m = text.match(/\{[\s\S]*\}/);
  try { return JSON.parse(m ? m[0] : "{}"); } catch { return {}; }
};

async function frame(brand: string, slot: string) {
  const brief = await briefOf(brand);
  return brief
    ? `${brief.intro}\n${brief.rules}\nСмысл формата: ${brief.hints[slot] || slot}.`
    : "Ты контент-стратег проекта в соцсетях.";
}

const ASK = (avoid: string[]) => `Не повторяй эти темы и не делай похожих: ${JSON.stringify(avoid.filter(Boolean).slice(0, 40))}.
Дай ОДНУ тему (topic, до 90 символов, без кавычек и хэштегов) и 2–3 конкретных тезиса для сценариста (facts, до 300 символов).`;

function done(d: any, source: string, origin: string): Idea {
  if (!d.topic) throw new Error("модель не дала тему");
  return {
    topic: String(d.topic).slice(0, 140),
    facts: String(d.facts || "").slice(0, 600),
    source,
    origin: origin.slice(0, 400),
  };
}

// ── Поиск в интернете ────────────────────────────────────────────────────

// Поиск — через Responses API с инструментом web_search: отдельные
// «поисковые» модели чата OpenAI сняты с производства.
async function webLlm(prompt: string): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("нет OPENAI_API_KEY");
  const r = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model: "gpt-4o-mini", tools: [{ type: "web_search" }], input: prompt, max_output_tokens: 900 }),
  });
  const d = await r.json();
  const text = (d.output || []).flatMap((o: any) => o.content || []).map((c: any) => c.text || "").join("\n");
  if (!text) throw new Error(`поиск не ответил: ${JSON.stringify(d.error || d).slice(0, 160)}`);
  return text;
}

async function fromSearch(brand: string, slot: string, avoid: string[], query: string): Promise<Idea> {
  if (!query) throw new Error("у источника «Поиск» не задан запрос");
  const out = await webLlm(`${await frame(brand, slot)}
Найди в интернете КОНКРЕТНУЮ свежую находку по запросу «${query}»: исследование, новость или открытие не старше двух месяцев, с цифрой или выводом.
Общие статьи, справочники и сайты-советчики не годятся — нужна именно новость или исследование.
Тема строится вокруг этой находки, своими словами; в facts — сама находка с цифрой и кто её сделал.
${ASK(avoid)}
Ответ — строго JSON {"topic","facts","url","what"} где url — ссылка на найденное, what — что нашёл, одной фразой.`);
  const d = json(out);
  return done(d, "search", `Нашлось в интернете: ${d.what || query}${d.url ? ` — ${d.url}` : ""}`);
}

// ── Доноры: свежие ролики YouTube-каналов ────────────────────────────────
// TikTok и Instagram ленту чужого аккаунта без авторизации не отдают, а
// YouTube отдаёт открытую RSS-ленту канала. Поэтому доноры — YouTube.

async function channelId(url: string): Promise<string> {
  const direct = url.match(/channel\/(UC[\w-]{22})/);
  if (direct) return direct[1];
  const key = `ytchan:${url}`;
  const cached = await prisma.setting.findUnique({ where: { key } });
  if (cached) return cached.value;
  const page = await fetch(url.startsWith("http") ? url : `https://www.youtube.com/${url.startsWith("@") ? url : `@${url}`}`, {
    headers: { "user-agent": "Mozilla/5.0", "accept-language": "ru,en" },
  }).then((r) => r.text());
  const id = page.match(/"externalId":"(UC[\w-]{22})"/)?.[1]
    || page.match(/channel_id=(UC[\w-]{22})/)?.[1]
    || page.match(/"channelId":"(UC[\w-]{22})"/)?.[1];
  if (!id) throw new Error(`не нашёл канал по ссылке ${url}`);
  await prisma.setting.upsert({ where: { key }, create: { key, value: id }, update: { value: id } });
  return id;
}

type Video = { id: string; title: string; about: string; at: string; channel: string };

async function feed(url: string): Promise<Video[]> {
  const id = await channelId(url);
  const xml = await fetch(`https://www.youtube.com/feeds/videos.xml?channel_id=${id}`).then((r) => r.text());
  const channel = xml.match(/<title>([^<]*)<\/title>/)?.[1] || url;
  const unxml = (s: string) => s.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
  return [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)].map((m) => ({
    id: m[1].match(/<yt:videoId>([^<]+)/)?.[1] || "",
    title: unxml(m[1].match(/<title>([^<]*)/)?.[1] || ""),
    about: unxml(m[1].match(/<media:description>([\s\S]*?)<\/media:description>/)?.[1] || "").slice(0, 800),
    at: m[1].match(/<published>([^<]+)/)?.[1] || "",
    channel: unxml(channel),
  })).filter((v) => v.id);
}

async function fromDonor(brand: string, slot: string, avoid: string[], donors: string[]): Promise<Idea> {
  const yt = donors.filter((d) => /youtu|^@|^UC/.test(d));
  if (!yt.length) throw new Error("доноры сейчас читаются только с YouTube — добавьте ссылки на YouTube-каналы");
  const videos = (await Promise.all(yt.map((u) => feed(u).catch(() => [] as Video[])))).flat()
    .sort((a, b) => b.at.localeCompare(a.at));
  if (!videos.length) throw new Error("у доноров не нашлось роликов — проверьте ссылки");
  // Один ролик донора — одна тема: уже взятые помечены в плане ссылкой.
  const used = await prisma.planSlot.findMany({ where: { brand, source: "donor" }, select: { origin: true } });
  const taken = new Set(used.flatMap((r) => r.origin.match(/youtu\.be\/([\w-]{11})/)?.[1] || []));
  // Ролик, который проекту не подходит, пропускаем и берём следующий — но
  // не бесконечно: три отказа подряд значат, что доноры не той темы.
  for (const v of videos.filter((x) => !taken.has(x.id)).slice(0, 3)) {
  const out = await llm(`${await frame(brand, slot)}
Ролик-донор с канала «${v.channel}»: «${v.title}». Описание: ${v.about || "—"}
Тема ОБЯЗАНА быть про то же, о чём ролик (тот же предмет и та же главная мысль), но сформулирована своими словами под нашего зрителя.
Подменять предмет нельзя: ролик про пептиды — тема про пептиды, не про креатин.
Если предмет ролика нашему проекту не подходит или запрещён правилами выше — ответь строго {"skip":true}.
${ASK(avoid)}
Ответ — строго JSON {"topic","facts"}.`, 500);
    const d = json(out);
    if (d.skip) continue;
    return done(d, "donor", `Идея из ролика донора «${v.channel}»: «${v.title}» — https://youtu.be/${v.id}`);
  }
  throw new Error("свежие ролики доноров не подходят проекту или уже взяты — добавьте других каналов");
}

// ── База знаний: файлы проекта ───────────────────────────────────────────

async function fromKb(brand: string, slot: string, avoid: string[]): Promise<Idea> {
  const files = await prisma.projectAsset.findMany({ where: { brand, role: "kb" } });
  if (!files.length) throw new Error("в базе знаний нет файлов — загрузите их в настройке формата");
  const f = files[Math.floor(Math.random() * files.length)];
  const head = `${await frame(brand, slot)}
Ниже — материал из базы знаний проекта (файл «${f.name}»). Найди в нём мысль, которой ещё не было в темах, и сделай из неё тему. Факты бери только из материала.
${ASK(avoid)}
Ответ — строго JSON {"topic","facts"}.`;
  let out: string;
  if (f.mime === "application/pdf") {
    const data = `data:application/pdf;base64,${Buffer.from(f.data).toString("base64")}`;
    out = await llm(head, 500, "gpt-4o-mini", [{ type: "file", file: { filename: f.name, file_data: data } }]);
  } else {
    // Берём случайный кусок: целиком длинный гайд модели не нужен, а
    // разные куски — это разные темы.
    const text = Buffer.from(f.data).toString("utf8");
    const at = Math.max(0, Math.floor(Math.random() * Math.max(1, text.length - 4000)));
    out = await llm(`${head}\n\nМатериал:\n${text.slice(at, at + 4000)}`, 500);
  }
  return done(json(out), "kb", `Из базы знаний: файл «${f.name}»`);
}

/** Идея для клетки из источника формата. */
export async function ideaFor(brand: string, slot: string, avoid: string[]): Promise<Idea> {
  const way = await topicWay(brand, slot);
  if (way.type === "search") return fromSearch(brand, slot, avoid, String(way.config.query || ""));
  if (way.type === "donor") return fromDonor(brand, slot, avoid, way.config.donors || []);
  if (way.type === "kb") return fromKb(brand, slot, avoid);
  // По анкете — и запасной путь для кнопки «Придумать» у форматов, чьи темы
  // берёт завод: человек просит идею сейчас, и отказать ему было бы странно.
  const idea = await suggest(brand, slot, avoid);
  return { ...idea, source: "brief", origin: "Идея по анкете проекта" };
}

async function recent(brand: string) {
  const rows = await prisma.planSlot.findMany({ where: { brand }, select: { topic: true }, orderBy: { date: "desc" }, take: 60 });
  return rows.map((r) => r.topic);
}

/**
 * Вписать темы в пустые клетки, у которых источник — Постос.
 *
 * Клетки «как у завода» и «вручную» не трогаем: первые заполнит завод, вторые
 * — человек. Прошедшие дни тоже: тема задним числом ничего не изменит.
 */
export async function fillEmpty(brand: string, cells: Cell[], limit = 40) {
  const today = new Date().toISOString().slice(0, 10);
  const ways = new Map<string, string>();
  const avoid = await recent(brand);
  let filled = 0;
  const errors: string[] = [];
  for (const c of cells) {
    if (filled >= limit) break;
    if (c.topic || c.date < today) continue;
    if (!ways.has(c.slot)) ways.set(c.slot, (await topicWay(brand, c.slot)).type);
    if (!POSTOS_SOURCES.includes(ways.get(c.slot)!)) continue;
    try {
      const idea = await ideaFor(brand, c.slot, avoid);
      await save(brand, c.date, c.slot, { ...idea, text: "", status: "idea" });
      avoid.unshift(idea.topic);
      filled++;
    } catch (e: any) {
      const msg = `${c.label}: ${String(e?.message || e)}`;
      if (!errors.includes(msg)) errors.push(msg);
      // Источник сломан — остальные клетки этого формата упадут так же.
      ways.set(c.slot, "broken");
    }
  }
  return { filled, errors };
}

export async function fillMonth(brand: string, m: string) {
  return fillEmpty(brand, await monthCells(brand, m));
}

/** Неделя вперёд: завод не приходит к пустой клетке, а человек видит план заранее и успевает поправить. */
export async function fillAhead(brand: string, days = 7) {
  const now = new Date();
  const monday = new Date(now);
  monday.setUTCDate(now.getUTCDate() - ((now.getUTCDay() || 7) - 1));
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const next = new Date(monday); next.setUTCDate(monday.getUTCDate() + 7);
  const cells = [...(await weekCells(brand, iso(monday))), ...(await weekCells(brand, iso(next)))];
  const until = new Date(now); until.setUTCDate(now.getUTCDate() + days);
  return fillEmpty(brand, cells.filter((c) => c.date <= iso(until)), 20);
}
