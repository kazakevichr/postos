"use client";

import { useEffect, useMemo, useState } from "react";

// Контент-план — единственное место про темы и тексты. «Как работает завод»
// (форматы, расписание, каналы) живёт в «Контент-заводе», здесь — «о чём
// выходят ролики»: тема, откуда она, текст, утверждение.

type Cell = {
  date: string; slot: string; label: string; time: string;
  topic: string; facts: string; source: string; origin: string;
  text: string; status: string; account: string;
};
type Way = { type: string; title: string; detail: string; fixed: boolean };

const DAYS = ["Понедельник", "Вторник", "Среда", "Четверг", "Пятница", "Суббота", "Воскресенье"];
const SHORT = ["пн", "вт", "ср", "чт", "пт", "сб", "вс"];
const STATUS_CLS: Record<string, string> = {
  idea: "bg-gray-100 text-gray-600", text: "bg-blue-100 text-blue-800",
  ok: "bg-green-100 text-green-800", out: "bg-gray-900 text-white",
};
const DOT: Record<string, string> = { idea: "bg-gray-300", text: "bg-blue-500", ok: "bg-green-500", out: "bg-gray-900" };

const utc = (d: string) => new Date(d + "T00:00:00Z");
const fmtDay = (d: string, o: Intl.DateTimeFormatOptions) => utc(d).toLocaleDateString("ru-RU", { ...o, timeZone: "UTC" });
const wd = (d: string) => (utc(d).getUTCDay() || 7) - 1;
const shiftDays = (d: string, n: number) => { const x = utc(d); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const shiftMonth = (m: string, n: number) => { const [y, mo] = m.split("-").map(Number); const x = new Date(Date.UTC(y, mo - 1 + n, 1)); return x.toISOString().slice(0, 7); };
const today = () => new Date().toISOString().slice(0, 10);

export default function ContentPlan() {
  const [view, setView] = useState<"week" | "month">("week");
  const [weekStart, setWeekStart] = useState("");
  const [month, setMonth] = useState(today().slice(0, 7));
  const [cells, setCells] = useState<Cell[]>([]);
  const [ways, setWays] = useState<Record<string, Way>>({});
  const [names, setNames] = useState<{ src: Record<string, string>; st: Record<string, string> }>({ src: {}, st: {} });
  const [canEdit, setCanEdit] = useState(false);
  const [isOwner, setIsOwner] = useState(false);
  const [open, setOpen] = useState("");
  const [editing, setEditing] = useState("");
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState("");
  const [note, setNote] = useState("");
  const [err, setErr] = useState("");

  async function load(opts: { week?: string; month?: string } = {}) {
    const q = opts.month ? `?month=${opts.month}` : `?week=${opts.week || weekStart || today()}`;
    const d = await fetch(`/api/plan${q}`).then((r) => r.json()).catch(() => null);
    if (!d || d.error) { setErr(d?.error || "план не загрузился"); return; }
    setCells(d.cells); setWays(d.ways || {});
    setNames({ src: d.sourceNames, st: d.statusNames });
    setCanEdit(d.canEdit); setIsOwner(Boolean(d.isOwner)); setErr("");
    if (opts.month) setMonth(opts.month); else setWeekStart(d.week);
  }
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function act(body: any, key: string) {
    setBusy(key); setErr("");
    try {
      const r = await fetch("/api/plan", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const d = await r.json();
      if (!r.ok || d.error) throw new Error(d.error || `ошибка ${r.status}`);
      setCells(d.cells); setWays(d.ways || ways);
    } catch (e: any) { setErr(e.message); } finally { setBusy(""); }
  }

  async function generate() {
    const m = view === "month" ? month : (weekStart || today()).slice(0, 7);
    setBusy("gen"); setErr(""); setNote("");
    try {
      const r = await fetch("/api/factory/plan-admin", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ month: m }) });
      const d = await r.json();
      if (!r.ok || d.error) throw new Error(d.error || `ошибка ${r.status}`);
      setNote(d.generated ? `Придумано тем: ${d.generated}. Пустые клетки месяца заполнены, вписанное не тронуто.` : (d.note || "Свободных клеток нет."));
      await load(view === "month" ? { month: m } : { week: weekStart });
    } catch (e: any) { setErr(e.message); } finally { setBusy(""); }
  }

  const kinds = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of cells) if (!m.has(c.slot)) m.set(c.slot, c.label);
    return [...m.entries()];
  }, [cells]);
  const byDay = useMemo(() => {
    const m = new Map<string, Cell[]>();
    for (const c of cells) m.set(c.date, [...(m.get(c.date) || []), c]);
    return [...m.entries()];
  }, [cells]);
  const k = (c: Cell) => `${c.date}|${c.slot}`;

  function openCell(c: Cell) {
    setView("week");
    const monday = shiftDays(c.date, -wd(c.date));
    load({ week: monday }).then(() => setOpen(k(c)));
  }

  const emptyText = (slot: string) => {
    const w = ways[slot];
    if (!w) return "Темы ещё нет";
    if (w.type === "order") return "Тема задаётся при заказе в боте";
    if (w.type === "manual") return "Темы нет — впишите сами";
    return `Темы нет — завод возьмёт: ${w.title.toLowerCase()}`;
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold mb-1">Контент-план</h1>
          <p className="text-sm text-gray-500 max-w-2xl">
            О чём выходят ролики: тема, откуда она и текст. Вписанная тема важнее источника — завод возьмёт её.
            Как завод работает и когда выпускает — в <a href="/factory" className="text-brand-700 hover:underline">Контент-заводе</a>.
          </p>
        </div>
        {isOwner && (
          <button className="btn btn-primary" onClick={generate} disabled={busy === "gen"}>
            {busy === "gen" ? "Придумываю…" : "✨ Заполнить пустые темы на месяц"}
          </button>
        )}
      </div>

      {kinds.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {kinds.map(([slot, label]) => ways[slot] && (
            <span key={slot} className="text-xs bg-white border rounded-lg px-2.5 py-1.5" title={ways[slot].detail}>
              <b className="font-medium">{label}</b> <span className="text-gray-400">берёт темы:</span> {ways[slot].title}
            </span>
          ))}
        </div>
      )}

      {note && <p className="text-sm text-green-800 bg-green-50 rounded-lg px-3 py-2">{note}</p>}
      {err && <p className="text-sm text-red-700 bg-red-50 rounded-lg px-3 py-2">{err}</p>}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <div className="flex gap-1 bg-white border rounded-lg p-0.5">
            {(["week", "month"] as const).map((v) => (
              <button key={v} className={`px-3 py-1 rounded-md text-sm ${view === v ? "bg-brand-600 text-white" : "text-gray-600"}`}
                onClick={() => { setView(v); v === "month" ? load({ month: (weekStart || today()).slice(0, 7) }) : load({ week: weekStart || today() }); }}>
                {v === "week" ? "Неделя" : "Месяц"}
              </button>
            ))}
          </div>
          <h2 className="font-semibold">
            {view === "month"
              ? utc(month + "-01").toLocaleDateString("ru-RU", { month: "long", year: "numeric", timeZone: "UTC" })
              : weekStart && `${fmtDay(weekStart, { day: "numeric", month: "long" })} — ${fmtDay(shiftDays(weekStart, 6), { day: "numeric", month: "long" })}`}
          </h2>
        </div>
        <div className="flex gap-1.5">
          <button className="btn btn-secondary" onClick={() => view === "month" ? load({ month: shiftMonth(month, -1) }) : load({ week: shiftDays(weekStart, -7) })}>←</button>
          <button className="btn btn-secondary" onClick={() => view === "month" ? load({ month: today().slice(0, 7) }) : load({ week: today() })}>Сейчас</button>
          <button className="btn btn-secondary" onClick={() => view === "month" ? load({ month: shiftMonth(month, 1) }) : load({ week: shiftDays(weekStart, 7) })}>→</button>
        </div>
      </div>

      {cells.length === 0 && (
        <div className="card text-sm text-gray-500">
          У проекта нет форматов по расписанию. Добавьте формат в <a href="/factory" className="text-brand-700 hover:underline">Контент-заводе</a>.
        </div>
      )}

      {view === "month" && cells.length > 0 && (
        <div className="card overflow-x-auto p-0">
          <table className="w-full text-sm border-collapse min-w-[720px]">
            <thead>
              <tr className="text-left text-gray-500 text-xs">
                <th className="p-2.5 w-24 font-medium">Дата</th>
                {kinds.map(([slot, label]) => <th key={slot} className="p-2.5 font-medium">{label}</th>)}
              </tr>
            </thead>
            <tbody>
              {byDay.map(([date, list]) => (
                <tr key={date} className={`border-t ${date === today() ? "bg-blue-50/50" : ""} ${date < today() ? "opacity-60" : ""}`}>
                  <td className="p-2.5 text-gray-500 whitespace-nowrap">{fmtDay(date, { day: "numeric" })} {SHORT[wd(date)]}</td>
                  {kinds.map(([slot]) => {
                    const c = list.find((x) => x.slot === slot);
                    if (!c) return <td key={slot} className="p-2.5 text-gray-200">—</td>;
                    return (
                      <td key={slot} className="p-1.5">
                        <button onClick={() => openCell(c)}
                          className="w-full text-left rounded-md px-2 py-1.5 hover:bg-gray-50 flex items-start gap-1.5">
                          <span className={`mt-1.5 w-1.5 h-1.5 rounded-full shrink-0 ${c.topic ? DOT[c.status] || DOT.idea : "bg-transparent border border-gray-300"}`} />
                          <span className={`line-clamp-2 ${c.topic ? "" : "text-gray-400 italic"}`}>{c.topic || "пусто"}</span>
                        </button>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {view === "week" && byDay.map(([date, list]) => (
        <div key={date} className="space-y-2">
          <div className="text-xs font-semibold uppercase tracking-wide text-gray-400">
            {DAYS[wd(date)]}, {fmtDay(date, { day: "numeric", month: "long" })}
          </div>
          {list.map((c) => {
            const key = k(c);
            const empty = !c.topic;
            const words = c.text.trim() ? c.text.trim().split(/\s+/).length : 0;
            return (
              <div key={key} className="card p-0 overflow-hidden">
                <div className="grid grid-cols-[64px_1fr] sm:grid-cols-[64px_1fr_auto] gap-3 p-3.5 items-center">
                  <div>
                    <div className="font-bold tabular-nums">{c.time || "—"}</div>
                    <div className="text-[11px] text-gray-400">{c.label}</div>
                  </div>
                  <div className="min-w-0">
                    {editing === key ? (
                      <input className="input" autoFocus value={draft} onChange={(e) => setDraft(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") { act({ action: "topic", date: c.date, slot: c.slot, topic: draft }, key); setEditing(""); }
                          if (e.key === "Escape") setEditing("");
                        }} />
                    ) : (
                      <div className={empty ? "text-gray-400 italic" : "font-semibold"}>{empty ? emptyText(c.slot) : c.topic}</div>
                    )}
                    {!empty && (
                      <div className="flex flex-wrap gap-1.5 mt-1">
                        <span className="text-[11px] px-2 py-0.5 rounded-full bg-gray-100 text-gray-700">
                          {c.source ? (names.src[c.source] || c.source) : (ways[c.slot]?.title || "источник")}
                        </span>
                        {c.status && <span className={`text-[11px] px-2 py-0.5 rounded-full ${STATUS_CLS[c.status] || ""}`}>{names.st[c.status] || c.status}</span>}
                      </div>
                    )}
                  </div>
                  {canEdit && (
                    <div className="flex flex-wrap gap-1.5 col-span-2 sm:col-span-1 sm:justify-end">
                      {editing === key ? (
                        <button className="btn btn-primary" onClick={() => { act({ action: "topic", date: c.date, slot: c.slot, topic: draft }, key); setEditing(""); }}>Сохранить</button>
                      ) : (
                        <>
                          <button className="btn btn-secondary" onClick={() => { setEditing(key); setDraft(c.topic); }}>{empty ? "Вписать тему" : "✎ Тема"}</button>
                          {!empty && <button className="btn btn-secondary" onClick={() => setOpen(open === key ? "" : key)}>{open === key ? "Скрыть текст" : "Текст"}</button>}
                          <button className="btn btn-secondary" disabled={busy === `another:${key}`}
                            onClick={() => act({ action: "another", date: c.date, slot: c.slot }, `another:${key}`)}>
                            {busy === `another:${key}` ? "Думаю…" : empty ? "Придумать" : "↻ Другая"}
                          </button>
                        </>
                      )}
                    </div>
                  )}
                </div>

                {open === key && !empty && (
                  <div className="border-t bg-slate-50/60 p-3.5 sm:pl-[88px] space-y-2">
                    {c.origin && <div className="text-xs text-gray-500 bg-white border rounded-lg px-2.5 py-1.5">{c.origin}</div>}
                    {c.text ? (
                      <>
                        <textarea className="input min-h-[150px] leading-relaxed" defaultValue={c.text} key={c.text} disabled={!canEdit}
                          onBlur={(e) => e.target.value !== c.text && act({ action: "text", date: c.date, slot: c.slot, text: e.target.value }, key)} />
                        <div className="flex flex-wrap items-center gap-2">
                          {canEdit && (
                            <button className="btn btn-secondary" disabled={busy === `write:${key}`}
                              onClick={() => act({ action: "write", date: c.date, slot: c.slot }, `write:${key}`)}>
                              {busy === `write:${key}` ? "Пишу…" : "↻ Переписать"}
                            </button>
                          )}
                          {canEdit && c.status !== "ok" && (
                            <button className="btn btn-primary" onClick={() => act({ action: "approve", date: c.date, slot: c.slot }, key)}>✓ Утвердить</button>
                          )}
                          {c.status === "ok" && (
                            <span className="text-xs text-green-800 bg-green-100 rounded-full px-2.5 py-1">
                              утверждено — завод возьмёт этот текст
                              {canEdit && <button className="ml-2 underline" onClick={() => act({ action: "unapprove", date: c.date, slot: c.slot }, key)}>снять</button>}
                            </span>
                          )}
                          <span className="ml-auto text-xs text-gray-400">{words} слов · ≈ {Math.round(words / 2.6)} с</span>
                        </div>
                      </>
                    ) : canEdit ? (
                      <div className="space-y-1.5">
                        <button className="btn btn-primary" disabled={busy === `write:${key}`}
                          onClick={() => act({ action: "write", date: c.date, slot: c.slot }, `write:${key}`)}>
                          {busy === `write:${key}` ? "Пишу…" : "Написать текст сейчас"}
                        </button>
                        <p className="text-xs text-gray-400">Можно не писать заранее — завод напишет сам перед сборкой.</p>
                      </div>
                    ) : <p className="text-sm text-gray-500">Текст ещё не написан — завод напишет перед сборкой.</p>}
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
