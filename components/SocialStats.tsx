"use client";

import { useEffect, useState } from "react";
import SocialDashboard from "@/components/SocialDashboard";
import NeuroAnalytics from "@/components/NeuroAnalytics";

// «Статистика Соц.сети»: цифры и их разбор — на одной странице двумя
// вкладками. Раньше цифры жили в «Соц.Сетях» вместе с управлением
// аккаунтами, а разбор — отдельно; управление уехало в «Контент-завод».

export default function SocialStats({ canManage, brands, projectName }: {
  canManage: boolean; brands?: string[]; projectName?: string;
}) {
  const [tab, setTab] = useState<"numbers" | "neuro">("numbers");
  useEffect(() => {
    if (window.location.hash === "#neuro") setTab("neuro");
  }, []);
  const go = (t: "numbers" | "neuro") => {
    setTab(t);
    history.replaceState(null, "", t === "neuro" ? "#neuro" : window.location.pathname);
  };
  const tabCls = (on: boolean) =>
    `px-3.5 py-2 text-[15px] font-medium rounded-t-lg border border-b-0 ${on ? "bg-white border-gray-200" : "border-transparent text-gray-500 hover:text-gray-700"}`;

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold">Статистика Соц.сети</h1>
      <div className="flex gap-1 border-b pl-0.5">
        <button className={tabCls(tab === "numbers")} onClick={() => go("numbers")}>📊 Цифры</button>
        <button className={tabCls(tab === "neuro")} onClick={() => go("neuro")}>🧠 Нейро-аналитика</button>
      </div>
      {tab === "numbers"
        ? <SocialDashboard canManage={canManage} brands={brands} projectName={projectName} />
        : <NeuroAnalytics isOwner={canManage} projectName={projectName} />}
    </div>
  );
}
