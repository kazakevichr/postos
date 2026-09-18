import { redirect } from "next/navigation";
import { accessBrands, currentAccess } from "@/lib/access";
import { listOpen } from "@/lib/notices";
import NoticesPanel from "@/components/NoticesPanel";

// Уведомления: одна страница на весь Постос. Сюда стекается всё, что требует
// внимания, из всех разделов — деньги, площадки, завод, люди.
export default async function NoticesPage() {
  const access = await currentAccess();
  if (!access) redirect("/login");
  const notices = await listOpen({
    role: access.role,
    brands: await accessBrands(access),
    userId: access.userId,
  });
  return <NoticesPanel initial={notices} />;
}
