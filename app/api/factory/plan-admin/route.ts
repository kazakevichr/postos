import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { socialScope } from "@/lib/access";

export const dynamic = "force-dynamic";

import { DEFAULT_BRAND, factoryBrand, planSlots } from "@/lib/factory";
import { MONEYBALL } from "@/lib/moneyball";
import { scheduleOf } from "@/lib/schedule";

async function owner() {
  const session = await getServerSession(authOptions);
  return session && session.user.role === "OWNER";
}

// План может смотреть весь блок СММ, включая партнёра; править и
// генерировать — только владелец. Заодно рамки говорят, чей это завод:
// у Оракла и СуперФита планы разные.

const DAY_NAMES = ["пн", "вт", "ср", "чт", "пт", "сб", "вс"];
const weekday = (date: string) => {
  const d = new Date(date + "T00:00:00Z").getUTCDay();
  return d === 0 ? 7 : d;
};

/**
 * Бриф завода: чем он вообще занимается и что можно писать.
 *
 * Тексты списаны с самих заводов (brands/<бренд>/brand.json → content_plan,
 * forbidden). Генерация без брифа — это фитнес-темы в спортивной аналитике,
 * поэтому завод без брифа получает отказ, а не общие слова.
 */
const BRIEFS: Record<string, { intro: string; rules: string; hints: Record<string, string> }> = {
  [DEFAULT_BRAND]: {
    intro: "Ты контент-стратег фитнес-бренда SUPERFIT24 (приложение с тренировками и питанием, аудитория — русскоязычные новички и любители). Составь темы контента.",
    rules: "Темы не должны повторяться в рамках месяца, чередуй направления: тренировки, питание, БАДы, мотивация, разбор ошибок, мифы.",
    hints: {
      make: "мультяшный ролик с персонажем; тема СТРОГО из тематик четырёх гайдов Базы знаний: БАДы (креатин, омега-3, витамин D, магний, протеин), тренировки для новичка (техника, разминка, восстановление, прогрессия), гормоны (кортизол, инсулин, щитовидка, сон), анализы (ферритин, дефициты, чек-ап). Темы вне этих четырёх зон запрещены",
      carousel: "питание для похудения: готовый рацион на день или неделю с КБЖУ, меню при дефиците калорий («Рацион на день: 1500 ккал с КБЖУ», «Меню на неделю без срывов»). Только рационы/меню с конкретными калориями — НЕ тренировки",
      "trainer:female": "тренировка на конкретную мышечную группу для женщин — тема СТРОГО в формате «тренировка на <группу>» (ягодицы, пресс, спина, ноги, плечи, руки, грудь, всё тело), Тренер собирает ролик из справочника упражнений по этой группе",
      "trainer:male": "тренировка на конкретную мышечную группу для мужчин — тема СТРОГО в формате «тренировка на <группу>» (грудь, спина, ноги, плечи, руки, пресс, всё тело), ролик собирается из справочника упражнений",
      carousel_new: "фотореалистичная карусель про домашние тренировки и полезные привычки: конкретная практика («5 упражнений на утро без инвентаря», «Разминка за 3 минуты») — без рационов, это зона обычной Карусели",
      avatar: "ролик с ИИ-аватаром: экспертная подача — разбор мифа, ответ на частый вопрос новичка, короткий ликбез по тренировкам/питанию/добавкам",
    },
  },
  [MONEYBALL]: {
    intro: "Ты контент-стратег MONEYBALL — спортивной аналитики на цифрах. Персонаж ролика — аналитик, который любит не команды, а таблицы: посмотрел двести матчей, свёл их в таблицу и нашёл там то, чего не заметили комментаторы. Аудитория — болельщики 18–45, которые смотрят спорт и любят разбираться. Составь темы контента.",
    rules: [
      "НЕЛЬЗЯ: призывать делать ставки, называть коэффициенты, упоминать букмекеров, обещать заработок и «беспроигрышные» стратегии, подавать вероятность как совет.",
      "Продукт не рекламируем: ни призыва установить, ни адреса сайта — бренд живёт надписью на футболке персонажа.",
      "Тема — это вопрос к цифрам, у которого есть проверяемый ответ: «так происходит в семи случаях из десяти», а не мнение.",
      "Рубрика задана днём недели (поле day). Вид спорта не повторяется два дня подряд, имя спортсмена — не чаще раза в две недели, разрез по базе матчей — не чаще раза в месяц.",
    ].join(" "),
    hints: {
      make: "ролик с персонажем-аналитиком, рубрика по дню недели: пн — проверка народной мудрости цифрами из базы матчей («дома играть легче?»); вт — звезда и её цифры; ср — как аналитика изменила спорт; чт — числа недели (что показала база за 7 дней); пт — миф против таблицы. Запасные рубрики: событие через статистику, парадокс",
    },
  },
};

function monthDates(month: string): string[] {
  const [y, m] = month.split("-").map(Number);
  const days = new Date(y, m, 0).getDate();
  return Array.from({ length: days }, (_, i) => `${month}-${String(i + 1).padStart(2, "0")}`);
}

export async function GET(req: Request) {
  const scope = await socialScope();
  if (!scope) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const brand = factoryBrand(scope);
  const month = new URL(req.url).searchParams.get("month") || new Date().toISOString().slice(0, 7);
  const rows = await prisma.planSlot.findMany({
    where: { brand, date: { startsWith: month } },
  });
  return NextResponse.json({
    month, brand, slots: await planSlots(brand), dates: monthDates(month), plan: rows,
  });
}

export async function PUT(req: Request) {
  if (!(await owner())) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const scope = await socialScope();
  if (!scope) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const brand = factoryBrand(scope);
  const b = await req.json();
  if (!b?.date || !b?.slot) return NextResponse.json({ error: "date+slot required" }, { status: 400 });
  const fields = { topic: String(b.topic ?? ""), facts: String(b.facts ?? "") };
  const row = await prisma.planSlot.upsert({
    where: { brand_date_slot: { brand, date: b.date, slot: b.slot } },
    create: { brand, date: b.date, slot: b.slot, ...fields },
    update: fields,
  });
  return NextResponse.json(row);
}

// Генерация тем на месяц: LLM заполняет ТОЛЬКО пустые ячейки активных слотов.
export async function POST(req: Request) {
  if (!(await owner())) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const scope = await socialScope();
  if (!scope) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const brand = factoryBrand(scope);
  // Бриф завода. Он и отвечает на вопрос «а можно ли вообще генерировать»:
  // без брифа модель напишет фитнес-темы любому заводу, а это хуже отказа.
  const brief = BRIEFS[brand];
  if (!brief) {
    return NextResponse.json(
      { error: "у этого завода нет брифа для генерации — темы вносятся вручную" },
      { status: 400 }
    );
  }
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return NextResponse.json({ error: "нет OPENAI_API_KEY" }, { status: 500 });
  const b = await req.json().catch(() => ({}));
  const month = b.month || new Date().toISOString().slice(0, 7);

  const existing = await prisma.planSlot.findMany({
    where: { brand, date: { startsWith: month } },
  });
  const filled = new Set(existing.filter((r) => r.topic.trim()).map((r) => `${r.date}|${r.slot}`));
  const need: { date: string; slot: string; day: string }[] = [];
  const slots = await planSlots(brand);
  const sched = await scheduleOf(brand);
  for (const date of monthDates(month)) {
    const wd = weekday(date);
    for (const s of slots.filter((s) => s.active && (s as any).fromPlan !== false)) {
      // Только те дни, когда формат действительно запускается: Персонаж
      // MoneyBall выходит раз в неделю, и тема на остальные тридцать дней —
      // это тридцать строк мусора в плане и лишние деньги за генерацию.
      const runs = sched[s.slot];
      if (runs && runs.mode === "time" && !runs.slots.some((r) => r.days.includes(wd))) continue;
      if (!filled.has(`${date}|${s.slot}`)) need.push({ date, slot: s.slot, day: DAY_NAMES[wd - 1] });
    }
  }
  if (!need.length) return NextResponse.json({ generated: 0, note: "свободных ячеек нет" });

  const prompt = `${brief.intro}
Для каждой строки входа дай тему (topic, до 90 символов, без кавычек и хэштегов) и 2-3 конкретных факта/тезиса для сценариста (facts, до 300 символов).
${brief.rules}
Смыслы слотов: ${JSON.stringify(brief.hints)}.
Вход (date, slot, day — день недели): ${JSON.stringify(need)}.
Ответ — строго JSON-массив объектов {"date","slot","topic","facts"} без пояснений.`;

  const r = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.8,
      max_tokens: 8000,
    }),
  });
  const d = await r.json();
  const text: string = d.choices?.[0]?.message?.content || "[]";
  const m = text.match(/\[[\s\S]*\]/);
  let items: any[] = [];
  try {
    items = JSON.parse(m ? m[0] : "[]");
  } catch {
    return NextResponse.json({ error: "LLM вернул не-JSON", raw: text.slice(0, 300) }, { status: 502 });
  }

  let generated = 0;
  for (const it of items) {
    if (!it?.date || !it?.slot || !it?.topic) continue;
    if (filled.has(`${it.date}|${it.slot}`)) continue;
    await prisma.planSlot.upsert({
      where: { brand_date_slot: { brand, date: it.date, slot: it.slot } },
      create: { brand, date: it.date, slot: it.slot, topic: String(it.topic), facts: String(it.facts || "") },
      update: { topic: String(it.topic), facts: String(it.facts || "") },
    });
    generated++;
  }
  return NextResponse.json({ generated });
}
