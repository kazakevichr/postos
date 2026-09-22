"use client";

// Расписание завода MoneyBall: когда по каждому формату стартует сборка.
//
// Правка сохраняется кнопкой, а не на каждый щелчок, как в матрице маршрутов.
// Там щелчок включает или гасит уже идущее, а здесь случайно добавленное
// время — это лишняя платная сборка: HeyGen, озвучка, писатель.
import { useEffect, useState } from "react";

type Slot = { days: number[]; time: string };
type Rule = { mode: "time" | "demand"; slots: Slot[] };

const DAYS = ["пн", "вт", "ср", "чт", "пт", "сб", "вс"];
const copy = <T,>(v: T): T => JSON.parse(JSON.stringify(v));

export default function MoneyballSchedule({
  canManage = false,
  onSaved,
}: {
  canManage?: boolean;
  onSaved?: () => void;
}) {
  const [data, setData] = useState<any>(null);
  const [draft, setDraft] = useState<Record<string, Rule>>({});
  const [busy, setBusy] = useState("");
  const [note, setNote] = useState("");

  useEffect(() => {
    fetch("/api/moneyball/schedule")
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (!j) return;
        setData(j);
        setDraft(copy(j.schedule));
      })
      .catch(() => {});
  }, []);

  if (!data) return null;

  const dirty = (kind: string) => JSON.stringify(draft[kind]) !== JSON.stringify(data.schedule[kind]);
  const edit = (kind: string, fn: (r: Rule) => void) =>
    setDraft((d) => {
      const r = copy(d[kind]);
      fn(r);
      return { ...d, [kind]: r };
    });

  async function save(kind: string) {
    setBusy(kind);
    setNote("");
    const r = await fetch("/api/moneyball/schedule", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ kind, rule: draft[kind] }),
    });
    const j = await r.json().catch(() => ({}));
    if (j.schedule) {
      setData((d: any) => ({ ...d, schedule: j.schedule, labels: j.labels }));
      setDraft((d) => ({ ...d, [kind]: copy(j.schedule[kind]) }));
      onSaved?.();
    } else {
      setNote(j.error || "не получилось");
    }
    setBusy("");
  }

  return (
    <div className="card mb-4 overflow-x-auto">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-semibold">🗓 Расписание завода MoneyBall</h2>
        <span className="text-xs text-gray-400">время московское · старт сборки</span>
      </div>
      <p className="text-xs text-gray-400 mt-0.5 mb-2">
        Завод сверяется с расписанием раз в минуту. Готовый ролик приходит в бот выдачи, когда соберётся.
      </p>
      {note && <p className="text-sm text-red-600 mb-2">{note}</p>}

      {data.formats.map((f: any) => {
        const rule = draft[f.kind];
        const off = rule.mode !== "time";
        return (
          <div key={f.kind} className="border-t py-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium">{f.label}</span>
              <span className={`text-xs ${data.schedule[f.kind].mode === "time" ? "text-gray-600" : "text-gray-400"}`}>
                {data.labels[f.kind]}
              </span>
            </div>

            {canManage && (
              <div className="mt-2 space-y-1.5">
                <select
                  value={rule.mode}
                  onChange={(e) => edit(f.kind, (r) => { r.mode = e.target.value as Rule["mode"]; })}
                  className="text-xs border rounded-md px-1 py-0.5 bg-white text-gray-600"
                >
                  <option value="time">по времени</option>
                  <option value="demand">по запросу</option>
                </select>

                {rule.slots.map((s, i) => (
                  <div key={i} className={`flex flex-wrap items-center gap-1 ${off ? "opacity-50" : ""}`}>
                    <input
                      type="time"
                      value={s.time}
                      onChange={(e) => edit(f.kind, (r) => { r.slots[i].time = e.target.value; })}
                      className="text-xs border rounded-md px-1 py-0.5 bg-white text-gray-600 w-[74px]"
                      title="Время старта сборки, МСК"
                    />
                    {DAYS.map((d, di) => {
                      const day = di + 1;
                      const on = s.days.includes(day);
                      return (
                        <button
                          key={d}
                          onClick={() =>
                            edit(f.kind, (r) => {
                              const days = r.slots[i].days;
                              r.slots[i].days = on ? days.filter((x) => x !== day) : [...days, day].sort((a, b) => a - b);
                            })
                          }
                          className={`px-1.5 py-0.5 rounded text-xs ${on ? "bg-brand-600 text-white" : "bg-white border text-gray-500 hover:bg-gray-50"}`}
                        >
                          {d}
                        </button>
                      );
                    })}
                    <button
                      onClick={() => edit(f.kind, (r) => { r.slots.splice(i, 1); })}
                      className="ml-1 text-gray-400 hover:text-red-600 text-sm px-1"
                      title="Убрать этот запуск"
                    >
                      ×
                    </button>
                  </div>
                ))}

                <div className="flex flex-wrap items-center gap-2 pt-1">
                  <button
                    onClick={() => edit(f.kind, (r) => { r.slots.push({ days: [1, 2, 3, 4, 5, 6, 7], time: "12:00" }); })}
                    className="text-xs text-brand-700 hover:underline"
                  >
                    ＋ запуск
                  </button>
                  {dirty(f.kind) && (
                    <>
                      <button className="btn btn-primary text-xs" disabled={busy === f.kind} onClick={() => save(f.kind)}>
                        {busy === f.kind ? "Сохраняю…" : "Сохранить"}
                      </button>
                      <button
                        className="btn text-xs"
                        onClick={() => setDraft((d) => ({ ...d, [f.kind]: copy(data.schedule[f.kind]) }))}
                      >
                        Отменить
                      </button>
                    </>
                  )}
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
