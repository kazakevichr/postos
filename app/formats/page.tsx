import { redirect } from "next/navigation";
import { SMM_ROLES, currentAccess } from "@/lib/access";
import FormatsCatalog from "@/components/FormatsCatalog";

// Каталог форматов: что умеет завод и что из этого подключено к проекту.
export default async function FormatsPage() {
  const access = await currentAccess();
  if (!access) redirect("/login");
  if (!SMM_ROLES.includes(access.role)) redirect("/payroll");
  return <FormatsCatalog />;
}
