"use client";

// Пульт завода MoneyBall: что выходит, когда и куда.
//
// Устройство страницы — из макета, согласованного с Романом 23.09.2026:
// сверху состояние дня, ниже лента «сегодня/неделя», потом каналы, потом
// строки форматов. В строке формата стоят ТУМБЛЕРЫ ВЫДАЧИ — бот и каждый
// канал отдельно: выдачу в бот можно выключить, оставив только площадки.
//
// Слова состояний одни и те же здесь и в карточке формата: авто · вручную ·
// пауза · выкл. Одно состояние — одно слово, иначе таблица говорит одно, а
// настройка другое (так и было в первой версии макета).
import { useEffect, useState } from "react";

type Slot = { days: number[]; time: string };
type Rule = { mode: "time" | "demand"; slots: Slot[]; bot: boolean };
type Order = { id: string; at: string; kind: string; state: string; topic: string; error: string; seconds: number };

const DAYS = ["пн", "вт", "ср", "чт", "пт", "сб", "вс"];
const ALL = [1, 2, 3, 4, 5, 6, 7];
const copy = <T,>(v: T): T => JSON.parse(JSON.stringify(v));
const mins = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));

// Состояние заказа человеческими словами. Ключи — те, что пишет lib/orders.
const STATE: Record<string, [string, string]> = {
  "план": ["ждёт завода", "bg-gray-100 text-gray-600"],
  "выдан": ["взят в работу", "bg-brand-50 text-brand-700"],
  "собирается": ["собирается", "bg-brand-50 text-brand-700"],
  "готов": ["готов, в боте", "bg-green-100 text-green-800"],
  "ошибка": ["ошибка", "bg-red-100 text-red-800"],
  "пропущен": ["пропущен", "bg-yellow-100 text-yellow-800"],
};

function daysLabel(d: number[]) {
  if (d.length === 7) return "ежедневно";
  if (d.join() === "1,2,3,4,5") return "пн–пт";
  return d.map((x) => DAYS[x - 1]).join(", ");
}

export default function MoneyballPanel({ canManage = false }: { canManage?: boolean }) {
  const [data, setData] = useState<any>(null);
  const [draft, setDraft] = useState<Record<string, Rule>>({});
  const [openKind, setOpenKind] = useState<string>("");
  const [tab, setTab] = useState<"today" | "week">("today");
  const [busy, setBusy] = useState("");
  const [note, setNote] = useState("");

  async function load() {
    const r = await fetch("/api/moneyball/panel");
    if (!r.ok) return;
    const j = await r.json();
    setData(j);
    setDraft(copy(j.schedule));
  }
  useEffect(() => {
    load();
    // Заказы живут своей жизнью: страницу держат открытой, а завод в это
    // время берёт работу и отчитывается.
    const t = setInterval(load, 60_000);
    return () => clearInterval(t);
  }, []);

  if (!data) return null;
  const { formats, schedule, labels, orders, now } = data;

  const rule = (kind: string): Rule => draft[kind] || schedule[kind];
  const dirty = (kind: string) => JSON.stringify(draft[kind]) !== JSON.stringify(schedule[kind]);
  const edit = (kind: string, fn: (r: Rule) => void) =>
    setDraft((d) => {
      const r = copy(d[kind]);
      fn(r);
      return { ...d, [kind]: r };
    });

  async function save(kind: string, rule?: Rule) {
    setBusy(kind);
    setNote("");
    const r = await fetch("/api/moneyball/schedule", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ kind, rule: rule || draft[kind] }),
    });
    const j = await r.json().catch(() => ({}));
    if (j.schedule) {
      setData((d: any) => ({ ...d, schedule: j.schedule, labels: j.labels }));
      setDraft(copy(j.schedule));
    } else {
      setNote(j.error || "не получилось сохранить");
    }
    setBusy("");
  }

  // Сколько запусков в неделю и когда ближайший — по московскому «сейчас»,
  // которое посчитал сервер.
  const perWeek = (r: Rule) => (r.mode === "time" ? r.slots.reduce((n, s) => n + s.days.length, 0) : 0);
  function nextRun(r: Rule) {
    if (r.mode !== "time") return "";
    for (let add = 0; add < 8; add++) {
      const day = ((now.weekday - 1 + add) % 7) + 1;
      let best = "";
      for (const s of r.slots) {
        if (!s.days.includes(day)) continue;
        if (add === 0 && mins(s.time) <= now.minutes) continue;
        if (!best || mins(s.time) < mins(best)) best = s.time;
      }
      if (best) return `${add === 0 ? "сегодня" : add === 1 ? "завтра" : DAYS[day - 1]} ${best}`;
    }
    return "";
  }

  const done = orders.filter((o: Order) => o.state === "готов").length;
  const running = orders.filter((o: Order) => ["выдан", "собирается"].includes(o.state)).length;
  const failed = orders.filter((o: Order) => ["ошибка", "пропущен"].includes(o.state)).length;

  const Tile = ({ label, value, sub, tone = "" }: any) => (
    <div className={`rounded-xl border p-3 ${tone || "bg-white border-gray-200"}`}>
      <div className="text-[11px] uppercase tracking-wide text-gray-400">{label}</div>
      <div className="font-semibold mt-0.5">{value}</div>
      <div className="text-xs text-gray-500">{sub}</div>
    </div>
  );

  const Switch = ({ on, onClick, label }: any) => (
    <button
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={!canManage}
      onClick={onClick}
      className={`relative w-9 h-5 rounded-full transition-colors shrink-0 ${on ? "bg-green-500" : "bg-gray-300"} ${canManage ? "" : "opacity-50 cursor-default"}`}
    >
      <span className={`absolute top-0.5 w-4 h-4 bg-white rounded-full transition-all ${on ? "left-4" : "left-0.5"}`} />
    </button>
  );

  // ── Сегодня и неделя ──────────────────────────────────────────────────
  const upcoming = formats.flatMap((f: any) => {
    const r = rule(f.kind);
    if (r.mode !== "time") return [];
    return r.slots
      .filter((s) => s.days.includes(now.weekday) && mins(s.time) > now.minutes)
      .map((s) => ({ at: s.time, kind: f.kind, state: "впереди", topic: "", error: "", seconds: 0, id: `n-${f.kind}-${s.time}` }));
  });
  const dayRows = [...orders, ...upcoming].sort((a: any, b: any) => mins(a.at) - mins(b.at));
  const labelOf = (kind: string) => formats.find((f: any) => f.kind === kind)?.label || kind;

  return (
    <div className="space-y-4 mb-4">
      {note && <p className="text-sm text-red-600">{note}</p>}

      <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
        <Tile
          label="Сегодня"
          value={`${done} готово${running ? ` · ${running} собирается` : ""}`}
          sub={failed ? `${failed} не вышло` : "сбоев нет"}
          tone={failed ? "bg-yellow-50 border-yellow-200" : ""}
        />
        <Tile label="Выдача" value={data.bot} sub="каждый готовый ролик приходит сюда" />
        <Tile label="Каналы" value="нет" sub="площадок у бренда пока нет — выкладываете вы" />
      </div>

      <div className="card">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
          <h2 className="font-semibold">Когда и что выходит</h2>
          <div className="flex gap-1 bg-gray-50 border rounded-lg p-0.5">
            {(["today", "week"] as const).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`px-2.5 py-1 rounded-md text-sm ${tab === t ? "bg-white shadow-sm font-medium" : "text-gray-500"}`}
              >
                {t === "today" ? "Сегодня" : "Неделя"}
              </button>
            ))}
          </div>
        </div>

        {tab === "today" && (
          <div className="divide-y">
            {!dayRows.length && <p className="text-sm text-gray-500">На сегодня запусков нет.</p>}
            {dayRows.map((o: any) => {
              const [word, cls] = STATE[o.state] || ["впереди", "bg-white border border-gray-200 text-gray-500"];
              return (
                <div key={o.id} className="py-2 flex flex-wrap items-baseline gap-x-3 gap-y-1 text-sm">
                  <span className="font-semibold tabular-nums w-12">{o.at}</span>
                  <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${cls}`}>{word}</span>
                  <span>{labelOf(o.kind)}</span>
                  {o.topic && <span className="text-gray-600 truncate max-w-md">{o.topic}</span>}
                  {o.seconds > 0 && <span className="text-xs text-gray-400">{Math.round(o.seconds / 60)} мин</span>}
                  {o.error && <span className="text-xs text-red-600">{o.error}</span>}
                </div>
              );
            })}
          </div>
        )}

        {tab === "week" && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[560px]">
              <thead>
                <tr className="text-gray-500">
                  <th className="text-left font-normal py-1">Формат</th>
                  {DAYS.map((d, i) => (
                    <th key={d} className={`font-normal py-1 ${i + 1 === now.weekday ? "text-brand-700 font-semibold" : ""}`}>{d}</th>
                  ))}
                  <th className="font-normal py-1">в неделю</th>
                </tr>
              </thead>
              <tbody>
                {formats.map((f: any) => {
                  const r = rule(f.kind);
                  return (
                    <tr key={f.kind} className="border-t">
                      <td className="py-2 pr-3">{f.label}</td>
                      {DAYS.map((d, i) => {
                        const times = r.mode === "time"
                          ? r.slots.filter((s) => s.days.includes(i + 1)).map((s) => s.time).sort()
                          : [];
                        return (
                          <td key={d} className={`text-center tabular-nums ${i + 1 === now.weekday ? "bg-brand-50" : ""} ${times.length ? "" : "text-gray-300"}`}>
                            {times.join(" · ") || "—"}
                          </td>
                        );
                      })}
                      <td className="text-center tabular-nums">{perWeek(r) || "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="card">
        <div className="flex flex-wrap items-baseline justify-between gap-2 mb-2">
          <h2 className="font-semibold">Каналы</h2>
          <span className="text-xs text-gray-400">где публикуемся</span>
        </div>
        <p className="text-sm text-gray-500 border border-dashed rounded-lg p-3 bg-gray-50">
          Каналов нет: готовые ролики уходят в бот {data.bot}, выкладываете вы. Когда заведёте аккаунт и подключите
          его, здесь появится канал, и Постос начнёт выкладывать сам.
        </p>
      </div>

      <div className="card">
        <div className="flex flex-wrap items-baseline justify-between gap-2 mb-1">
          <h2 className="font-semibold">Форматы</h2>
          <span className="text-xs text-gray-400">время московское · старт сборки</span>
        </div>
        <p className="text-xs text-gray-400 mb-2">
          Левый тумблер — производить ли по расписанию. Правый — отдавать ли готовое в бот. Нажмите строку, чтобы
          поменять расписание.
        </p>
        <div className="divide-y">
          {formats.map((f: any) => {
            const r = rule(f.kind);
            const saved = schedule[f.kind];
            const on = saved.mode === "time";
            const nothing = !saved.bot;
            return (
              <div key={f.kind} className="py-3 grid grid-cols-1 sm:grid-cols-[auto,1fr,1fr,auto] gap-x-4 gap-y-2 items-start">
                <Switch
                  on={on}
                  label={`Производить: ${f.label}`}
                  onClick={() => save(f.kind, { ...saved, mode: on ? "demand" : "time" })}
                />
                <div>
                  <div className="font-medium">{f.label}</div>
                  <div className="text-xs text-gray-500">
                    {f.fromPlan ? "тема из плана, без неё завод ищет сам" : "тему находит завод"}
                  </div>
                </div>
                <div className="text-sm">
                  <div className={on ? "" : "text-gray-400"}>{labels[f.kind]}</div>
                  <div className="text-xs text-gray-500">
                    {on ? `${perWeek(saved)} в неделю · следующий: ${nextRun(saved) || "—"}` : "по запросу — заказов нет"}
                  </div>
                  {nothing && on && (
                    <div className="text-xs text-yellow-700">выдача выключена, а каналов нет — ролик будет некуда отдать</div>
                  )}
                </div>
                <div className="flex items-center gap-2 justify-end">
                  <span className={`text-xs ${saved.bot ? "text-brand-700" : "text-gray-400"}`}>бот</span>
                  <Switch
                    on={saved.bot}
                    label={`Выдача в бот: ${f.label}`}
                    onClick={() => save(f.kind, { ...saved, bot: !saved.bot })}
                  />
                  <button className="btn btn-secondary text-xs" onClick={() => setOpenKind(f.kind)}>
                    Расписание
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Карточка формата: редактор расписания. Сохраняется кнопкой — каждый
          лишний запуск это лишняя платная сборка. */}
      {openKind && (
        <div className="fixed inset-0 z-40">
          <div className="absolute inset-0 bg-black/30" onClick={() => { setDraft(copy(schedule)); setOpenKind(""); }} />
          <div className="absolute right-0 top-0 bottom-0 w-full max-w-lg bg-white shadow-xl flex flex-col">
            <div className="flex items-start justify-between gap-3 p-4 border-b">
              <div>
                <h2 className="font-semibold text-lg">{labelOf(openKind)}</h2>
                <p className="text-sm text-gray-500">MoneyBall · когда производить</p>
              </div>
              <button className="btn btn-secondary" onClick={() => { setDraft(copy(schedule)); setOpenKind(""); }}>×</button>
            </div>

            <div className="p-4 space-y-3 overflow-y-auto flex-1">
              <div className="flex items-center gap-2 text-sm">
                <select
                  disabled={!canManage}
                  value={rule(openKind).mode}
                  onChange={(e) => edit(openKind, (r) => { r.mode = e.target.value as Rule["mode"]; })}
                  className="border rounded-md px-2 py-1 text-sm bg-white"
                >
                  <option value="time">по расписанию</option>
                  <option value="demand">по запросу</option>
                </select>
                <span className="text-gray-500 text-xs">время московское, старт сборки</span>
              </div>

              {rule(openKind).slots.map((s, i) => (
                <div key={i} className={`flex flex-wrap items-center gap-1 ${rule(openKind).mode === "time" ? "" : "opacity-50"}`}>
                  <input
                    type="time"
                    disabled={!canManage}
                    value={s.time}
                    onChange={(e) => edit(openKind, (r) => { r.slots[i].time = e.target.value || "00:00"; })}
                    className="border rounded-md px-1.5 py-1 text-sm w-[92px]"
                  />
                  {DAYS.map((d, di) => {
                    const day = di + 1;
                    const active = s.days.includes(day);
                    return (
                      <button
                        key={d}
                        disabled={!canManage}
                        onClick={() => edit(openKind, (r) => {
                          const days = r.slots[i].days;
                          r.slots[i].days = active ? days.filter((x) => x !== day) : [...days, day].sort((a, b) => a - b);
                        })}
                        className={`px-2 py-1 rounded-md text-xs border ${active ? "bg-brand-600 border-brand-600 text-white" : "bg-white text-gray-500"}`}
                      >
                        {d}
                      </button>
                    );
                  })}
                  {canManage && (
                    <button
                      className="text-gray-400 hover:text-red-600 px-1"
                      title="Убрать запуск"
                      onClick={() => edit(openKind, (r) => { r.slots.splice(i, 1); })}
                    >
                      ×
                    </button>
                  )}
                </div>
              ))}

              {canManage && (
                <button
                  className="text-brand-700 text-sm"
                  onClick={() => edit(openKind, (r) => { r.slots.push({ days: [...ALL], time: "12:00" }); })}
                >
                  ＋ запуск
                </button>
              )}

              <div className="border-t pt-3 flex items-center justify-between gap-3">
                <div className="text-sm">
                  <div>Выдача в телеграм-бот</div>
                  <div className="text-xs text-gray-500">
                    {rule(openKind).bot ? `ролик, подпись и обложки приходят в ${data.bot}` : "в бот не отправляем"}
                  </div>
                </div>
                <Switch
                  on={rule(openKind).bot}
                  label="Выдача в бот"
                  onClick={() => edit(openKind, (r) => { r.bot = !r.bot; })}
                />
              </div>
            </div>

            {dirty(openKind) && canManage && (
              <div className="border-t p-3 flex items-center justify-between gap-2 bg-gray-50">
                <span className="text-sm text-gray-600 tabular-nums">
                  было {perWeek(schedule[openKind])} в неделю → станет {perWeek(rule(openKind))}
                </span>
                <span className="flex gap-2">
                  <button className="btn btn-secondary" onClick={() => setDraft(copy(schedule))}>Отменить</button>
                  <button className="btn btn-primary" disabled={busy === openKind} onClick={() => save(openKind)}>
                    {busy === openKind ? "Сохраняю…" : "Сохранить"}
                  </button>
                </span>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
