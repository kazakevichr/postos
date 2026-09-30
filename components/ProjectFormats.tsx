"use client";

import { useEffect, useState } from "react";
import { Preview, State, StatusPill } from "@/components/formatsUi";

// Пульт проекта, у которого ещё нет своего завода: какие форматы добавлены и
// что осталось до запуска. Пустой проект получает одно приглашение выбрать.

export default function ProjectFormats({ label }: { label: string }) {
  const [s, setS] = useState<State | null>(null);
  useEffect(() => {
    fetch("/api/formats").then((r) => r.json()).then((d) => !d.error && setS(d)).catch(() => {});
  }, []);

  const mine = s?.catalog.filter((f) => f.added) || [];
  if (!s || mine.length === 0) {
    return (
      <div className="card mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="font-semibold">У проекта «{label}» пока нет форматов</div>
          <p className="text-sm text-gray-500">Выберите, какой контент будет делать завод, — у каждого формата есть пример готового результата.</p>
        </div>
        <a href="/formats" className="btn btn-primary">+ Добавить формат</a>
      </div>
    );
  }

  return (
    <div className="card mb-4">
      <div className="flex items-baseline justify-between gap-2 mb-3">
        <h2 className="font-semibold">Форматы проекта</h2>
        <a href="/formats" className="text-sm text-brand-700 hover:underline">+ Добавить формат</a>
      </div>
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {mine.map((f) => {
          const left = f.added!.steps.filter((x) => !x.done);
          return (
            <a key={f.kind} href={`/formats/${f.kind}`} className="flex gap-3 rounded-xl border p-2 hover:shadow-md transition">
              <div className="w-20 shrink-0 rounded-lg overflow-hidden"><Preview f={f} tall /></div>
              <div className="min-w-0 py-1">
                <div className="font-medium text-sm">{f.name}</div>
                <div className="mt-1"><StatusPill f={f} /></div>
                <div className="text-[11px] text-gray-500 mt-1.5">
                  {f.added!.status === "live" ? "Выходит по расписанию"
                    : left.length ? `Осталось: ${left.map((x) => STEP_NAME[x.step] || x.step).join(", ")}`
                    : "Ждёт включения на заводе и пробного ролика"}
                </div>
              </div>
            </a>
          );
        })}
      </div>
    </div>
  );
}

const STEP_NAME: Record<string, string> = { brief: "анкета", source: "источник тем", face: "лицо", voice: "голос", schedule: "расписание" };
