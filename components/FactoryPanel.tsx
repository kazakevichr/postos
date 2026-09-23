"use client";

// Пульт завода — один и тот же для любого бренда.
//
// Устройство из макета, согласованного с Романом 23.09.2026: состояние дня,
// лента «сегодня/неделя», каналы, строки форматов. В строке формата стоят
// тумблеры выдачи: бот и каждый канал отдельно.
//
// СЛОВА СОСТОЯНИЙ ОДНИ И ТЕ ЖЕ ВЕЗДЕ: авто · вручную · пауза · выкл · нельзя.
// В первой версии макета таблица говорила «вручную», а карточка формата — про
// «не подключён», и человек не мог понять, одно это состояние или два.
//
// Привычная матрица никуда не делась: она стоит под переключателем «Таблица».
import { useEffect, useState } from "react";
import RouteMatrix from "@/components/RouteMatrix";

const DAYS = ["пн", "вт", "ср", "чт", "пт", "сб", "вс"];
const ALL = [1, 2, 3, 4, 5, 6, 7];
const copy = <T,>(v: T): T => JSON.parse(JSON.stringify(v));
const mins = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));

type Slot = { days: number[]; time: string };
type Route = { ch: string; on: boolean; state: string; word: string };
type Format = {
  kind: string; label: string; note: string; mode: string;
  slots: Slot[]; when: string; week: number; next: string;
  bot: boolean | null; routes: Route[]; warn: string;
};

const STATE: Record<string, [string, string]> = {
  "план": ["ждёт завода", "bg-gray-100 text-gray-600"],
  "выдан": ["взят в работу", "bg-brand-50 text-brand-700"],
  "собирается": ["собирается", "bg-brand-50 text-brand-700"],
  "готов": ["готов, в боте", "bg-green-100 text-green-800"],
  "опубликован": ["опубликован", "bg-green-100 text-green-800"],
  "ошибка": ["ошибка", "bg-red-100 text-red-800"],
  "пропущен": ["пропущен", "bg-yellow-100 text-yellow-800"],
  "не принят": ["не принят", "bg-yellow-100 text-yellow-800"],
  "брак": ["брак", "bg-red-100 text-red-800"],
};
const CHIP: Record<string, string> = {
  auto: "bg-green-100 text-green-800 border-green-200",
  manual: "bg-yellow-50 text-yellow-800 border-yellow-200",
  pause: "bg-white text-gray-500 border-dashed border-gray-300",
  off: "bg-gray-50 text-gray-400 border-gray-200",
  locked: "bg-white text-gray-400 border-gray-200",
};

export default function FactoryPanel({ canManage = false }: { canManage?: boolean }) {
  const [data, setData] = useState<any>(null);
  const [view, setView] = useState<"rows" | "table">("rows");
  const [tab, setTab] = useState<"today" | "week">("today");
  const [openKind, setOpenKind] = useState("");
  const [draft, setDraft] = useState<{ mode: string; slots: Slot[]; bot: boolean | null } | null>(null);
  const [editCh, setEditCh] = useState("");
  const [busy, setBusy] = useState("");
  const [note, setNote] = useState("");

  async function load() {
    const r = await fetch("/api/factory/panel");
    if (r.ok) setData(await r.json());
  }
  useEffect(() => {
    load();
    // Заказы живут своей жизнью, пока страницу держат открытой.
    const t = setInterval(load, 60_000);
    return () => clearInterval(t);
  }, []);

  if (!data) return null;
  if (!data.known) {
    return (
      <div className="card mb-4 text-sm text-gray-500">
        Завод «{data.label}» публикует сам и о своих планах Постосу пока не сообщает. Журнал и кошельки видны как
        раньше; пульт появится, когда завод начнёт брать заказы.
      </div>
    );
  }

  const { channels, groups, today, now, scheduleApi } = data;
  const chan = (key: string) => channels.find((c: any) => c.key === key);
  const formats: Format[] = groups.flatMap((g: any) => g.formats);
  const fmt = (kind: string) => formats.find((f) => f.kind === kind);

  async function send(url: string, body: any, tag: string) {
    setBusy(tag);
    setNote("");
    const r = await fetch(url, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    if (j.error) setNote(j.error);
    await load();
    setBusy("");
    return !j.error;
  }

  // Производство: у MoneyBall это режим расписания, у СуперФита — тот же
  // режим в матрице маршрутов. Снаружи тумблер один.
  async function toggleProduction(f: Format) {
    const on = f.mode === "time";
    if (scheduleApi === "moneyball") {
      const rule = { mode: on ? "demand" : "time", slots: f.slots.length ? f.slots : [{ days: [...ALL], time: "12:00" }], bot: f.bot !== false };
      await send("/api/moneyball/schedule", { kind: f.kind, rule }, `f-${f.kind}`);
    } else {
      const time = f.slots[0]?.time || "08:00";
      await send("/api/factory/routes", { kind: f.kind, schedule: { mode: on ? "demand" : "time", time } }, `f-${f.kind}`);
    }
  }

  async function toggleBot(f: Format) {
    if (f.bot === null || scheduleApi !== "moneyball") return;
    await send("/api/moneyball/schedule", { kind: f.kind, rule: { mode: f.mode, slots: f.slots, bot: !f.bot } }, `b-${f.kind}`);
  }

  async function toggleRoute(f: Format, r: Route) {
    if (r.state === "locked" || scheduleApi !== "superfit") return;
    await send("/api/factory/routes", { platform: r.ch, kind: f.kind, enabled: !r.on }, `r-${f.kind}-${r.ch}`);
  }

  async function togglePause(key: string, paused: boolean) {
    if (scheduleApi !== "superfit") return;
    await send("/api/factory/routes", { platform: key, kind: "*", enabled: paused }, `p-${key}`);
  }

  const Switch = ({ on, onClick, label, tag = "" }: any) => (
    <button
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={!canManage || busy === tag}
      onClick={onClick}
      className={`relative w-9 h-5 rounded-full transition-colors shrink-0 ${on ? "bg-green-500" : "bg-gray-300"} ${canManage ? "" : "opacity-50 cursor-default"}`}
    >
      <span className={`absolute top-0.5 w-4 h-4 bg-white rounded-full transition-all ${on ? "left-4" : "left-0.5"}`} />
    </button>
  );

  // ── Сегодня: то, что уже случилось, плюс то, что ещё впереди ──────────
  const upcoming = formats.flatMap((f) =>
    f.mode === "time"
      ? f.slots
          .filter((s) => s.days.includes(now.weekday) && mins(s.time) > now.minutes)
          .map((s) => ({ at: s.time, kind: f.kind, label: f.label, state: "впереди", topic: "", error: "", seconds: 0 }))
      : []
  );
  const dayRows = [...today, ...upcoming].sort((a: any, b: any) => mins(a.at) - mins(b.at));
  const doneToday = today.filter((o: any) => ["готов", "опубликован"].includes(o.state)).length;
  const badToday = today.filter((o: any) => ["ошибка", "пропущен", "не принят", "брак"].includes(o.state)).length;
  const autoCount = channels.filter((c: any) => c.state === "auto").length;

  const Tile = ({ label, value, sub, tone = "" }: any) => (
    <div className={`rounded-xl border p-3 ${tone || "bg-white border-gray-200"}`}>
      <div className="text-[11px] uppercase tracking-wide text-gray-400">{label}</div>
      <div className="font-semibold mt-0.5">{value}</div>
      <div className="text-xs text-gray-500">{sub}</div>
    </div>
  );

  return (
    <div className="space-y-4 mb-4">
      {note && <p className="text-sm text-red-600">{note}</p>}

      <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
        <Tile
          label="Сегодня"
          value={`${doneToday} вышло${badToday ? ` · ${badToday} не вышло` : ""}`}
          sub={dayRows.length ? `всего запусков за день: ${dayRows.length}` : "запусков нет"}
          tone={badToday ? "bg-yellow-50 border-yellow-200" : ""}
        />
        <Tile label="Выдача" value={data.bot} sub="готовое приходит в бот" />
        <Tile
          label="Автопостинг"
          value={channels.length ? `${autoCount} из ${channels.length} каналов` : "каналов нет"}
          sub={channels.length ? "остальные — вручную или пауза" : "площадок у бренда пока нет"}
          tone={channels.length && autoCount < channels.length ? "bg-yellow-50 border-yellow-200" : ""}
        />
      </div>

      <div className="card">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
          <h2 className="font-semibold">Когда и что выходит</h2>
          <div className="flex gap-1 bg-gray-50 border rounded-lg p-0.5">
            {(["today", "week"] as const).map((t) => (
              <button key={t} onClick={() => setTab(t)}
                className={`px-2.5 py-1 rounded-md text-sm ${tab === t ? "bg-white shadow-sm font-medium" : "text-gray-500"}`}>
                {t === "today" ? "Сегодня" : "Неделя"}
              </button>
            ))}
          </div>
        </div>

        {tab === "today" && (
          <div className="divide-y">
            {!dayRows.length && <p className="text-sm text-gray-500">На сегодня запусков нет.</p>}
            {dayRows.map((o: any, i: number) => {
              const [word, cls] = STATE[o.state] || ["впереди", "bg-white border border-gray-200 text-gray-500"];
              return (
                <div key={`${o.at}-${o.kind}-${i}`} className="py-2 flex flex-wrap items-baseline gap-x-3 gap-y-1 text-sm">
                  <span className="font-semibold tabular-nums w-12">{o.at}</span>
                  <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${cls}`}>{word}</span>
                  <span>{o.label}</span>
                  {o.topic && <span className="text-gray-600 truncate max-w-md">{o.topic}</span>}
                  {o.seconds > 0 && <span className="text-xs text-gray-400">{Math.round(o.seconds / 60)} мин</span>}
                  {o.error && <span className="text-xs text-red-600 truncate max-w-md">{o.error}</span>}
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
                {formats.filter((f) => f.mode === "time" || f.mode === "demand").map((f) => (
                  <tr key={f.kind} className="border-t">
                    <td className="py-2 pr-3">{f.label}</td>
                    {DAYS.map((d, i) => {
                      const times = f.slots.filter((s) => s.days.includes(i + 1)).map((s) => s.time).sort();
                      return (
                        <td key={d} className={`text-center tabular-nums ${i + 1 === now.weekday ? "bg-brand-50" : ""} ${times.length ? "" : "text-gray-300"}`}>
                          {times.join(" · ") || "—"}
                        </td>
                      );
                    })}
                    <td className="text-center tabular-nums">{f.week || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="card">
        <div className="flex flex-wrap items-baseline justify-between gap-2 mb-2">
          <h2 className="font-semibold">Каналы</h2>
          <span className="text-xs text-gray-400">где публикуемся · аккаунт можно заменить, маршруты останутся</span>
        </div>
        {!channels.length ? (
          <p className="text-sm text-gray-500 border border-dashed rounded-lg p-3 bg-gray-50">
            Каналов нет: готовые ролики уходят в бот {data.bot}, выкладываете вы. Заведёте аккаунт — добавим канал,
            и Постос начнёт выкладывать сам.
          </p>
        ) : (
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {channels.map((c: any) => (
              <div key={c.key} className={`border rounded-lg p-3 ${c.paused ? "bg-white border-dashed" : "bg-gray-50"}`}>
                <div className="flex items-center justify-between gap-2">
                  <b className="text-sm">{c.title}</b>
                  <Switch on={!c.paused} tag={`p-${c.key}`} label={`Выход в канал ${c.title}`} onClick={() => togglePause(c.key, c.paused)} />
                </div>
                <div className="flex items-center gap-2 flex-wrap mt-1 text-sm">
                  <span>{c.account || "аккаунт не указан"}</span>
                  <span className={`text-[11px] px-2 py-px rounded-full border ${CHIP[c.state]}`}>{c.word}</span>
                </div>
                {c.note && <div className="text-xs text-gray-500 mt-1">{c.note}</div>}
                {canManage && (
                  <button className="text-xs text-brand-700 mt-2" onClick={() => setEditCh(editCh === c.key ? "" : c.key)}>
                    {editCh === c.key ? "свернуть" : "заменить аккаунт"}
                  </button>
                )}
                {editCh === c.key && canManage && (
                  <form
                    className="mt-2 space-y-2"
                    onSubmit={async (e) => {
                      e.preventDefault();
                      const f = new FormData(e.currentTarget as HTMLFormElement);
                      const ok = await send("/api/factory/panel", {
                        channel: c.key, account: f.get("account"), mode: f.get("mode"), note: f.get("note"),
                      }, `c-${c.key}`);
                      if (ok) setEditCh("");
                    }}
                  >
                    <input name="account" defaultValue={c.account} className="input text-sm" placeholder="имя аккаунта" />
                    <select name="mode" defaultValue={c.mode} className="input text-sm">
                      <option value="factory">выкладывает завод</option>
                      <option value="postos">выкладывает Постос</option>
                      <option value="manual">вручную из бота</option>
                    </select>
                    <input name="note" defaultValue={c.note} className="input text-sm" placeholder="заметка: что с подключением" />
                    <button className="btn btn-primary text-xs" type="submit">Сохранить канал</button>
                  </form>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="card">
        <div className="flex flex-wrap items-baseline justify-between gap-2 mb-1">
          <h2 className="font-semibold">Форматы</h2>
          <div className="flex gap-1 bg-gray-50 border rounded-lg p-0.5">
            {(["rows", "table"] as const).map((v) => (
              <button key={v} onClick={() => setView(v)}
                className={`px-2.5 py-1 rounded-md text-sm ${view === v ? "bg-white shadow-sm font-medium" : "text-gray-500"}`}>
                {v === "rows" ? "Строки" : "Таблица"}
              </button>
            ))}
          </div>
        </div>
        <p className="text-xs text-gray-400 mb-2">
          Левый тумблер — производить ли по расписанию. Дальше выдача: бот и каждый канал отдельно.
        </p>

        {view === "table" && scheduleApi === "superfit" && <RouteMatrix canManage={canManage} />}
        {view === "table" && scheduleApi !== "superfit" && (
          <p className="text-sm text-gray-500 border border-dashed rounded-lg p-3 bg-gray-50">
            Каналов у завода нет — в таблице пока только выдача в бот. Добавите канал, и он станет столбцом.
          </p>
        )}

        {view === "rows" && groups.map((g: any) => (
          <div key={g.title} className="mt-3">
            <h3 className="text-[11px] uppercase tracking-wide text-gray-400 mb-1">{g.title}</h3>
            <div className="divide-y">
              {g.formats.map((f: Format) => (
                <div key={f.kind} className="py-3 grid grid-cols-1 sm:grid-cols-[auto,1.1fr,1fr,1.3fr] gap-x-4 gap-y-2 items-start">
                  {f.mode === "time" || f.mode === "demand" ? (
                    <Switch on={f.mode === "time"} tag={`f-${f.kind}`} label={`Производить: ${f.label}`} onClick={() => toggleProduction(f)} />
                  ) : (
                    <span className="w-9" />
                  )}
                  <div>
                    <div className="font-medium">{f.label}</div>
                    <div className="text-xs text-gray-500">{f.note}</div>
                  </div>
                  <div className="text-sm">
                    <div className={f.mode === "time" ? "" : "text-gray-400"}>{f.when}</div>
                    <div className="text-xs text-gray-500">
                      {f.mode === "time"
                        ? `${f.week} в неделю${f.next ? ` · следующий: ${f.next}` : ""}`
                        : f.mode === "demand" ? "по запросу — заказов нет" : ""}
                    </div>
                    {canManage && (f.mode === "time" || f.mode === "demand") && (
                      <button
                        className="text-xs text-brand-700 mt-1"
                        onClick={() => { setOpenKind(f.kind); setDraft({ mode: f.mode, slots: copy(f.slots), bot: f.bot }); }}
                      >
                        расписание
                      </button>
                    )}
                  </div>
                  <div>
                    <div className="flex flex-wrap gap-1.5 items-center">
                      {f.bot === null ? (
                        <span className="text-[11px] px-2 py-px rounded-full border bg-brand-50 text-brand-700 border-brand-600/20">бот · всегда</span>
                      ) : (
                        <button
                          disabled={!canManage}
                          onClick={() => toggleBot(f)}
                          className={`text-[11px] px-2 py-px rounded-full border ${f.bot ? "bg-brand-50 text-brand-700 border-brand-600/20" : "bg-gray-50 text-gray-400 border-gray-200"}`}
                        >
                          бот · {f.bot ? "вкл" : "выкл"}
                        </button>
                      )}
                      {f.routes.map((r) => {
                        const c = chan(r.ch);
                        return (
                          <button
                            key={r.ch}
                            disabled={!canManage || r.state === "locked"}
                            onClick={() => toggleRoute(f, r)}
                            title={c?.title}
                            className={`text-[11px] px-2 py-px rounded-full border ${CHIP[r.state] || CHIP.off}`}
                          >
                            {(c?.title || r.ch).replace("Instagram · ", "")} · {r.word}
                          </button>
                        );
                      })}
                    </div>
                    {f.warn && <div className="text-xs text-yellow-700 mt-1">{f.warn}</div>}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* Карточка формата: расписание. Сохраняется кнопкой — каждый лишний
          запуск это лишняя платная сборка. */}
      {openKind && draft && (
        <div className="fixed inset-0 z-40">
          <div className="absolute inset-0 bg-black/30" onClick={() => { setOpenKind(""); setDraft(null); }} />
          <div className="absolute right-0 top-0 bottom-0 w-full max-w-lg bg-white shadow-xl flex flex-col">
            <div className="flex items-start justify-between gap-3 p-4 border-b">
              <div>
                <h2 className="font-semibold text-lg">{fmt(openKind)?.label}</h2>
                <p className="text-sm text-gray-500">{data.label} · когда производить</p>
              </div>
              <button className="btn btn-secondary" onClick={() => { setOpenKind(""); setDraft(null); }}>×</button>
            </div>
            <div className="p-4 space-y-3 overflow-y-auto flex-1">
              <select
                value={draft.mode}
                onChange={(e) => setDraft({ ...draft, mode: e.target.value })}
                className="border rounded-md px-2 py-1 text-sm bg-white"
              >
                <option value="time">по расписанию</option>
                <option value="demand">по запросу</option>
              </select>

              {draft.slots.map((s, i) => (
                <div key={i} className={`flex flex-wrap items-center gap-1 ${draft.mode === "time" ? "" : "opacity-50"}`}>
                  <input
                    type="time"
                    value={s.time}
                    onChange={(e) => {
                      const slots = copy(draft.slots);
                      slots[i].time = e.target.value || "00:00";
                      setDraft({ ...draft, slots });
                    }}
                    className="border rounded-md px-1.5 py-1 text-sm w-[92px]"
                  />
                  {scheduleApi === "moneyball" && DAYS.map((d, di) => {
                    const day = di + 1;
                    const on = s.days.includes(day);
                    return (
                      <button
                        key={d}
                        onClick={() => {
                          const slots = copy(draft.slots);
                          slots[i].days = on ? slots[i].days.filter((x) => x !== day) : [...slots[i].days, day].sort((a, b) => a - b);
                          setDraft({ ...draft, slots });
                        }}
                        className={`px-2 py-1 rounded-md text-xs border ${on ? "bg-brand-600 border-brand-600 text-white" : "bg-white text-gray-500"}`}
                      >
                        {d}
                      </button>
                    );
                  })}
                  {scheduleApi === "moneyball" && draft.slots.length > 1 && (
                    <button className="text-gray-400 hover:text-red-600 px-1" onClick={() => setDraft({ ...draft, slots: draft.slots.filter((_, x) => x !== i) })}>×</button>
                  )}
                </div>
              ))}

              {scheduleApi === "moneyball" ? (
                <button
                  className="text-brand-700 text-sm"
                  onClick={() => setDraft({ ...draft, slots: [...draft.slots, { days: [...ALL], time: "12:00" }] })}
                >
                  ＋ запуск
                </button>
              ) : (
                <p className="text-xs text-gray-500">
                  Завод СуперФита понимает один запуск в день и целые часы: 07:30 станет 07:00. Несколько запусков и
                  дни недели появятся, когда он перейдёт на заказы.
                </p>
              )}
            </div>
            <div className="border-t p-3 flex items-center justify-end gap-2 bg-gray-50">
              <button className="btn btn-secondary" onClick={() => { setOpenKind(""); setDraft(null); }}>Отменить</button>
              <button
                className="btn btn-primary"
                disabled={busy === `s-${openKind}`}
                onClick={async () => {
                  const ok = scheduleApi === "moneyball"
                    ? await send("/api/moneyball/schedule", { kind: openKind, rule: { mode: draft.mode, slots: draft.slots, bot: draft.bot !== false } }, `s-${openKind}`)
                    : await send("/api/factory/routes", { kind: openKind, schedule: { mode: draft.mode, time: draft.slots[0]?.time || "08:00" } }, `s-${openKind}`);
                  if (ok) { setOpenKind(""); setDraft(null); }
                }}
              >
                Сохранить
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
