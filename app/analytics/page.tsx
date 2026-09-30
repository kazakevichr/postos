import { redirect } from "next/navigation";
import { SMM_ROLES, currentAccess } from "@/lib/access";
import { prisma } from "@/lib/prisma";
import { brandsOf } from "@/lib/brands";
import SocialStats from "@/components/SocialStats";

export const dynamic = "force-dynamic";

export default async function AnalyticsPage() {
  const access = await currentAccess();
  if (!access || !SMM_ROLES.includes(access.role)) redirect("/");

  // Цифры и их разбор — одни и те же аккаунты, значит и рамки направления
  // у них одни.
  const project = access.projectId
    ? await prisma.project.findUnique({
        where: { id: access.projectId },
        select: { name: true, brandKeys: true },
      })
    : null;

  const brands = project ? brandsOf(project) : [];

  // У направления нет ни одного аккаунта — показываем пустое место, а не всё
  // подряд. Молчаливый откат к «показать всё» и был причиной того, что срез
  // выглядел сделанным и не работал.
  if (project && brands.length === 0) {
    return (
      <div className="space-y-4">
        <h1 className="text-xl font-bold">{"Статистика Соц.сети"}</h1>
        <p className="card text-sm text-gray-500">
          К направлению «{project.name}» не привязано ни одного аккаунта соцсетей. Привязка задаётся
          в настройках проекта, в блоке «Контент».
        </p>
      </div>
    );
  }

  return (
    <SocialStats canManage={access.canEdit} brands={brands.length ? brands : undefined} projectName={project?.name} />
  );
}
