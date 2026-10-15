import { prisma } from "@/lib/prisma";
import { brandsOf } from "@/lib/brands";
import { brandsOfWallet, SERVICES } from "@/lib/wallets";

// Кошельки → экономика. Одна трата живёт в одном месте: подписки и
// пополнения заводятся только в кошельках, экономика их показывает.
//   · подписка ведёт ОДНУ строку в «Постоянных расходах» (RecurringCost.wallet);
//   · пополнение становится тратой в журнале денег (Ledger, source «кошелёк»).
// Правка в кошельке переписывает эти строки — руками их в экономике не ведут.

const SOURCE = "кошелёк";
const month = () => new Date(Date.now() + 3 * 3600e3).toISOString().slice(0, 7);

/** Направление Постоса (Project) по бренду. Общий кошелёк — без направления. */
async function projectOfWallet(service: string): Promise<string | null> {
  const brands = await brandsOfWallet(service);
  if (brands.length !== 1) return null;
  const rows = await prisma.project.findMany({ where: { isActive: true }, select: { id: true, name: true, brandKeys: true } });
  return rows.find((r) => brandsOf(r).includes(brands[0]))?.id || null;
}

async function titleOf(service: string): Promise<string> {
  const w = await prisma.wallet.findUnique({ where: { service }, select: { title: true } });
  return SERVICES[service]?.title || w?.title || service;
}

/** Привести «Постоянные расходы» в соответствие с подпиской кошелька. */
export async function syncSubscription(service: string) {
  const w = await prisma.wallet.findUnique({ where: { service } });
  const active = await prisma.recurringCost.findMany({ where: { wallet: service, toMonth: null } });
  const on = w?.billing === "sub" && (w.subAmount || 0) > 0 && !w.inactive;
  if (!on) {
    // Больше не подписка (или бесплатный тариф, или сервис выключен): строку
    // закрываем этим месяцем, а не удаляем — прошлые месяцы её платили.
    for (const r of active) {
      if (r.fromMonth === month()) await prisma.recurringCost.delete({ where: { id: r.id } });
      else await prisma.recurringCost.update({ where: { id: r.id }, data: { toMonth: month() } });
    }
    return;
  }
  const data = {
    title: await titleOf(service),
    amount: w!.subAmount!,
    currency: w!.subCurrency === "RUB" ? "RUB" : "USD",
    projectId: await projectOfWallet(service),
    category: "сервис",
  };
  if (active.length) {
    await prisma.recurringCost.update({ where: { id: active[0].id }, data });
    for (const r of active.slice(1)) await prisma.recurringCost.delete({ where: { id: r.id } });
  } else {
    await prisma.recurringCost.create({ data: { ...data, wallet: service, fromMonth: month() } });
  }
}

/** Пополнение кошелька — трата в журнале денег. */
export async function topupToLedger(t: {
  id: number; service: string; amount: number; at: Date; note: string; who: string;
  paid: number | null; paidCurrency: string;
}) {
  const title = `${await titleOf(t.service)}: пополнение`;
  await prisma.ledger.upsert({
    where: { source_externalId: { source: SOURCE, externalId: `topup:${t.id}` } },
    create: {
      kind: "out", date: t.at, category: "сервис", title, amount: t.paid ?? t.amount,
      currency: t.paid != null ? t.paidCurrency || "USD" : "USD",
      note: [t.note, t.who].filter(Boolean).join(" · "), projectId: await projectOfWallet(t.service),
      source: SOURCE, externalId: `topup:${t.id}`,
    },
    update: {
      amount: t.paid ?? t.amount, date: t.at, title,
      currency: t.paid != null ? t.paidCurrency || "USD" : "USD",
    },
  });
}

export async function dropTopupLedger(id: number) {
  await prisma.ledger.deleteMany({ where: { source: SOURCE, externalId: `topup:${id}` } });
}

/**
 * Следующее списание подписки. Сервис, который знает дату сам (ElevenLabs),
 * главнее; иначе — месяц от последней оплаты. Ни того ни другого — дата
 * неизвестна: её подскажет первая отметка «оплатил».
 */
export function nextPayment(w: { resetAt: Date | null; paidAt: Date | null }): Date | null {
  if (w.resetAt && +w.resetAt > Date.now() - 864e5) return w.resetAt;
  if (!w.paidAt) return null;
  const d = new Date(w.paidAt);
  while (+d < Date.now() - 864e5) d.setUTCMonth(d.getUTCMonth() + 1);
  return d;
}
