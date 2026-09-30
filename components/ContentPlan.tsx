"use client";

import { useEffect, useMemo, useState } from "react";

// Контент-план: неделя клеток проекта. Путь у каждой один — источник → идея →
// текст → ролик, — и любое звено правится до выхода.

type Cell = {
  date: string; slot: string; label: string; time: string;
  topic: string; facts: string; source: string; origin: string;
  text: string; status: string; account: string;
};
type Src = { type: string; config: any };

const DAYS = ["Понедельник", "Вторник", "Среда", "Четверг", "Пятница", "Суббота", "Воскресенье"];
const BADGE: Record<string, string> = {
  brief: "bg-gray-100 text-gray-700", donor: "bg-amber-100 text-amber-800",
  search: "bg-sky-100 text-sky-800", kb: "bg-violet-100 text-violet-800", manual: "bg-gray-100 text-gray-700",
  idea: "bg-gray-100 text-gray-600", text: "bg-blue-100 text-blue-800",
  ok: "bg-green-100 text-green-800", out: "bg-gray-900 text-white",
};

const dayTitle = (date: string) => {
  const d = new Date(date + "T00:00:00Z");
  return `${DAYS[(d.getUTCDay() || 7) - 1]}, ${d.toLocaleDateString("ru-RU", { day: "numeric", month: "long", timeZone: "UTC" })}`;
};
const shift = (date: string, days: number) => {
  const d = new Date(date + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

export default function ContentPlan() {
  const [weekStart, setWeekStart] = useState("");
  const [cells, setCells] = useState<Cell[]>([]);
  const [sources, setSources] = useState<Record<string, Src>>({});
  const [names, setNames] = useState<{ src: Record<string, string>; st: Record<string, string> }>({ src: {}, st: {} });
  const [canEdit, setCanEdit] = useState(false);
  const [open, setOpen] = useState("");
  const [editing, setEditing] = useState("");
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");

  async function load(w = weekStart) {
    const d = await fetch(`/api/plan${w ? `?week=${w}` : ""}`).then((r) => r.json()).catch(() => null);
    if (!d || d.error) { setErr(d?.error || "план не загрузился"); return; }
    setWeekStart(d.week); setCells(d.cells); setSources(d.sources);
    setNames({ src: d.sourceNames, st: d.statusNames }); setCanEdit(d.canEdit); setErr("");
  }
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function act(body: any, key = "") {
    setBusy(key || body.action); setErr("");
    try {
      const r = await fetch("/api/plan", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      });
      const d = await r.json();
      if (!r.ok || d.error) throw new Error(d.error || `ошибка ${r.status}`);
      setCells(d.cells); setSources(d.sources);
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy("");
    }
  }

  // Форматы проекта — из клеток недели: план показывает то, что выходит.
  const kinds = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of cells) if (!m.has(c.slot)) m.set(c.slot, c.label);
    return [...m.entries()];
  }, [cells]);

  const days = useMemo(() => {
    const m = new Map<string, Cell[]>();
    for (const c of cells) m.set(c.date, [...(m.get(c.date) || []), c]);
    return [...m.entries()];
  }, [cells]);

  const key = (c: Cell) => `${c.date}|${c.slot}`;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold mb-1">Контент-план</h1>
        <p className="text-sm text-gray-500 max-w-3xl">
          Что выходит на неделе. Тему можно вписать самому или оставить пустой — завод возьмёт идею из источника
          и напишет текст своими словами. Тему и текст можно поправить до выхода.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-1.5 text-sm">
        {["Источник", "Идея", "Своими словами", "Текст", "Ролик"].map((s, i) => (
          <span key={s} className="flex items-center gap-1.5">
            {i > 0 && <span className="text-gray-300">→</span>}
            <span className={`px-3 py-1 rounded-full border ${i === 0 ? "bg-brand-50 border-brand-600/30 text-brand-700 font-medium" : "bg-white"}`}>{s}</span>
          </span>
        ))}
      </div>

      {err && <p className="text-sm text-red-700 bg-red-50 rounded-lg px-3 py-2">{err}</p>}

      {kinds.length > 0 && (
        <div className="card space-y-1">
          <h2 className="font-semibold">Откуда брать темы</h2>
          <p className="text-xs text-gray-400 mb-2">
            У каждого формата свой источник. Путь у всех один: берём идею, пишем своё. Доноры, поиск и база
            знаний заполняют план силами завода; «по брифу» и «вручную» работают прямо здесь.
          </p>
          {kinds.map(([slot, label]) => {
            const s = sources[slot] || { type: "brief", config: {} };
            return (
              <div key={slot} className="grid sm:grid-cols-[150px_1fr] gap-3 py-3 border-t first:border-t-0">
                <div className="text-sm font-medium pt-1.5">{label}</div>
                <div>
                  <div className="inline-flex flex-wrap bg-gray-100 rounded-lg p-0.5 gap-0.5">
                    {Object.entries(names.src).map(([t, n]) => (
                      <button key={t} disabled={!canEdit}
                        className={`px-3 py-1.5 rounded-md text-sm ${s.type === t ? "bg-white shadow-sm font-semibold" : "text-gray-600"}`}
                        onClick={() => act({ action: "source", kind: slot, type: t, config: s.config }, `src:${slot}`)}>
                        {n}
                      </button>
                    ))}
                  </div>
                  {s.type === "donor" && (
                    <textarea className="input mt-2 min-h-[70px]" disabled={!canEdit}
                      placeholder={"youtube.com/@канал\ninstagram.com/аккаунт"}
                      defaultValue={(s.config.links || []).join("\n")}
                      onBlur={(e) => act({ action: "source", kind: slot, type: "donor",
                        config: { links: e.target.value.split("\n").map((x) => x.trim()).filter(Boolean) } }, `src:${slot}`)} />
                  )}
                  {s.type === "search" && (
                    <input className="input mt-2" disabled={!canEdit}
                      placeholder="о чём искать: темы, вопросы людей, свежие исследования"
                      defaultValue={s.config.query || ""}
                      onBlur={(e) => act({ action: "source", kind: slot, type: "search", config: { query: e.target.value } }, `src:${slot}`)} />
                  )}
                  {s.type === "kb" && (
                    <p className="text-xs text-gray-500 mt-2">Загрузка файлов появится вместе с новым заводом. Пока база знаний
                      работает только у Персонажа СуперФита — по гайдам из его папки.</p>
                  )}
                  {s.type === "manual" && (
                    <p className="text-xs text-gray-500 mt-2">Темы вписываете сами. Пустые клетки завод не тронет.</p>
                  )}
                  {s.type === "brief" && (
                    <p className="text-xs text-gray-500 mt-2">Идеи придумываются по брифу проекта — кнопкой «Другая» у клетки.</p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-semibold">
          Неделя {weekStart && `${new Date(weekStart + "T00:00:00Z").toLocaleDateString("ru-RU", { day: "numeric", month: "long", timeZone: "UTC" })} — ${new Date(shift(weekStart, 6) + "T00:00:00Z").toLocaleDateString("ru-RU", { day: "numeric", month: "long", timeZone: "UTC" })}`}
        </h2>
        <div className="flex gap-1.5">
          <button className="btn btn-secondary" onClick={() => load(shift(weekStart, -7))}>←</button>
          <button className="btn btn-secondary" onClick={() => load(new Date().toISOString().slice(0, 10))}>Эта неделя</button>
          <button className="btn btn-secondary" onClick={() => load(shift(weekStart, 7))}>→</button>
        </div>
      </div>

      {days.length === 0 && (
        <div className="card text-sm text-gray-500">
          На этой неделе у проекта нет форматов по расписанию и ничего не вписано.
        </div>
      )}

      {days.map(([date, list]) => (
        <div key={date} className="space-y-2">
          <div className="text-xs font-semibold uppercase tracking-wide text-gray-400">{dayTitle(date)}</div>
          {list.map((c) => {
            const k = key(c);
            const empty = !c.topic;
            const words = c.text.trim() ? c.text.trim().split(/\s+/).length : 0;
            return (
              <div key={k} className="card p-0 overflow-hidden">
                <div className="grid grid-cols-[64px_1fr] sm:grid-cols-[64px_1fr_auto] gap-3 p-3.5 items-center">
                  <div>
                    <div className="font-bold tabular-nums">{c.time || "—"}</div>
                    <div className="text-[11px] text-gray-400">{c.label}</div>
                  </div>
                  <div className="min-w-0">
                    {editing === k ? (
                      <input className="input" autoFocus value={draft}
                        onChange={(e) => setDraft(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") { act({ action: "topic", date: c.date, slot: c.slot, topic: draft }, k); setEditing(""); }
                          if (e.key === "Escape") setEditing("");
                        }} />
                    ) : (
                      <div className={`font-semibold ${empty ? "text-gray-400 font-normal italic" : ""}`}>
                        {empty ? `Темы ещё нет — ${(sources[c.slot]?.type || "brief") === "manual" ? "впишите сами" : "подберётся из источника"}` : c.topic}
                      </div>
                    )}
                    {!empty && (
                      <div className="flex flex-wrap gap-1.5 mt-1">
                        {c.source && <span className={`text-[11px] px-2 py-0.5 rounded-full ${BADGE[c.source] || BADGE.brief}`}>{names.src[c.source] || c.source}</span>}
                        {c.status && <span className={`text-[11px] px-2 py-0.5 rounded-full ${BADGE[c.status] || ""}`}>{names.st[c.status] || c.status}</span>}
                      </div>
                    )}
                  </div>
                  {canEdit && (
                    <div className="flex flex-wrap gap-1.5 col-span-2 sm:col-span-1 sm:justify-end">
                      {editing === k ? (
                        <button className="btn btn-primary" onClick={() => { act({ action: "topic", date: c.date, slot: c.slot, topic: draft }, k); setEditing(""); }}>Сохранить</button>
                      ) : (
                        <>
                          <button className="btn btn-secondary" onClick={() => { setEditing(k); setDraft(c.topic); }}>{empty ? "Вписать" : "✎ Тема"}</button>
                          {!empty && <button className="btn btn-secondary" onClick={() => setOpen(open === k ? "" : k)}>{open === k ? "Скрыть текст" : "Текст"}</button>}
                          <button className="btn btn-secondary" disabled={busy === `another:${k}`}
                            onClick={() => act({ action: "another", date: c.date, slot: c.slot }, `another:${k}`)}>
                            {busy === `another:${k}` ? "Думаю…" : empty ? "Подобрать" : "↻ Другая"}
                          </button>
                        </>
                      )}
                    </div>
                  )}
                </div>

                {open === k && !empty && (
                  <div className="border-t bg-slate-50/60 p-3.5 sm:pl-[88px] space-y-2">
                    {c.origin && <div className="text-xs text-gray-500 bg-white border rounded-lg px-2.5 py-1.5">{c.origin}</div>}
                    {c.text ? (
                      <>
                        <textarea className="input min-h-[150px] leading-relaxed" defaultValue={c.text} disabled={!canEdit}
                          key={c.text}
                          onBlur={(e) => e.target.value !== c.text && act({ action: "text", date: c.date, slot: c.slot, text: e.target.value }, k)} />
                        <div className="flex flex-wrap items-center gap-2">
                          {canEdit && (
                            <button className="btn btn-secondary" disabled={busy === `write:${k}`}
                              onClick={() => act({ action: "write", date: c.date, slot: c.slot }, `write:${k}`)}>
                              {busy === `write:${k}` ? "Пишу…" : "↻ Переписать"}
                            </button>
                          )}
                          {canEdit && c.status !== "ok" && (
                            <button className="btn btn-primary" onClick={() => act({ action: "approve", date: c.date, slot: c.slot }, k)}>✓ Утвердить</button>
                          )}
                          {c.status === "ok" && (
                            <span className="text-xs text-green-800 bg-green-100 rounded-full px-2.5 py-1">
                              утверждено — завод возьмёт этот текст
                              {canEdit && <button className="ml-2 underline" onClick={() => act({ action: "unapprove", date: c.date, slot: c.slot }, k)}>снять</button>}
                            </span>
                          )}
                          <span className="ml-auto text-xs text-gray-400">{words} слов · ≈ {Math.round(words / 2.6)} с</span>
                        </div>
                      </>
                    ) : (
                      canEdit ? (
                        <button className="btn btn-primary" disabled={busy === `write:${k}`}
                          onClick={() => act({ action: "write", date: c.date, slot: c.slot }, `write:${k}`)}>
                          {busy === `write:${k}` ? "Пишу…" : "Написать текст"}
                        </button>
                      ) : <p className="text-sm text-gray-500">Текст ещё не написан.</p>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}
