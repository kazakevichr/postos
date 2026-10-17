import { prisma } from "@/lib/prisma";

// Курсы валют ЦБ РФ на дату.
//
// Траты и доходы живут в своей валюте: HeyGen списывает в батах, подписки в
// долларах, продажи в рублях. В рубли запись переводится по курсу СВОЕГО дня,
// а не одним ручным числом на все даты: ручной курс 91 при настоящих 83.9
// (14.10.2026) завышал долларовые траты на 8%.
//
// ОДИН ЗАПРОС НА ДИАПАЗОН, а не на день. Первая версия спрашивала курс каждого
// дня отдельно, а на выходные (у ЦБ их нет) уходила ещё до восьми запросов
// назад — страница экономики с прошлым месяцем для сравнения висела минутами
// (17.10.2026). Теперь недостающие дни берутся одним XML_dynamic на валюту за
// весь диапазон, и в базу ложится КАЖДЫЙ день, выходные — курсом последнего
// рабочего: второй раз за ними никто не ходит.
//
// Сеть недоступна — считаем по ближайшему известному курсу, страница не ждёт.

export const CURRENCIES = ["RUB", "USD", "THB", "EUR"] as const;
export const SIGN: Record<string, string> = { RUB: "₽", USD: "$", THB: "฿", EUR: "€" };
const FOREIGN = ["USD", "THB", "EUR"];
const CBR_ID: Record<string, string> = { USD: "R01235", THB: "R01675", EUR: "R01239" };
const FALLBACK: Record<string, number> = { USD: 84, THB: 2.5, EUR: 94 };

const iso = (t: number) => new Date(t).toISOString().slice(0, 10);
const ru = (day: string) => `${day.slice(8, 10)}/${day.slice(5, 7)}/${day.slice(0, 4)}`;

/** Курс валюты на каждый день диапазона (выходные — последним рабочим). */
async function fetchRange(currency: string, from: string, to: string): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  // Неделя запаса назад: если диапазон начинается в выходной, нужен курс пятницы.
  const start = iso(Date.parse(`${from}T00:00:00Z`) - 7 * 864e5);
  const url = `https://www.cbr.ru/scripts/XML_dynamic.asp?date_req1=${ru(start)}&date_req2=${ru(to)}&VAL_NM_RQ=${CBR_ID[currency]}`;
  const r = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(6000) });
  if (!r.ok) return out;
  const xml = await r.text();
  const pub = new Map<string, number>();
  for (const m of xml.matchAll(/Date="(\d\d)\.(\d\d)\.(\d{4})"[^>]*>\s*<Nominal>(\d+)<\/Nominal>\s*<Value>([\d,]+)<\/Value>/g)) {
    pub.set(`${m[3]}-${m[2]}-${m[1]}`, Number(m[5].replace(",", ".")) / Number(m[4] || 1));
  }
  let last: number | undefined;
  for (let t = Date.parse(`${start}T00:00:00Z`); iso(t) <= to; t += 864e5) {
    const d = iso(t);
    if (pub.has(d)) last = pub.get(d);
    if (last != null && d >= from) out.set(d, last);
  }
  return out;
}

/** Курсы на набор дней разом: из базы, недостающие — у ЦБ одним запросом. */
export class Fx {
  private map = new Map<string, number>();

  static async load(days: string[]): Promise<Fx> {
    const fx = new Fx();
    const today = new Date(Date.now() + 3 * 3600e3).toISOString().slice(0, 10);
    // Будущий день (конец текущего месяца) — по сегодняшнему курсу.
    const want = Array.from(new Set(days.filter(Boolean).map((d) => (d > today ? today : d))));
    const rows = want.length ? await prisma.fxRate.findMany({ where: { day: { in: want } } }) : [];
    for (const r of rows) fx.map.set(`${r.day}:${r.currency}`, r.rub);

    const missing = want.filter((d) => FOREIGN.some((c) => !fx.map.has(`${d}:${c}`))).sort();
    if (missing.length) {
      const from = missing[0], to = missing[missing.length - 1];
      await Promise.all(FOREIGN.map(async (c) => {
        try {
          const got = await fetchRange(c, from, to);
          for (const [d, rub] of got) {
            fx.map.set(`${d}:${c}`, rub);
            await prisma.fxRate.upsert({
              where: { day_currency: { day: d, currency: c } },
              create: { day: d, currency: c, rub }, update: { rub },
            }).catch(() => {});
          }
        } catch {
          // ЦБ не ответил — ниже возьмём ближайший известный курс
        }
      }));
    }
    // Ближайшие известные курсы — на случай, если ЦБ молчит.
    if (want.some((d) => FOREIGN.some((c) => !fx.map.has(`${d}:${c}`)))) {
      const near = await prisma.fxRate.findMany({ orderBy: { day: "desc" }, take: 60 });
      for (const r of near) if (!fx.map.has(`${r.day}:${r.currency}`)) fx.map.set(`${r.day}:${r.currency}`, r.rub);
    }
    fx.today = today;
    return fx;
  }

  private today = "";

  rate(currency: string, day: string): number {
    if (!currency || currency === "RUB") return 1;
    const d = day > this.today && this.today ? this.today : day;
    return this.map.get(`${d}:${currency}`) ?? this.nearest(currency, d) ?? FALLBACK[currency] ?? 1;
  }

  /** Курс ближайшего известного дня. */
  private nearest(currency: string, day: string): number | undefined {
    let best: { gap: number; v: number } | undefined;
    const at = Date.parse(`${day}T00:00:00Z`);
    this.map.forEach((v, k) => {
      const [d, c] = k.split(":");
      if (c !== currency) return;
      const gap = Math.abs(Date.parse(`${d}T00:00:00Z`) - at);
      if (!best || gap < best.gap) best = { gap, v };
    });
    return best?.v;
  }

  toRub(amount: number, currency: string, day: string): number {
    return amount * this.rate(currency, day);
  }

  /** Курсы дня для показа: {USD: 83.9, THB: 2.5, EUR: 93.9}. */
  ratesOn(day: string): Record<string, number> {
    return Object.fromEntries(FOREIGN.map((c) => [c, Math.round(this.rate(c, day) * 100) / 100]));
  }
}
