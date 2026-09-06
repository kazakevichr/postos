import { redirect } from "next/navigation";
import { accessBrands, currentAccess } from "@/lib/access";
import { prisma } from "@/lib/prisma";
import { walletProjectsOf } from "@/lib/wallets";
import WalletsBoard from "@/components/WalletsBoard";

// Кошельки платных сервисов: остатки, пополнения, что останавливает завод.
// Раньше жили вкладкой внутри «Контент-завода», но это раздел про деньги,
// а не про производство — искать его там было неоткуда.
// СММ сюда не ходит: он работает с контентом, а не с деньгами сервисов.
// Партнёр видит кошельки своего направления, но не пополняет их.
export default async function WalletsPage() {
  const access = await currentAccess();
  if (!access) redirect("/login");
  if (!["OWNER", "PARTNER"].includes(access.role)) redirect("/");

  // Кошельки направления определяет тот же бренд, что делит соцсети и завод.
  // Раньше привязка шла через источник дохода, и незаполненное поле оставляло
  // раздел пустым, хотя кошельки у направления есть.
  const mine = walletProjectsOf(await accessBrands(access));

  if (!mine.length) {
    const project = access.projectId
      ? await prisma.project.findUnique({
          where: { id: access.projectId },
          select: { name: true },
        })
      : null;
    return (
      <div className="space-y-4">
        <h1 className="text-xl font-bold">Кошельки</h1>
        <p className="card text-sm text-gray-500">
          У направления «{project?.name || "—"}» нет своих платных сервисов. Кошельки заведены у
          Оракла и СуперФита — переключи направление наверху, чтобы их увидеть.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold">Кошельки</h1>
      {/* Один проект — вкладки не нужны: переключать не на что. */}
      <WalletsBoard canManage={access.canEdit} lockTo={mine.length === 1 ? mine[0] : undefined} />
    </div>
  );
}
