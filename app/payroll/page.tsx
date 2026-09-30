import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { currentAccess, allowedProjectIds } from "@/lib/access";
import { computePayroll, resolvePeriod, PeriodType } from "@/lib/economics";
import { earnings } from "@/lib/quota";
import PeriodFilter from "@/components/PeriodFilter";
import PayrollEntry from "@/components/PayrollEntry";

export default async function PayrollPage({
  searchParams,
}: {
  searchParams: { period?: string; anchor?: string };
}) {
  const session = await getServerSession(authOptions);
  if (!session) redirect("/login");
  if (session.user.role === "SMM") redirect("/factory");

  const access = await currentAccess();
  const isOwner = session.user.role === "OWNER";
  const isPartner = session.user.role === "PARTNER";
  const periodType = (isOwner && (searchParams.period as PeriodType)) || "month";
  const period = resolvePeriod(periodType, searchParams.anchor);

  let userIds: string[];
  if (isOwner || isPartner) {
    const managers = await prisma.user.findMany({
      where: {
        role: { in: ["MANAGER", "SMM"] },
        isActive: true,
        ...(access && !access.isOwner
          ? { access: { some: { projectId: { in: allowedProjectIds(access) } } } }
          : access?.projectId
            ? { access: { some: { projectId: access.projectId } } }
            : {}),
      },
    });
    userIds = managers.map((m) => m.id);
  } else {
    userIds = [session.user.id];
  }

  const payrolls = await Promise.all(userIds.map((id) => computePayroll(id, period)));
  const grandTotal = payrolls.reduce((s, p) => s + p.totalAmount, 0);

  // Начисление заводится руками и только помесячно: это то, что уходит в
  // расходы «Бухгалтерии». Посчитанное показываем рядом как подсказку —
  // у СММ она приходит из кабинета, у менеджеров из формулы выше.
  // Вносить начисления может только владелец — партнёр смотрит.
  const canEnter = isOwner && periodType === "month";
  const records = canEnter
    ? await prisma.payrollRecord.findMany({ where: { month: period.label } })
    : [];
  // Направление у зарплаты: кто работает на один проект, тот и попадает в его
  // расходы; у остальных пусто — такая зарплата остаётся общей.
  const projectList = canEnter
    ? await prisma.project.findMany({
        where: { isActive: true },
        select: { id: true, name: true },
        orderBy: { name: "asc" },
      })
    : [];
  const recordBy = new Map(records.map((r) => [r.userId, r]));
  const smmEarned = canEnter ? await earnings(period.label) : null;
  const hintFor = (userId: string, computed: number) =>
    smmEarned?.smm?.id === userId ? smmEarned.base + smmEarned.extrasEarned : computed;

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <h1 className="text-xl font-bold">Зарплата</h1>
        <PeriodFilter showTypeTabs={isOwner} />
      </div>
      <p className="text-sm text-gray-500 mb-4">Период: {period.label}</p>

      {!isOwner && payrolls.length > 0 && (
        <div className="mb-6">
          <h2 className="font-semibold mb-3">Ваши результаты по проектам</h2>
          {Object.keys(payrolls[0].breakdown).length === 0 ? (
            <p className="text-sm text-gray-400">Пока нет данных по проектам за этот период.</p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {Object.entries(payrolls[0].breakdown).map(([project, v]) => (
                <div key={project} className="card">
                  <div className="font-semibold text-brand-700">{project}</div>
                  <div className="mt-2 text-sm text-gray-500">KPI: <b className="text-gray-900">{v.kpi.toLocaleString("ru-RU")}</b></div>
                  <div className="text-sm text-gray-500">Бонус: <b className="text-gray-900">{v.bonus.toLocaleString("ru-RU")}</b></div>
                  <div className="text-sm text-gray-500">Доход по проекту: <b className="text-gray-900">{(v.kpi + v.bonus).toLocaleString("ru-RU")}</b></div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="space-y-4">
        {payrolls.length === 0 && <p className="text-sm text-gray-400">Нет данных.</p>}
        {payrolls.map((p) => (
          <div key={p.userId} className="card">
            <div className="flex justify-between items-center">
              <h3 className="font-semibold">{p.userName}</h3>
              <span className="text-lg font-bold text-brand-700">{p.totalAmount.toLocaleString("ru-RU")} ₽</span>
            </div>
            {!p.qualifiesForSalary && (
              <p className="text-xs text-amber-600 mt-1">
                Оклад и бонус начисляются от {p.minPartnersForSalary} партнёров. Сейчас партнёров: {p.partnersCount}.
              </p>
            )}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-3 text-sm">
              <div><span className="text-gray-500">Оклад: </span>{p.fixedAmount.toLocaleString("ru-RU")}</div>
              <div><span className="text-gray-500">KPI: </span>{p.kpiTotal.toLocaleString("ru-RU")}</div>
              <div><span className="text-gray-500">Бонус: </span>{p.bonusTotal.toLocaleString("ru-RU")}</div>
              <div><span className="text-gray-500">Итого: </span><b>{p.totalAmount.toLocaleString("ru-RU")}</b></div>
            </div>
            {Object.keys(p.breakdown).length > 0 && (
              <div className="mt-3 border-t pt-2 text-xs text-gray-500 space-y-1">
                {Object.entries(p.breakdown).map(([project, v]) => (
                  <div key={project} className="flex justify-between">
                    <span>{project}</span>
                    <span>KPI {v.kpi.toLocaleString("ru-RU")} · Бонус {v.bonus.toLocaleString("ru-RU")}</span>
                  </div>
                ))}
              </div>
            )}
            {canEnter && (
              <PayrollEntry
                userId={p.userId}
                month={period.label}
                computed={hintFor(p.userId, p.totalAmount)}
                projects={projectList}
                record={(() => {
                  const r = recordBy.get(p.userId);
                  return r
                    ? {
                        id: r.id,
                        totalAmount: r.totalAmount,
                        projectId: r.projectId,
                        paidAt: r.paidAt ? r.paidAt.toISOString() : null,
                      }
                    : null;
                })()}
              />
            )}
          </div>
        ))}
        {isOwner && payrolls.length > 0 && (
          <div className="card flex justify-between font-semibold">
            <span>Итого фонд оплаты за период</span>
            <span>{grandTotal.toLocaleString("ru-RU")} ₽</span>
          </div>
        )}
      </div>
    </div>
  );
}
