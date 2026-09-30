import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { currentAccess, allowedProjectIds } from "@/lib/access";
import { computePayroll, isPartnerActive } from "@/lib/economics";
import Link from "next/link";

function currentMonth() {
  return new Date().toISOString().slice(0, 7);
}

export default async function DashboardPage() {
  const access = await currentAccess();
  if (!access) redirect("/login");
  // Сводка по направлениям. Менеджер живёт на «Зарплате», СММ — в Контент-заводе.
  if (access.role === "SMM") redirect("/factory");
  if (access.role === "MANAGER") redirect("/payroll");

  const projects = await prisma.project.findMany({
    where: { isActive: true, id: { in: allowedProjectIds(access) } },
    include: { partners: { include: { transactions: true } } },
    orderBy: { createdAt: "asc" },
  });

  const month = currentMonth();
  const [start, end] = [new Date(month + "-01T00:00:00Z"), new Date()];

  // Сотрудники направления: у владельца в сводном режиме — вся команда.
  const managers = await prisma.user.findMany({
    where: {
      role: { in: ["MANAGER", "SMM"] },
      isActive: true,
      ...(access.projectId
        ? { access: { some: { projectId: access.projectId } } }
        : access.isOwner
          ? {}
          : { access: { some: { projectId: { in: allowedProjectIds(access) } } } }),
    },
    include: { partners: true },
  });
  const payrolls = await Promise.all(managers.map((m) => computePayroll(m.id, month)));

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-xl font-bold mb-1">Дашборд</h1>
        <p className="text-sm text-gray-500">Сводка по проектам и сотрудникам · {month}</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {projects.map((p) => {
          const activePartners = p.partners.filter(isPartnerActive);
          const monthProfit = p.partners
            .flatMap((x) => x.transactions)
            .filter((t) => t.date >= start && t.date <= end)
            .reduce((s, t) => s + t.ownerProfitAmount, 0);
          const conversion = p.partners.length
            ? Math.round((activePartners.length / p.partners.length) * 100)
            : 0;
          return (
            <Link key={p.id} href={`/projects/${p.id}`} className="card hover:shadow-md transition-shadow">
              <div className="font-semibold text-brand-700">{p.name}</div>
              <div className="mt-2 text-sm text-gray-500">Партнёров: <b className="text-gray-900">{p.partners.length}</b></div>
              <div className="text-sm text-gray-500">Активных: <b className="text-gray-900">{activePartners.length}</b></div>
              <div className="text-sm text-gray-500">Доход за месяц: <b className="text-gray-900">{monthProfit.toLocaleString("ru-RU")} {p.currency}</b></div>
              <div className="text-sm text-gray-500">Конверсия: <b className="text-gray-900">{conversion}%</b></div>
            </Link>
          );
        })}
      </div>

      {managers.length > 0 && (
        <div>
          <h2 className="font-semibold mb-3">Сотрудники</h2>
          <div className="card overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-gray-500 border-b">
                  <th className="py-2 pr-4">Сотрудник</th>
                  <th className="py-2 pr-4">Партнёров</th>
                  <th className="py-2 pr-4">Активных</th>
                  <th className="py-2 pr-4">KPI (мес.)</th>
                  <th className="py-2 pr-4">Бонус (мес.)</th>
                  <th className="py-2 pr-4">К выплате</th>
                </tr>
              </thead>
              <tbody>
                {managers.map((m, i) => (
                  <tr key={m.id} className="border-b last:border-0">
                    <td className="py-2 pr-4 font-medium">{m.name}</td>
                    <td className="py-2 pr-4">{m.partners.length}</td>
                    <td className="py-2 pr-4">{m.partners.filter(isPartnerActive).length}</td>
                    <td className="py-2 pr-4">{payrolls[i].kpiTotal.toLocaleString("ru-RU")} ₽</td>
                    <td className="py-2 pr-4">{payrolls[i].bonusTotal.toLocaleString("ru-RU")} ₽</td>
                    <td className="py-2 pr-4 font-semibold">{payrolls[i].totalAmount.toLocaleString("ru-RU")} ₽</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
