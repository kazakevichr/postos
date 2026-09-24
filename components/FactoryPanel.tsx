"use client";

// Пульт завода — один и тот же для любого бренда.
//
// Правило, ради которого он переписан (замечание Романа 23.09.2026): НАБОР
// БЛОКОВ И ТУМБЛЕРОВ ОДИНАКОВЫЙ ВЕЗДЕ. То, чего завод ещё не умеет, стоит на
// месте с пометкой «пока не подключено», а не прячется: спрятанная настройка
// выглядит как её отсутствие, и человек не понимает, панель разная или заводы.
//
// Слова состояний одни и те же в строке, в таблице и в карточке формата:
// авто · вручную · пауза · выкл · нельзя.
import { useEffect, useState } from "react";

const DAYS = ["пн", "вт", "ср", "чт", "пт", "сб", "вс"];
const ALL = [1, 2, 3, 4, 5, 6, 7];
const copy = <T,>(v: T): T => JSON.parse(JSON.stringify(v));
const mins = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));

type Slot = { days: number[]; time: string };
type Route = { ch: string; on: boolean; state: string; word: string };
type Format = {
  kind: string; label: string; note: string; mode: string;
  slots: Slot[]; when: string; week: number; next: string; publish: string;
  bot: boolean; approval: boolean; off: boolean;
  routes: Route[]; warn: string; canSchedule: boolean; canProduce: boolean;
};

const STATE: Record<string, [string, string]> = {
  "план": ["ждёт завода", "bg-gray-100 text-gray-600"],
  "выдан": ["взят в работу", "bg-brand-50 text-brand-700"],
  "собирается": ["собирается", "bg-brand-50 text-brand-700"],
  "на согласовании": ["ждёт вашего «да»", "bg-yellow-100 text-yellow-800"],
  "отклонён": ["текст не принят", "bg-gray-100 text-gray-600"],
  "готов": ["готов, в боте", "bg-green-100 text-green-800"],
  "опубликован": ["опубликован", "bg-green-100 text-green-800"],
  "ошибка": ["ошибка", "bg-red-100 text-red-800"],
  "пропущен": ["пропущен", "bg-yellow-100 text-yellow-800"],
  "не принят": ["не принят", "bg-yellow-100 text-yellow-800"],
  "брак": ["брак", "bg-red-100 text-red-800"],
};
const UPCOMING: Record<string, string> = {
  "впереди": "bg-white border border-gray-200 text-gray-500",
  "не выйдет": "bg-yellow-50 text-yellow-800 border border-yellow-200",
};
const CHIP: Record<string, string> = {
  auto: "bg-green-100 text-green-800 border-green-200",
  manual: "bg-yellow-50 text-yellow-800 border-yellow-200",
  pause: "bg-white text-gray-500 border-gray-300 border-dashed",
  off: "bg-gray-50 text-gray-400 border-gray-200",
  locked: "bg-white text-gray-400 border-gray-200",
  bot: "bg-brand-50 text-brand-700 border-brand-600/20",
};

export default function FactoryPanel({ canManage = false }: { canManage?: boolean }) {
  const [data, setData] = useState<any>(null);
  const [view, setView] = useState<"rows" | "table">("rows");
  const [tab, setTab] = useState<"today" | "week">("today");
  const [openKind, setOpenKind] = useState("");
  const [draft, setDraft] = useState<{ mode: string; slots: Slot[] } | null>(null);
  const [editCh, setEditCh] = useState("");
  const [addCh, setAddCh] = useState(false);
  const [showArchive, setShowArchive] = useState(false);
  const [openScript, setOpenScript] = useState("");
  const [busy, setBusy] = useState("");
  const [note, setNote] = useState("");

  async function load() {
    const r = await fetch("/api/factory/panel");
    if (r.ok) setData(await r.json());
  }
  useEffect(() => {
    load();
    const t = setInterval(load, 60_000); // заказы живут своей жизнью
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

  const { channels, archived, groups, today, now, caps } = data;
  // Чего этот завод пока не слушается. Пустая строка — слушается, и тумблер
  // обычный; текст — причина, по которой он заперт.
  const botLock: string = caps?.botToggle === "pending" ? caps.botNote : "";
  const approvalLock = (f: Format): string =>
    caps?.approvalToggle === "pending" ? caps.approvalNote
    : (caps?.approvalKinds && !caps.approvalKinds.includes(f.kind))
      ? `формат «${f.label}» пока не умеет согласование: завод соберёт сразу`
      : "";
  const chan = (key: string) => channels.find((c: any) => c.key === key);
  const formats: Format[] = groups.flatMap((g: any) => g.formats);
  const fmt = (kind: string) => formats.find((f) => f.kind === kind);

  async function put(body: any, tag: string, url = "/api/factory/panel") {
    setBusy(tag);
    setNote("");
    const r = await fetch(url, {
      method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
    });
    const j = await r.json().catch(() => ({}));
    if (j.error) { setNote(j.error); setBusy(""); return false; }
    setData(j);
    setBusy("");
    return true;
  }

  async function saveSchedule(kind: string, mode: string, slots: Slot[]) {
    return put({ kind, rule: { mode, slots } }, `s-${kind}`, "/api/factory/schedule");
  }

  async function togglePublish(kind: string, mode: string, at: string) {
    setBusy(`p-${kind}`);
    const r = await fetch("/api/factory/routes", {
      method: "PUT", headers: { "content-type": "application/json" },
      body: JSON.stringify({ kind, publish: { mode, at } }),
    });
    const j = await r.json().catch(() => ({}));
    if (j.error) setNote(j.error);
    await load();
    setBusy("");
  }

  async function toggleRoute(f: Format, r: Route) {
    if (r.state === "locked" || !caps?.routes) return;
    setBusy(`r-${f.kind}-${r.ch}`);
    await fetch("/api/factory/routes", {
      method: "PUT", headers: { "content-type": "application/json" },
      body: JSON.stringify({ platform: r.ch, kind: f.kind, enabled: !r.on }),
    });
    await load();
    setBusy("");
  }

  async function togglePause(key: string, paused: boolean) {
    // У СуперФита пауза живёт в матрице маршрутов: завод спрашивает именно её,
    // и второе хранилище означало бы экран, который врёт. У остальных заводов
    // матрицы нет — там пауза стоит на самом канале.
    if (!caps?.routes) return put({ channel: key, paused: !paused }, `ch-${key}`);
    setBusy(`ch-${key}`);
    await fetch("/api/factory/routes", {
      method: "PUT", headers: { "content-type": "application/json" },
      body: JSON.stringify({ platform: key, kind: "*", enabled: paused }),
    });
    await load();
    setBusy("");
  }

  function toggleProduction(f: Format) {
    if (f.mode === "event") return put({ format: f.kind, off: !f.off }, `f-${f.kind}`);
    if (!f.canProduce) return;
    const on = f.mode === "time";
    const slots = f.slots.length ? f.slots : [{ days: [...ALL], time: "12:00" }];
    return saveSchedule(f.kind, on ? "demand" : "time", slots);
  }

  // lock — настройка, которой этот завод пока не слушается. Такой тумблер не
  // притворяется рабочим: он выключен и говорит почему. Правило Романа
  // 24.09.2026: «чтобы среди тумблеров не было бутафории».
  const Switch = ({ on, onClick, label, tag = "", dim = false, lock = "" }: any) => (
    <button
      role="switch" aria-checked={lock ? false : on} aria-label={label}
      disabled={!canManage || busy === tag || Boolean(lock)}
      title={lock || undefined}
      onClick={(e) => { e.stopPropagation(); if (!lock) onClick?.(); }}
      className={`relative w-9 h-5 rounded-full transition-colors shrink-0 ${lock ? "bg-gray-200 ring-1 ring-dashed ring-gray-300" : on ? (dim ? "bg-green-300" : "bg-green-500") : "bg-gray-300"} ${canManage && !lock ? "" : "opacity-50 cursor-default"}`}
    >
      <span className={`absolute top-0.5 w-4 h-4 bg-white rounded-full transition-all ${on && !lock ? "left-4" : "left-0.5"}`} />
    </button>
  );

  // Что ещё впереди сегодня. Формат, которому некуда выйти, честно помечаем
  // «не выйдет»: заказ на него Постос не заведёт, и обещать запуск нельзя.
  const upcoming = formats.flatMap((f) =>
    f.mode === "time"
      ? f.slots.filter((s) => s.days.includes(now.weekday) && mins(s.time) > now.minutes)
          .map((s) => ({
            at: s.time, kind: f.kind, label: f.label,
            state: f.warn ? "не выйдет" : "впереди", error: f.warn || "", topic: "", seconds: 0,
          }))
      : []
  );
  const dayRows = [...today, ...upcoming].sort((a: any, b: any) => mins(a.at) - mins(b.at));
  const doneToday = today.filter((o: any) => ["готов", "опубликован"].includes(o.state)).length;
  const badToday = today.filter((o: any) => ["ошибка", "пропущен", "не принят", "брак"].includes(o.state)).length;
  const autoCount = channels.filter((c: any) => c.state === "auto").length;

  return (
    <div className="space-y-4 mb-4">
      {note && <p className="text-sm text-red-600">{note}</p>}

      {/* Кто решает, когда производить — блок есть у всех заводов. */}
      <div className="card flex flex-wrap items-center justify-between gap-3 py-3">
        <div>
          <div className="font-medium text-sm">Кто решает, когда производить</div>
          <div className="text-xs text-gray-500">
            {data.orders
              ? "Постос: в назначенное время он заводит заказ, завод его забирает"
              : "завод сам, по расписанию, которое получает отсюда"}
          </div>
          <div className="text-xs text-gray-400 mt-0.5">
            {data.ordersSwitchable
              ? "переключается в два действия: этот тумблер и ORDERS=1 в .env завода"
              : "у этого завода выбора нет: он построен только под заказы"}
          </div>
        </div>
        <div className="flex items-center gap-2 text-sm">
          <span className={data.orders ? "text-gray-400" : ""}>завод</span>
          {data.ordersSwitchable ? (
            <Switch on={data.orders} tag="orders" label="Заказы из Постоса"
              onClick={() => put({ orders: !data.orders }, "orders")} />
          ) : (
            <Switch on dim label="Заказы из Постоса" />
          )}
          <span className={data.orders ? "" : "text-gray-400"}>Постос</span>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className={`rounded-xl border p-3 ${badToday ? "bg-yellow-50 border-yellow-200" : "bg-white border-gray-200"}`}>
          <div className="text-[11px] uppercase tracking-wide text-gray-400">Сегодня</div>
          <div className="font-semibold mt-0.5">{doneToday} вышло{badToday ? ` · ${badToday} не вышло` : ""}</div>
          <div className="text-xs text-gray-500">всего запусков за день: {dayRows.length}</div>
        </div>

        {/* Выдача в бот — общий рубильник завода. */}
        <div className={`rounded-xl border p-3 ${data.botOn ? "bg-white border-gray-200" : "bg-gray-50 border-gray-200"}`}>
          <div className="flex items-center justify-between gap-2">
            <div className="text-[11px] uppercase tracking-wide text-gray-400">Выдача в бот</div>
            <Switch on={data.botOn} tag="brandBot" label="Выдача в бот" lock={botLock}
              onClick={() => put({ brandBot: !data.botOn }, "brandBot")} />
          </div>
          <div className="font-semibold mt-0.5 truncate">{data.bot}</div>
          <div className="text-xs text-gray-500">
            {botLock ? botLock : data.botOn ? "готовое приходит в бот" : "выключено: в бот ничего не уходит"}
          </div>
        </div>

        <div className={`rounded-xl border p-3 ${channels.length && autoCount < channels.length ? "bg-yellow-50 border-yellow-200" : "bg-white border-gray-200"}`}>
          <div className="text-[11px] uppercase tracking-wide text-gray-400">Автопостинг</div>
          <div className="font-semibold mt-0.5">
            {channels.length ? `${autoCount} из ${channels.length} каналов` : "каналов нет"}
          </div>
          <div className="text-xs text-gray-500">
            {channels.length ? `выкладывает ${caps?.publisher || "машина"}; остальные — вручную или пауза` : "площадок у бренда пока нет"}
          </div>
        </div>
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
              const [word, cls] = STATE[o.state] || [o.state, UPCOMING[o.state] || UPCOMING["впереди"]];
              return (
                <div key={`${o.at}-${o.kind}-${i}`} className="py-2 flex flex-wrap items-baseline gap-x-3 gap-y-1 text-sm">
                  <span className="font-semibold tabular-nums w-12">{o.at}</span>
                  <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${cls}`}>{word}</span>
                  <span>{o.label}</span>
                  {o.topic && <span className="text-gray-600 truncate max-w-md">{o.topic}</span>}
                  {o.seconds > 0 && <span className="text-xs text-gray-400">{Math.round(o.seconds / 60)} мин</span>}
                  {o.error && <span className="text-xs text-red-600 truncate max-w-md">{o.error}</span>}
                  {o.state === "на согласовании" && (
                    <div className="basis-full mt-1">
                      <button className="text-xs text-brand-700"
                        onClick={() => setOpenScript(openScript === o.id ? "" : o.id)}>
                        {openScript === o.id ? "свернуть текст" : "прочитать текст"}
                      </button>
                      {openScript === o.id && (
                        <pre className="mt-1 whitespace-pre-wrap text-xs bg-gray-50 border rounded-lg p-2 max-h-72 overflow-y-auto">
                          {o.script || "текст не пришёл"}
                        </pre>
                      )}
                      {canManage && (
                        <div className="flex gap-2 mt-2">
                          <button className="btn btn-primary text-xs" disabled={busy === `d-${o.id}`}
                            onClick={() => put({ decide: o.id, ok: true }, `d-${o.id}`)}>
                            Собрать
                          </button>
                          <button className="btn btn-secondary text-xs" disabled={busy === `d-${o.id}`}
                            onClick={() => put({ decide: o.id, ok: false, other: true }, `d-${o.id}`)}>
                            Другие матчи
                          </button>
                          <button className="btn btn-secondary text-xs" disabled={busy === `d-${o.id}`}
                            onClick={() => put({ decide: o.id, ok: false }, `d-${o.id}`)}>
                            Отклонить
                          </button>
                          <span className="text-xs text-gray-500 self-center">
                            «Другие матчи» — эти откладываются, завод сразу берётся за новый текст
                          </span>
                        </div>
                      )}
                    </div>
                  )}
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
                {formats.filter((f) => f.canSchedule).map((f) => (
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

      {/* ── Каналы ─────────────────────────────────────────────────────── */}
      <div className="card">
        <div className="flex flex-wrap items-baseline justify-between gap-2 mb-2">
          <h2 className="font-semibold">Каналы</h2>
          <span className="text-xs text-gray-400">аккаунт можно заменить или убрать в архив — маршруты останутся</span>
        </div>

        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {channels.map((c: any) => (
            <div key={c.key} className={`border rounded-lg p-3 ${c.paused ? "bg-white border-dashed" : "bg-gray-50"}`}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <b className="text-sm">{c.title}</b>
                  <div className="text-sm text-gray-600 truncate">{c.account || "аккаунт не указан"}</div>
                </div>
                <span className={`text-[11px] px-2 py-px rounded-full border shrink-0 ${CHIP[c.state]}`}>{c.word}</span>
              </div>

              {/* Два разных вопроса, и подпись у каждого читается как ответ:
                  выпускаем ли мы сюда вообще — и кто нажимает «опубликовать».
                  Раньше рядом с выключенным тумблером стояло «аккаунт
                  подключён», и было непонятно, это состояние или название. */}
              <div className="mt-2 divide-y border-y">
                <div className="flex items-center justify-between gap-2 py-1.5">
                  <div className="text-xs">
                    <div className="text-gray-800">{c.paused ? "Выход закрыт" : "Выход открыт"}</div>
                    <div className="text-gray-500">
                      {c.paused ? "сюда ничего не уходит" : "ролики для этого канала выпускаем"}
                    </div>
                  </div>
                  <Switch on={!c.paused} tag={`ch-${c.key}`} label={`Выход в канал ${c.title}`}
                    onClick={() => togglePause(c.key, c.paused)} />
                </div>
                <div className="flex items-center justify-between gap-2 py-1.5">
                  <div className="text-xs">
                    <div className="text-gray-800">
                      {c.mode === "manual" ? "Аккаунт не подключён" : "Аккаунт подключён"}
                    </div>
                    <div className="text-gray-500">
                      {c.mode === "manual"
                        ? "ролик приходит в бот, выкладываете вы"
                        : `выкладывает ${caps?.publisher || "машина"}`}
                    </div>
                  </div>
                  <Switch on={c.mode !== "manual"} tag={`conn-${c.key}`}
                    label={`Аккаунт подключён: ${c.title}`}
                    onClick={() => put({ channel: c.key, connected: c.mode === "manual" }, `conn-${c.key}`)} />
                </div>
              </div>
              {c.note && <div className="text-xs text-gray-500 mt-1">{c.note}</div>}

              {canManage && (
                <div className="flex flex-wrap items-center gap-3 mt-2">
                  <button className="text-xs text-brand-700" onClick={() => setEditCh(editCh === c.key ? "" : c.key)}>
                    {editCh === c.key ? "свернуть" : "заменить аккаунт"}
                  </button>
                  <button className="text-xs text-gray-500 hover:text-red-600"
                    onClick={() => put({ channel: c.key, archived: true }, `arch-${c.key}`)}>
                    в архив
                  </button>
                </div>
              )}

              {editCh === c.key && canManage && (
                <form
                  className="mt-2 flex flex-wrap gap-2"
                  onSubmit={async (e) => {
                    e.preventDefault();
                    const f = new FormData(e.currentTarget as HTMLFormElement);
                    if (await put({ channel: c.key, account: f.get("account") }, `c-${c.key}`)) setEditCh("");
                  }}
                >
                  <input name="account" defaultValue={c.account} className="input text-sm" placeholder="имя нового аккаунта" />
                  <button className="btn btn-primary text-xs" type="submit">Заменить</button>
                  <p className="text-xs text-gray-500 basis-full">
                    Новый аккаунт считается неподключённым: ролики будут приходить в бот, пока вы не отметите
                    подключение.
                  </p>
                </form>
              )}
            </div>
          ))}

          {!channels.length && (
            <p className="text-sm text-gray-500 border border-dashed rounded-lg p-3 bg-gray-50 sm:col-span-2 lg:col-span-3">
              Каналов нет: готовые ролики уходят в бот {data.bot}, выкладываете вы.
            </p>
          )}
        </div>

        {canManage && (
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <button className="btn btn-secondary text-sm" onClick={() => setAddCh(!addCh)}>
              {addCh ? "Отменить" : "＋ Добавить канал"}
            </button>
            {archived.length > 0 && (
              <button className="text-sm text-gray-500" onClick={() => setShowArchive(!showArchive)}>
                Архив ({archived.length})
              </button>
            )}
          </div>
        )}

        {addCh && canManage && (
          <form
            className="mt-3 flex flex-wrap gap-2 items-start"
            onSubmit={async (e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget as HTMLFormElement);
              const ok = await put({ newChannel: { title: f.get("title"), net: f.get("net"), account: f.get("account") } }, "newCh");
              if (ok) setAddCh(false);
            }}
          >
            <input name="title" className="input text-sm max-w-[220px]" placeholder="название, например Instagram · новый" />
            <select name="net" className="input text-sm max-w-[140px]" defaultValue="IG">
              <option value="IG">Instagram</option>
              <option value="YT">YouTube</option>
              <option value="TT">TikTok</option>
              <option value="TG">Telegram</option>
            </select>
            <input name="account" className="input text-sm max-w-[200px]" placeholder="имя аккаунта" />
            <button className="btn btn-primary text-sm" type="submit">Добавить</button>
            <p className="text-xs text-gray-500 basis-full">
              Новый канал появляется неподключённым: ролики идут в бот, пока вы не отметите подключение.
            </p>
          </form>
        )}

        {showArchive && archived.length > 0 && (
          <div className="mt-3 border-t pt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {archived.map((c: any) => (
              <div key={c.key} className="border rounded-lg p-3 bg-white text-sm">
                <div className="flex items-center justify-between gap-2">
                  <b>{c.title}</b>
                  <span className="text-[11px] px-2 py-px rounded-full border bg-gray-50 text-gray-500">в архиве</span>
                </div>
                <div className="text-gray-600">{c.account}</div>
                {canManage && (
                  <button className="text-xs text-brand-700 mt-1"
                    onClick={() => put({ channel: c.key, archived: false }, `un-${c.key}`)}>
                    вернуть из архива
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Форматы ────────────────────────────────────────────────────── */}
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
          Левый тумблер — производить ли. Дальше выдача: бот и каждый канал отдельно. Нажмите строку — откроется
          карточка формата со всеми настройками.
        </p>

        {view === "rows" && groups.map((g: any) => (
          <div key={g.title} className="mt-3">
            <h3 className="text-[11px] uppercase tracking-wide text-gray-400 mb-1">{g.title}</h3>
            <div className="divide-y">
              {g.formats.map((f: Format) => {
                const on = f.mode === "event" ? !f.off : f.mode === "time";
                return (
                  <div
                    key={f.kind}
                    role="button"
                    tabIndex={0}
                    onClick={() => { setOpenKind(f.kind); setDraft({ mode: f.mode, slots: copy(f.slots) }); }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        setOpenKind(f.kind);
                        setDraft({ mode: f.mode, slots: copy(f.slots) });
                      }
                    }}
                    className="py-3 grid grid-cols-1 sm:grid-cols-[auto,1.1fr,1fr,1.3fr] gap-x-4 gap-y-2 items-start cursor-pointer hover:bg-gray-50 rounded-lg px-1"
                  >
                    {f.canProduce ? (
                      <Switch on={on} tag={`f-${f.kind}`} label={`Производить: ${f.label}`} onClick={() => toggleProduction(f)} />
                    ) : (
                      <span className="w-9" />
                    )}
                    <div>
                      <div className="font-medium">{f.label}</div>
                      <div className="text-xs text-gray-500">{f.note}</div>
                    </div>
                    <div className="text-sm">
                      <div className={on ? "" : "text-gray-400"}>{f.when}</div>
                      <div className="text-xs text-gray-500">
                        {f.mode === "time" ? `${f.week} в неделю${f.next ? ` · следующий: ${f.next}` : ""}`
                          : f.mode === "demand" ? "по запросу — заказов нет"
                          : f.mode === "event" ? (f.publish === "сразу" ? "выходит сразу" : `выпуск в ${f.publish}`)
                          : "завод не участвует"}
                      </div>
                    </div>
                    <div>
                      <div className="flex flex-wrap gap-1.5 items-center">
                        {f.mode !== "mirror" && (
                          <button
                            disabled={!canManage || Boolean(botLock)}
                            onClick={(e) => { e.stopPropagation(); put({ format: f.kind, bot: !f.bot }, `b-${f.kind}`); }}
                            className={`text-[11px] px-2 py-px rounded-full border ${botLock ? "bg-gray-50 text-gray-400 border-dashed" : f.bot && data.botOn ? CHIP.bot : CHIP.off}`}
                            title={botLock || "выдача в телеграм-бот"}
                          >
                            бот · {botLock ? "решает завод" : !data.botOn ? "выключен у завода" : f.bot ? "вкл" : "выкл"}
                          </button>
                        )}
                        {f.routes.map((r) => {
                          const c = chan(r.ch);
                          return (
                            <button
                              key={r.ch}
                              disabled={!canManage || r.state === "locked"}
                              onClick={(e) => { e.stopPropagation(); toggleRoute(f, r); }}
                              title={c?.title}
                              className={`text-[11px] px-2 py-px rounded-full border ${CHIP[r.state] || CHIP.off}`}
                            >
                              {(c?.title || r.ch).replace("Instagram · ", "")} · {r.word}
                            </button>
                          );
                        })}
                        {!f.routes.length && !channels.length && (
                          <span className="text-[11px] px-2 py-px rounded-full border bg-gray-50 text-gray-400">каналов нет</span>
                        )}
                        {f.approval && (
                          <span className="text-[11px] px-2 py-px rounded-full border bg-white text-gray-600">✋ согласование</span>
                        )}
                      </div>
                      {f.warn && <div className="text-xs text-yellow-700 mt-1">{f.warn}</div>}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}

        {view === "table" && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[620px]">
              <thead>
                <tr className="text-gray-500">
                  <th className="text-left font-normal py-2">Формат</th>
                  <th className="font-normal py-2">
                    Бот
                    <span className="block text-[11px] text-gray-400">{data.botOn ? "включена" : "выключена"}</span>
                  </th>
                  {channels.map((c: any) => (
                    <th key={c.key} className="font-normal py-2">
                      {c.title.replace("Instagram · ", "IG · ")}
                      <span className={`block text-[11px] ${c.state === "auto" ? "text-green-700" : c.state === "manual" ? "text-yellow-700" : "text-gray-400"}`}>
                        {c.word}
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {formats.map((f) => (
                  <tr key={f.kind} className="border-t hover:bg-gray-50">
                    <td className="py-2 pr-3">
                      <button className="text-left" onClick={() => { setOpenKind(f.kind); setDraft({ mode: f.mode, slots: copy(f.slots) }); }}>
                        {f.label}
                      </button>
                    </td>
                    <td className="text-center">
                      {f.mode === "mirror" ? <span className="text-gray-300">—</span> : (
                        <span className="inline-flex justify-center">
                          <Switch on={f.bot && data.botOn} tag={`b-${f.kind}`} dim={!data.botOn} lock={botLock}
                            label={`Бот: ${f.label}`} onClick={() => put({ format: f.kind, bot: !f.bot }, `b-${f.kind}`)} />
                        </span>
                      )}
                    </td>
                    {channels.map((c: any) => {
                      const r = f.routes.find((x) => x.ch === c.key);
                      if (!r || r.state === "locked") return <td key={c.key} className="text-center text-xs text-gray-400">{r ? "нельзя" : "—"}</td>;
                      return (
                        <td key={c.key} className="text-center">
                          <span className="inline-flex justify-center">
                            <Switch on={r.on} tag={`r-${f.kind}-${c.key}`} dim={r.state === "pause"}
                              label={`${f.label} → ${c.title}`} onClick={() => toggleRoute(f, r)} />
                          </span>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="text-xs text-gray-400 mt-2">
              В шапке видно, как выходит каждый канал: авто, вручную или пауза. Пауза канала и подключение аккаунта
              меняются в блоке «Каналы».
            </p>
          </div>
        )}
      </div>

      {/* ── Карточка формата ───────────────────────────────────────────── */}
      {openKind && draft && (() => {
        const f = fmt(openKind)!;
        const dirty = JSON.stringify({ mode: f.mode, slots: f.slots }) !== JSON.stringify(draft);
        return (
          <div className="fixed inset-0 z-40">
            <div className="absolute inset-0 bg-black/30" onClick={() => { setOpenKind(""); setDraft(null); }} />
            <div className="absolute right-0 top-0 bottom-0 w-full max-w-lg bg-white shadow-xl flex flex-col">
              <div className="flex items-start justify-between gap-3 p-4 border-b">
                <div>
                  <h2 className="font-semibold text-lg">{f.label}</h2>
                  <p className="text-sm text-gray-500">{data.label} · {f.note}</p>
                </div>
                <button className="btn btn-secondary" onClick={() => { setOpenKind(""); setDraft(null); }}>×</button>
              </div>

              <div className="p-4 space-y-4 overflow-y-auto flex-1 text-sm">
                <section>
                  <h3 className="text-[11px] uppercase tracking-wide text-gray-400 mb-2">Когда производить</h3>
                  {f.canSchedule ? (
                    <>
                      <select
                        disabled={!canManage}
                        value={draft.mode}
                        onChange={(e) => setDraft({ ...draft, mode: e.target.value })}
                        className="border rounded-md px-2 py-1 text-sm bg-white mb-2"
                      >
                        <option value="time">по расписанию</option>
                        <option value="demand">по запросу</option>
                      </select>
                      {draft.slots.map((s, i) => (
                        <div key={i} className={`flex flex-wrap items-center gap-1 mb-1 ${draft.mode === "time" ? "" : "opacity-50"}`}>
                          <input
                            type="time" disabled={!canManage} value={s.time}
                            onChange={(e) => {
                              const slots = copy(draft.slots);
                              slots[i].time = e.target.value || "00:00";
                              setDraft({ ...draft, slots });
                            }}
                            className="border rounded-md px-1.5 py-1 text-sm w-[92px]"
                          />
                          {caps?.scheduleDays && DAYS.map((d, di) => {
                            const day = di + 1;
                            const on = s.days.includes(day);
                            return (
                              <button
                                key={d} disabled={!canManage}
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
                          {caps?.scheduleDays && draft.slots.length > 1 && canManage && (
                            <button className="text-gray-400 hover:text-red-600 px-1"
                              onClick={() => setDraft({ ...draft, slots: draft.slots.filter((_, x) => x !== i) })}>×</button>
                          )}
                        </div>
                      ))}
                      {caps?.scheduleDays && canManage && (
                        <button className="text-brand-700 text-sm"
                          onClick={() => setDraft({ ...draft, slots: [...draft.slots, { days: [...ALL], time: "12:00" }] })}>
                          ＋ запуск
                        </button>
                      )}
                      {caps?.scheduleNote && (
                        <p className="text-xs text-gray-500">{caps.scheduleNote}</p>
                      )}
                      {canManage && (
                        <div className="mt-3 pt-3 border-t">
                          <button className="btn btn-secondary text-xs" disabled={busy === `n-${f.kind}`}
                            onClick={() => put({ now: f.kind }, `n-${f.kind}`)}>
                            {busy === `n-${f.kind}` ? "Заказываю…" : "Произвести сейчас"}
                          </button>
                          <p className="text-xs text-gray-500 mt-1">
                            Разовый заказ вне расписания: завод заберёт его в ближайшие полминуты, расписание
                            не меняется.
                          </p>
                        </div>
                      )}
                      {dirty && canManage && (
                        <div className="flex gap-2 mt-2">
                          <button className="btn btn-primary text-xs" disabled={busy === `s-${f.kind}`}
                            onClick={async () => { if (await saveSchedule(f.kind, draft.mode, draft.slots)) setDraft({ mode: draft.mode, slots: draft.slots }); }}>
                            Сохранить расписание
                          </button>
                          <button className="btn btn-secondary text-xs" onClick={() => setDraft({ mode: f.mode, slots: copy(f.slots) })}>
                            Отменить
                          </button>
                        </div>
                      )}
                    </>
                  ) : f.mode === "event" ? (
                    <p className="text-gray-600">Расписания нет: нарезка делается, когда донор выложил новый ролик.</p>
                  ) : (
                    <p className="text-gray-600">Завод не участвует: это зеркало ваших постов на видеоплощадки.</p>
                  )}
                </section>

                <section>
                  <h3 className="text-[11px] uppercase tracking-wide text-gray-400 mb-2">Когда выпускать</h3>
                  {f.mode === "event" ? (
                    <div className="flex items-center gap-2">
                      <select
                        disabled={!canManage}
                        value={f.publish === "сразу" ? "now" : "at"}
                        onChange={(e) => togglePublish(f.kind, e.target.value === "now" ? "now" : "at", f.publish === "сразу" ? "12:00" : f.publish)}
                        className="border rounded-md px-2 py-1 text-sm bg-white"
                      >
                        <option value="now">сразу, как собрался</option>
                        <option value="at">в назначенное время</option>
                      </select>
                      {f.publish !== "сразу" && (
                        <input type="time" disabled={!canManage} defaultValue={f.publish}
                          onBlur={(e) => e.target.value !== f.publish && togglePublish(f.kind, "at", e.target.value)}
                          className="border rounded-md px-1.5 py-1 text-sm w-[92px]" />
                      )}
                    </div>
                  ) : (
                    <p className="text-gray-600">Сразу, как ролик готов. Отдельное время выпуска есть только у нарезок.</p>
                  )}
                </section>

                <section>
                  <h3 className="text-[11px] uppercase tracking-wide text-gray-400 mb-2">Куда уходит</h3>
                  {f.mode !== "mirror" && (
                    <div className="flex items-center justify-between gap-3 py-2 border-b">
                      <div>
                        <div>Телеграм · бот выдачи</div>
                        <div className="text-xs text-gray-500">
                          {botLock ? botLock
                            : data.botOn ? (f.bot ? `ролик, подпись и обложки приходят в ${data.bot}` : "этот формат в бот не отправляем")
                            : "выдача выключена у всего завода"}
                        </div>
                      </div>
                      <Switch on={f.bot && data.botOn} dim={!data.botOn} tag={`b-${f.kind}`} label="Выдача в бот" lock={botLock}
                        onClick={() => put({ format: f.kind, bot: !f.bot }, `b-${f.kind}`)} />
                    </div>
                  )}
                  {f.routes.map((r) => {
                    const c = chan(r.ch);
                    const sub = r.state === "locked" ? "чужие нарезки на видеоплощадках — путь к страйкам"
                      : r.state === "pause" ? "канал на паузе — не выйдет, пока не снимете"
                      : r.state === "auto" ? `аккаунт подключён — выкладывает ${caps?.publisher || "машина"}`
                      : r.state === "manual" ? "аккаунт не подключён — выложите из бота"
                      : "этот формат сюда не отправляем";
                    return (
                      <div key={r.ch} className="flex items-center justify-between gap-3 py-2 border-b last:border-0">
                        <div>
                          <div>{c?.title} · <span className="text-gray-500">{c?.account}</span></div>
                          <div className="text-xs text-gray-500">{sub}</div>
                        </div>
                        {r.state === "locked"
                          ? <span className="text-[11px] px-2 py-px rounded-full border bg-white text-gray-400">нельзя</span>
                          : <Switch on={r.on} dim={r.state === "pause"} tag={`r-${f.kind}-${r.ch}`}
                              label={`${f.label} → ${c?.title}`} onClick={() => toggleRoute(f, r)} />}
                      </div>
                    );
                  })}
                  {!f.routes.length && <p className="text-gray-500 text-xs">Каналов у завода нет — ролик остаётся в боте.</p>}
                </section>

                <section>
                  <h3 className="text-[11px] uppercase tracking-wide text-gray-400 mb-2">Как</h3>
                  <div className="flex items-center justify-between gap-3 py-2 border-b">
                    <div>
                      <div>Публикация после согласования текста</div>
                      <div className="text-xs text-gray-500">
                        {approvalLock(f) ? approvalLock(f)
                          : f.approval
                          ? "завод пишет текст, он приходит в бот; без «да» ролик не собирается и деньги не тратятся"
                          : "ролик собирается и выходит без проверки текста"}
                      </div>
                    </div>
                    <Switch on={f.approval} tag={`a-${f.kind}`} lock={approvalLock(f)}
                      label="Согласование текста" onClick={() => put({ format: f.kind, approval: !f.approval }, `a-${f.kind}`)} />
                  </div>
                  {f.mode === "event" && (
                    <div className="flex items-center justify-between gap-3 py-2 border-b">
                      <div>
                        <div>Делать нарезки этого донора</div>
                        <div className="text-xs text-gray-500">
                          {f.off ? "выключено: завод пропускает его новые ролики" : "включено: новый ролик донора идёт в работу"}
                        </div>
                      </div>
                      <Switch on={!f.off} tag={`f-${f.kind}`} label="Производить нарезки"
                        onClick={() => put({ format: f.kind, off: !f.off }, `f-${f.kind}`)} />
                    </div>
                  )}
                  <dl className="grid grid-cols-[140px,1fr] gap-y-1 pt-2 text-gray-600">
                    <dt className="text-gray-500">Тема</dt><dd>{f.note || "—"}</dd>
                    <dt className="text-gray-500">В неделю</dt>
                    <dd className="tabular-nums">{f.mode === "time" ? f.week : "по событию"}</dd>
                  </dl>
                </section>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
