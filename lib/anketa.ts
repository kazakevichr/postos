import { prisma } from "@/lib/prisma";
import { BRIEFS } from "@/lib/briefs";
import { brandTitle } from "@/lib/brands";

// Анкета проекта — восемь вопросов, из которых собирается бриф.
//
// Бриф — это то, что читает модель, когда придумывает темы и пишет тексты.
// У СуперФита и MoneyBall он выверен вручную и лежит в коде (lib/briefs.ts);
// анкета его НЕ перезаписывает — иначе одно поле, заполненное наспех, сбило
// бы работающий завод. Новый проект получает бриф только из анкеты.

export type Anketa = {
  about: string; audience: string; tone: string[]; help: string;
  avoid: string; cta: string; bans: string; example: string;
};

export const EMPTY: Anketa = { about: "", audience: "", tone: [], help: "", avoid: "", cta: "", bans: "", example: "" };

export const hasCodeBrief = (brand: string) => Boolean(BRIEFS[brand]);

export async function getAnketa(brand: string): Promise<Anketa | null> {
  const row = await prisma.setting.findUnique({ where: { key: `anketa:${brand}` } });
  if (!row) return null;
  try { return { ...EMPTY, ...JSON.parse(row.value) }; } catch { return null; }
}

export async function saveAnketa(brand: string, a: Partial<Anketa>) {
  const clean: Anketa = {
    about: String(a.about || "").slice(0, 400), audience: String(a.audience || "").slice(0, 200),
    tone: (Array.isArray(a.tone) ? a.tone : []).map(String).slice(0, 5),
    help: String(a.help || "").slice(0, 200), avoid: String(a.avoid || "").slice(0, 300),
    cta: String(a.cta || "").slice(0, 200), bans: String(a.bans || "").slice(0, 300),
    example: String(a.example || "").slice(0, 300),
  };
  if (!clean.about.trim()) throw new Error("ответьте хотя бы, о чём проект");
  await prisma.setting.upsert({
    where: { key: `anketa:${brand}` },
    create: { key: `anketa:${brand}`, value: JSON.stringify(clean) },
    update: { value: JSON.stringify(clean) },
  });
  if (hasCodeBrief(brand)) return clean;

  const title = await brandTitle(brand);
  const brief = {
    intro: [
      `Ты контент-стратег проекта «${title}»: ${clean.about}.`,
      clean.audience && `Аудитория — ${clean.audience}.`,
      clean.tone.length && `Тон: ${clean.tone.join(", ")}.`,
      clean.help && `Каждый выпуск даёт зрителю: ${clean.help}.`,
    ].filter(Boolean).join(" "),
    rules: [
      (clean.avoid || clean.bans) && `Никогда: ${[clean.avoid, clean.bans].filter(Boolean).join("; ")}.`,
      clean.cta && `Финал ведёт зрителя: ${clean.cta}.`,
      "Темы не повторяются в пределах месяца, одна мысль на выпуск.",
    ].filter(Boolean).join(" "),
    hints: {},
  };
  await prisma.setting.upsert({
    where: { key: `brief:${brand}` },
    create: { key: `brief:${brand}`, value: JSON.stringify(brief) },
    update: { value: JSON.stringify(brief) },
  });
  return clean;
}
