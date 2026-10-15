import { prisma } from "@/lib/prisma";

// Курсы валют ЦБ РФ на дату (cbr-xml-daily.ru — зеркало ЦБ в JSON).
//
// Траты и доходы живут в своей валюте: HeyGen списывает в батах, подписки в
// долларах, продажи в рублях. В рубли запись переводится по курсу СВОЕГО дня,
// а не одним ручным числом на все даты: ручной курс 91 при настоящих 83.9
// (14.10.2026) завышал долларовые траты на 8%.
//
// Курс дня запоминается в FxRate и больше не запрашивается. В выходные ЦБ не
// публикует курс — берём последний опубликованный до этой даты.

export const CURRENCIES = ["RUB", "USD", "THB", "EUR"] as const;
export const SIGN: Record<string, string> = { RUB: "₽", USD: "$", THB: "฿", EUR: "€" };
const FOREIGN = ["USD", "THB", "EUR"];
const FALLBACK: Record<string, number> = { USD: 84, THB: 2.5, EUR: 94 };

async function fetchCbr(day: string): Promise<Record<string, number> | null> {
  const d = new Date(`${day}T12:00:00Z`);
  // Сегодняшний курс ЦБ лежит не в архиве, а в daily_json.js.
  const today = new Date(Date.now() + 3 * 3600e3).toISOString().slice(0, 10);
  for (let back = 0; back < 8; back++) {
    const x = new Date(d.getTime() - back * 864e5);
    const ymd = x.toISOString().slice(0, 10);
    const url = ymd >= today
      ? "https://www.cbr-xml-daily.ru/daily_json.js"
      : `https://www.cbr-xml-daily.ru/archive/${ymd.slice(0, 4)}/${ymd.slice(5, 7)}/${ymd.slice(8, 10)}/daily_json.js`;
    try {
      const r = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(8000) });
      if (!r.ok) continue;
      const v = (await r.json())?.Valute || {};
      const out: Record<string, number> = {};
      for (const c of FOREIGN) if (v[c]) out[c] = Number(v[c].Value) / Number(v[c].Nominal || 1);
      if (Object.keys(out).length) return out;
    } catch {
      // сеть моргнула — пробуем день раньше, потом запасной курс
    }
  }
  return null;
}

/** Курсы на набор дней разом: из базы, недостающие — у ЦБ. */
export class Fx {
  private map = new Map<string, number>();

  static async load(days: string[]): Promise<Fx> {
    const fx = new Fx();
    const uniq = Array.from(new Set(days.filter(Boolean)));
    const rows = uniq.length ? await prisma.fxRate.findMany({ where: { day: { in: uniq } } }) : [];
    for (const r of rows) fx.map.set(`${r.day}:${r.currency}`, r.rub);
    const today = new Date(Date.now() + 3 * 3600e3).toISOString().slice(0, 10);
    for (const day of uniq) {
      if (FOREIGN.every((c) => fx.map.has(`${day}:${c}`))) continue;
      const got = await fetchCbr(day > today ? today : day);
      if (!got) continue;
      for (const [c, rub] of Object.entries(got)) {
        fx.map.set(`${day}:${c}`, rub);
        // Курс будущего дня не сохраняем: его ещё нет, взят сегодняшний.
        if (day <= today) {
          await prisma.fxRate.upsert({
            where: { day_currency: { day, currency: c } },
            create: { day, currency: c, rub }, update: { rub },
          }).catch(() => {});
        }
      }
    }
    return fx;
  }

  rate(currency: string, day: string): number {
    if (!currency || currency === "RUB") return 1;
    return this.map.get(`${day}:${currency}`) ?? this.nearest(currency, day) ?? FALLBACK[currency] ?? 1;
  }

  /** Курс ближайшего известного дня — если ЦБ недоступен. */
  private nearest(currency: string, day: string): number | undefined {
    let best: [string, number] | undefined;
    this.map.forEach((v, k) => {
      const [d, c] = k.split(":");
      if (c === currency && (!best || Math.abs(+new Date(d) - +new Date(day)) < Math.abs(+new Date(best[0]) - +new Date(day)))) best = [d, v];
    });
    return best?.[1];
  }

  toRub(amount: number, currency: string, day: string): number {
    return amount * this.rate(currency, day);
  }

  /** Курсы дня для показа: {USD: 83.9, THB: 2.5, EUR: 93.9}. */
  ratesOn(day: string): Record<string, number> {
    return Object.fromEntries(FOREIGN.map((c) => [c, Math.round(this.rate(c, day) * 100) / 100]));
  }
}
