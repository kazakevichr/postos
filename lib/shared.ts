import { prisma } from "@/lib/prisma";
import { brandsOf } from "@/lib/brands";
import { SERVICE_KINDS, brandsOfWallet } from "@/lib/wallets";

// Общие траты → направления (решение Романа 15.10.2026: «Общие» больше не
// копятся отдельной строкой, каждое направление несёт свою долю).
//
// Трата остаётся в своей дате и сумме — делится только между направлениями:
//   · сервис из кошелька (HeyGen, роутер, ElevenLabs) — по тому, сколько
//     этого сервиса съели ролики направления за 30 дней до оплаты (замер
//     meter.py или восстановленная история). Пополнение покрывает то, что
//     уже потрачено, поэтому окно — до даты оплаты;
//   · сервис без замера по частям (OpenAI, поиск) — по числу роликов;
//   · не сервис (сервер и прочее общее) — по выручке направлений
//     (решение Романа: платит тот, кто зарабатывает).
// Не на что опереться — трата остаётся «не разнесено», а не делится поровну
// наугад.

const DONE = ["готов", "опубликован", "не принят"];
// Какая часть замера ролика относится к сервису кошелька.
const COMPONENT: Record<string, "heygen" | "router" | "voice"> = {
  heygen: "heygen", oracle_heygen: "heygen",
  router: "router", oracle_router: "router",
  eleven: "voice", oracle_eleven_zavod: "voice",
};
const WINDOW_DAYS = 30;

export type SharedItem = { title: string; rub: number; day: string; wallet: string | null };
export type Part = { title: string; amount: number; rule: string };

const minus = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) - n * 864e5).toISOString().slice(0, 10);

export async function allocateShared(items: SharedItem[], incomeByProject: Map<string, number>) {
  const projects = await prisma.project.findMany({ where: { isActive: true }, select: { id: true, name: true, brandKeys: true } });
  const projectOf = new Map<string, string>();
  for (const p of projects) for (const b of brandsOf(p)) projectOf.set(b, p.id);

  const days = items.map((i) => i.day).sort();
  const jobs = days.length
    ? await prisma.factoryJob.findMany({
        where: { date: { gte: minus(days[0], WINDOW_DAYS), lte: days[days.length - 1] }, event: { in: DONE } },
        select: { brand: true, kind: true, date: true, costDetail: true },
      })
    : [];
  const detail = (s: string) => { try { return JSON.parse(s || "{}"); } catch { return {}; } };

  const byProject = new Map<string, { amount: number; parts: Part[] }>();
  const add = (pid: string, part: Part) => {
    const b = byProject.get(pid) || { amount: 0, parts: [] };
    b.amount += part.amount;
    b.parts.push(part);
    byProject.set(pid, b);
  };
  const unallocated: Part[] = [];

  const byIncome = (allowed: string[] | null) => {
    const w = new Map<string, number>();
    incomeByProject.forEach((v, pid) => { if (v > 0 && (!allowed || allowed.includes(pid))) w.set(pid, v); });
    return w;
  };

  for (const it of items) {
    let weights = new Map<string, number>();
    let rule = "";
    if (it.wallet) {
      const users = await brandsOfWallet(it.wallet);
      const pids = Array.from(new Set(users.map((b) => projectOf.get(b)).filter(Boolean))) as string[];
      if (pids.length === 1) {
        weights.set(pids[0], 1);
        rule = "сервис одного направления";
      } else {
        const win = jobs.filter((j) => j.date > minus(it.day, WINDOW_DAYS) && j.date <= it.day && users.includes(j.brand));
        const comp = COMPONENT[it.wallet];
        if (comp) {
          for (const j of win) {
            const v = Number(detail(j.costDetail)[comp] || 0);
            const pid = projectOf.get(j.brand);
            if (v > 0 && pid) weights.set(pid, (weights.get(pid) || 0) + v);
          }
          if (weights.size) rule = `по расходу роликов на сервис за ${WINDOW_DAYS} дней`;
        }
        if (!weights.size) {
          const kinds = SERVICE_KINDS[it.wallet.replace(/^oracle_/, "")];
          for (const j of win) {
            const pid = projectOf.get(j.brand);
            if (pid && (!kinds || kinds.includes(j.kind))) weights.set(pid, (weights.get(pid) || 0) + 1);
          }
          if (weights.size) rule = `по числу роликов за ${WINDOW_DAYS} дней`;
        }
        if (!weights.size) {
          weights = byIncome(pids);
          if (weights.size) rule = "по выручке направлений";
        }
      }
    } else {
      weights = byIncome(null);
      rule = "по выручке направлений";
    }
    const total = Array.from(weights.values()).reduce((a, b) => a + b, 0);
    if (!total) {
      unallocated.push({ title: it.title, amount: Math.round(it.rub), rule: "не на что опереться: ни роликов, ни выручки" });
      continue;
    }
    weights.forEach((w, pid) => add(pid, { title: it.title, amount: Math.round((it.rub * w) / total), rule }));
  }
  return { byProject, unallocated };
}
