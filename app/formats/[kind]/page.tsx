import { redirect } from "next/navigation";
import { SMM_ROLES, currentAccess } from "@/lib/access";
import FormatSetup from "@/components/FormatSetup";

// Настройка одного формата у проекта — по шагам.
export default async function FormatSetupPage({ params }: { params: { kind: string } }) {
  const access = await currentAccess();
  if (!access) redirect("/login");
  if (!SMM_ROLES.includes(access.role)) redirect("/payroll");
  return <FormatSetup kind={params.kind} />;
}
