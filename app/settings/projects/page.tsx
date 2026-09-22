import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import ProjectSettingsForm from "@/components/ProjectSettingsForm";
import NewProjectForm from "@/components/NewProjectForm";
import { brandNames } from "@/lib/insta";
import { ALL_BRAND_KEYS } from "@/lib/brands";
import Link from "next/link";

export default async function ProjectSettingsPage() {
  const session = await getServerSession(authOptions);
  if (!session) redirect("/login");
  if (session.user.role !== "OWNER") redirect("/");

  // Бренды берём из настроек сбора соцсетей: направление и бренд зовутся
  // по-разному (SUPERFIT24 против СуперФита), и попадать в чужое написание
  // руками — верный способ получить пустой срез и долго искать почему.
  // Настроенные для сбора плюс известные системе: Оракл читается своими
  // каналами, а не BRAND_MAP, и без этого его нечем было бы выбрать.
  const brands = [...new Set([...brandNames(), ...ALL_BRAND_KEYS])];

  const projects = await prisma.project.findMany({
    include: { partnerTypes: true },
    orderBy: { createdAt: "asc" },
  });

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-bold">Настройка проектов</h1>
        <Link href="/settings/users" className="btn btn-secondary">Сотрудники →</Link>
      </div>
      <div className="space-y-4">
        {projects.map((p) => (
          <ProjectSettingsForm key={p.id} project={p} brands={brands} />
        ))}
        <NewProjectForm />
      </div>
    </div>
  );
}
