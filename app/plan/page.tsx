import { redirect } from "next/navigation";
import { SMM_ROLES, currentAccess } from "@/lib/access";
import ContentPlan from "@/components/ContentPlan";

// Контент-план проекта — для всего блока СММ. Править могут те, у кого есть
// право изменения в выбранном направлении; остальные смотрят.
export default async function PlanPage() {
  const access = await currentAccess();
  if (!access) redirect("/login");
  if (!SMM_ROLES.includes(access.role)) redirect("/payroll");
  return <ContentPlan />;
}
