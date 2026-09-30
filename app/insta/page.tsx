import { redirect } from "next/navigation";

// Раздел переехал: Инстаграм теперь часть «Соц.Сетей».
export default function InstaPage() {
  redirect("/analytics");
}
