import { redirect } from "next/navigation";

// Раздел переехал: Оракл теперь часть «Соц.Сетей».
export default function OraclePage() {
  redirect("/analytics");
}
