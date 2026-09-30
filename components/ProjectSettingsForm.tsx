"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { brandLabel } from "@/lib/brands";

type Project = {
  id: string;
  name: string;
  isActive: boolean;
  currency: string;
  incomeSource: string | null;
  brandKeys: string;
  hasFactory: boolean;
  partnerCommissionPercent: number;
  ownerProfitPercent: number;
  kpiEnabled: boolean;
  kpiAmount: number;
  bonusEnabled: boolean;
  bonusPercent: number;
  bonusThreshold: number;
  bonusMaxAmount: number | null;
  bonusPeriodMonths: number | null;
  knowledgeBase: string;
  partnerTypes: { id: string; name: string; kpiAmount: number }[];
};

export default function ProjectSettingsForm({
  project,
  brands,
}: {
  project: Project;
  // Бренды соцсетей как они названы в сборе статистики. Выбор из списка, а не
  // ввод руками: направление и бренд зовутся по-разному, и промахнуться в
  // написании — значит получить пустой срез без единой подсказки почему.
  brands: string[];
}) {
  const router = useRouter();
  const [form, setForm] = useState(project);
  const [busy, setBusy] = useState(false);
  const [typeName, setTypeName] = useState("");
  const [typeKpi, setTypeKpi] = useState("");

  function set<K extends keyof Project>(key: K, value: Project[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function save() {
    setBusy(true);
    await fetch(`/api/projects/${project.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: form.name.trim(),
        isActive: form.isActive,
        currency: form.currency,
        incomeSource: form.incomeSource || null,
        brandKeys: form.brandKeys || "",
        hasFactory: Boolean(form.hasFactory),
        partnerCommissionPercent: Number(form.partnerCommissionPercent),
        ownerProfitPercent: Number(form.ownerProfitPercent),
        kpiEnabled: form.kpiEnabled,
        kpiAmount: Number(form.kpiAmount),
        bonusEnabled: form.bonusEnabled,
        bonusPercent: Number(form.bonusPercent),
        bonusThreshold: Number(form.bonusThreshold),
        bonusMaxAmount: form.bonusMaxAmount === null ? null : Number(form.bonusMaxAmount),
        bonusPeriodMonths: form.bonusPeriodMonths === null ? null : Number(form.bonusPeriodMonths),
        knowledgeBase: form.knowledgeBase,
      }),
    });
    setBusy(false);
    router.refresh();
  }

  async function addPartnerType(e: React.FormEvent) {
    e.preventDefault();
    if (!typeName.trim()) return;
    await fetch(`/api/projects/${project.id}/partner-types`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: typeName, kpiAmount: Number(typeKpi || 0) }),
    });
    setTypeName("");
    setTypeKpi("");
    router.refresh();
  }

  const Block = ({ title, note }: { title: string; note: string }) => (
    <div className="border-t pt-3 first:border-0">
      <h4 className="text-sm font-semibold">
        {title} <span className="text-gray-400 font-normal">· {note}</span>
      </h4>
    </div>
  );

  return (
    <div className="card space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <input
          className="input flex-1 min-w-[220px] font-semibold"
          value={form.name}
          onChange={(e) => set("name", e.target.value as any)}
          aria-label="Название направления"
        />
        <label className="flex items-center gap-2 text-sm text-gray-500">
          <input
            type="checkbox"
            checked={form.isActive}
            onChange={(e) => set("isActive", e.target.checked as any)}
          />
          активно
        </label>
      </div>

      <Block title="Бухгалтерия" note="как считается доход направления" />
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-sm">
        <label className="flex flex-col gap-1">
          Валюта
          <input className="input" value={form.currency} onChange={(e) => set("currency", e.target.value)} />
        </label>
        <label className="flex flex-col gap-1">
          Откуда берём доход
          <select
            className="input"
            value={form.incomeSource || ""}
            onChange={(e) => set("incomeSource", e.target.value || null)}
          >
            <option value="">вношу руками</option>
            <option value="superfit">лендинг Суперфита</option>
            <option value="oracle">подписки Оракла</option>
          </select>
          <span className="text-xs text-gray-400">
            «Обновить поступления» в Бухгалтерии спросит источник за месяц.
          </span>
        </label>
        <label className="flex flex-col gap-1">
          % партнёру от выручки
          <input className="input" type="number" value={form.partnerCommissionPercent} onChange={(e) => set("partnerCommissionPercent", Number(e.target.value) as any)} />
        </label>
        <label className="flex flex-col gap-1">
          % владельца от остатка
          <input className="input" type="number" value={form.ownerProfitPercent} onChange={(e) => set("ownerProfitPercent", Number(e.target.value) as any)} />
        </label>
      </div>

      <Block title="Контент" note="что показывать в статистике и на заводе" />
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm">
        <div className="flex flex-col gap-1 sm:col-span-2">
          Бренды соцсетей
          <div className="flex flex-wrap gap-1.5 pt-1">
            {brands.length === 0 && (
              <span className="text-xs text-gray-400">
                Бренды не настроены — сбор статистики соцсетей ещё не подключён.
              </span>
            )}
            {brands.map((b) => {
              const chosen = (form.brandKeys || "")
                .split(",")
                .map((x) => x.trim())
                .filter(Boolean);
              const on = chosen.includes(b);
              return (
                <button
                  key={b}
                  type="button"
                  className={`btn text-xs ${on ? "btn-primary" : "btn-secondary"}`}
                  onClick={() =>
                    set(
                      "brandKeys",
                      (on ? chosen.filter((x) => x !== b) : [...chosen, b]).join(",")
                    )
                  }
                >
                  {brandLabel(b)}
                </button>
              );
            })}
          </div>
          <span className="text-xs text-gray-400">
            Ни один не выбран — в срезе направления аккаунтов не будет.
          </span>
        </div>
        <label className="flex flex-col gap-1">
          Свой контент-завод
          <select
            className="input"
            value={form.hasFactory ? "true" : "false"}
            onChange={(e) => set("hasFactory", (e.target.value === "true") as any)}
          >
            <option value="false">нет</option>
            <option value="true">есть</option>
          </select>
          <span className="text-xs text-gray-400">
            Нет — разделы завода и кабинета СММ покажут пустое место вместо чужих норм.
          </span>
        </label>
      </div>

      <Block title="Партнёрский менеджмент" note="KPI и бонусы менеджеров" />
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-sm">
        <label className="flex flex-col gap-1">
          KPI включён
          <select className="input" value={String(form.kpiEnabled)} onChange={(e) => set("kpiEnabled", (e.target.value === "true") as any)}>
            <option value="true">Да</option>
            <option value="false">Нет</option>
          </select>
        </label>
        <label className="flex flex-col gap-1">
          Сумма KPI (общая)
          <input className="input" type="number" value={form.kpiAmount} onChange={(e) => set("kpiAmount", Number(e.target.value) as any)} />
        </label>
        <label className="flex flex-col gap-1">
          Бонус включён
          <select className="input" value={String(form.bonusEnabled)} onChange={(e) => set("bonusEnabled", (e.target.value === "true") as any)}>
            <option value="true">Да</option>
            <option value="false">Нет</option>
          </select>
        </label>
        <label className="flex flex-col gap-1">
          Бонус, %
          <input className="input" type="number" value={form.bonusPercent} onChange={(e) => set("bonusPercent", Number(e.target.value) as any)} />
        </label>
        <label className="flex flex-col gap-1">
          Порог прибыли/мес для бонуса
          <input className="input" type="number" value={form.bonusThreshold} onChange={(e) => set("bonusThreshold", Number(e.target.value) as any)} />
        </label>
        <label className="flex flex-col gap-1">
          Максимальный бонус (пусто = без лимита)
          <input className="input" type="number" value={form.bonusMaxAmount ?? ""} onChange={(e) => set("bonusMaxAmount", (e.target.value === "" ? null : Number(e.target.value)) as any)} />
        </label>
        <label className="flex flex-col gap-1">
          Период бонуса, мес. (пусто = бессрочно)
          <input className="input" type="number" value={form.bonusPeriodMonths ?? ""} onChange={(e) => set("bonusPeriodMonths", (e.target.value === "" ? null : Number(e.target.value)) as any)} />
        </label>
      </div>

      <button className="btn btn-primary" disabled={busy} onClick={save}>Сохранить настройки проекта</button>

      <div className="border-t pt-3">
        <h4 className="text-sm font-semibold mb-2">
          База знаний по проекту{" "}
          <span className="text-gray-400 font-normal">· видна менеджерам и используется ИИ-помощником</span>
        </h4>
        <textarea
          className="input"
          rows={8}
          placeholder="Опишите проект: что продаём, кто ЦА, условия, скрипты ответов на частые вопросы партнёров, оффер, ограничения и т.д."
          value={form.knowledgeBase}
          onChange={(e) => set("knowledgeBase", e.target.value)}
        />
        <button
          className="btn btn-secondary mt-2 !px-3 !py-1 text-xs"
          disabled={busy}
          onClick={save}
        >
          Сохранить базу знаний
        </button>
      </div>

      <div className="border-t pt-3">
        <h4 className="text-sm font-semibold mb-2">
          Типы партнёров{" "}
          <span className="text-gray-400 font-normal">· своя сумма KPI за партнёра этого типа</span>
        </h4>
        <div className="space-y-1 text-sm mb-2">
          {form.partnerTypes.map((t) => (
            <div key={t.id} className="flex justify-between">
              <span>{t.name}</span>
              <span>{t.kpiAmount} {form.currency}</span>
            </div>
          ))}
          {form.partnerTypes.length === 0 && <p className="text-gray-400">Типов пока нет.</p>}
        </div>
        <form onSubmit={addPartnerType} className="flex gap-2">
          <input className="input" placeholder="Название типа" value={typeName} onChange={(e) => setTypeName(e.target.value)} />
          <input className="input w-32" placeholder="KPI" type="number" value={typeKpi} onChange={(e) => setTypeKpi(e.target.value)} />
          <button className="btn btn-secondary" type="submit">+ Добавить</button>
        </form>
      </div>
    </div>
  );
}
