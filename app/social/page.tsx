import { redirect } from "next/navigation";

// «Соц.Сети» разошлись по двум местам: управление аккаунтами — в
// «Контент-завод», цифры — в «Статистику Соц.сети». Старые ссылки (из
// уведомлений, закладок) ведут туда, где теперь цифры.
export default function SocialPage() {
  redirect("/analytics");
}
