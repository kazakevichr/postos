import { redirect } from "next/navigation";
import { currentAccess, projectWhere } from "@/lib/access";
import { prisma } from "@/lib/prisma";
import Link from "next/link";

export default async function LostPartnersPage() {
  const access = await currentAccess();
  if (!access) redirect("/login");

  // Рамки направления: база отказов по СуперФиту в разделе Оракла — не
  // напоминание, а чужой список, к которому нечего возвращаться.
  const where: any = { status: "LOST", ...projectWhere(access) };
  if (access.role === "MANAGER") where.responsibleUserId = access.userId;

  const partners = await prisma.partner.findMany({
    where,
    include: { project: true, responsible: true },
    orderBy: { lostAt: "desc" },
  });

  const today = new Date();

  return (
    <div>
      <h1 className="text-xl font-bold mb-1">Упущенные партнёры</h1>
      <p className="text-sm text-gray-500 mb-4">
        База отказов — сюда стоит периодически возвращаться и пробовать связаться снова.
      </p>
      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-gray-500 border-b">
              <th className="py-2 pr-4">Партнёр</th>
              <th className="py-2 pr-4">Проект</th>
              <th className="py-2 pr-4">Ответственный</th>
              <th className="py-2 pr-4">Причина</th>
              <th className="py-2 pr-4">Дата отказа</th>
              <th className="py-2 pr-4">Напомнить</th>
            </tr>
          </thead>
          <tbody>
            {partners.map((p) => {
              const dueRetry = p.retryReminderDate && new Date(p.retryReminderDate) <= today;
              return (
                <tr key={p.id} className={`border-b last:border-0 ${dueRetry ? "bg-yellow-50" : ""}`}>
                  <td className="py-2 pr-4">
                    <Link href={`/partners/${p.id}`} className="text-brand-700 hover:underline">{p.name}</Link>
                  </td>
                  <td className="py-2 pr-4">{p.project.name}</td>
                  <td className="py-2 pr-4">{p.responsible.name}</td>
                  <td className="py-2 pr-4">{p.lostReason || "—"}</td>
                  <td className="py-2 pr-4">{p.lostAt ? new Date(p.lostAt).toLocaleDateString("ru-RU") : "—"}</td>
                  <td className="py-2 pr-4">
                    {p.retryReminderDate ? new Date(p.retryReminderDate).toLocaleDateString("ru-RU") : "—"}
                    {dueRetry && <span className="ml-1 badge-yellow">пора</span>}
                  </td>
                </tr>
              );
            })}
            {partners.length === 0 && (
              <tr><td colSpan={6} className="py-4 text-center text-gray-400">Упущенных партнёров нет.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
