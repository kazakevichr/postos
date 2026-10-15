"use client";

// Кошельки платных сервисов: где кончились деньги, сколько осталось,
// когда пополняли и куда идти пополнять.
//
// Половину строки присылает источник замеров раз в час, половину вносит
// человек — те сервисы, что остаток по API не отдают (роутер, OpenAI, fal,
// BetsAPI, TalorData), иначе знать его неоткуда. Поэтому ручной ввод здесь не
// «дополнительная возможность», а единственный источник половины цифр.
//
// Кошелёк — это аккаунт сервиса, а не проект: одним ключом могут платить
// несколько проектов, и тогда строка видна у каждого с пометкой «общий».
// «Сводка» — все кошельки разом и траты месяца по проектам.
import { useEffect, useState } from "react";

type Row = {
  service: string; title: string; ok: boolean; low: boolean;
  left: number | null; unit: string; spent: number | null; note: string;
  link: string; manual: number | null; manualAt: string | null;
  at: string | null; fresh: boolean; topups: number; custom: boolean; inactive: boolean;
  balance: number | null; source: string; blocks: boolean;
  users: string[]; shared: boolean; perDay: number | null; week: number | null;
  month: number | null; daysLeft: number | null; resetAt: string | null; needManual: string;
  billing: string; subAmount: number | null; subCurrency: string; nextPay: string | null; paidAt: string | null;
};
type Summary = {
  month: string; total: number; mine: number | null;
  byProject: { brand: string; title: string; amount: number }[];
  ending: { title: string; daysLeft: number; balance: number | null; unit: string }[];
};
type Topup = {
  id: number; service: string; title: string; amount: number;
  at: string; who: string; note: string;
};
type Labels = {
  title: string; blockedTitle: string; blockedNote: string;
  dryTitle: string; dryNote: string;
};

const money = (n: number) => `$${n.toFixed(2)}`;
const amt = (n: number, unit: string) => (unit === "$" ? money(n) : `${Math.round(n).toLocaleString("ru-RU")} ${unit}`);
const MONTHS = ["январь", "февраль", "март", "апрель", "май", "июнь", "июль", "август", "сентябрь", "октябрь", "ноябрь", "декабрь"];
const dayWord = (n: number) => {
  const m10 = n % 10, m100 = n % 100;
  return m100 >= 11 && m100 <= 14 ? "дней" : m10 === 1 ? "день" : m10 >= 2 && m10 <= 4 ? "дня" : "дней";
};
const when = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—";

function badge(r: Row) {
  if (!r.at) return { text: "нет данных", cls: "bg-gray-100 text-gray-600" };
  if (!r.fresh) return { text: "замер устарел", cls: "bg-yellow-100 text-yellow-800" };
  if (!r.ok) return r.blocks
    ? { text: "пусто — всё встало", cls: "bg-red-100 text-red-800" }
    : { text: "пусто — работает замена", cls: "bg-orange-100 text-orange-800" };
  if (r.low) return { text: "на исходе", cls: "bg-yellow-100 text-yellow-800" };
  return { text: "работает", cls: "bg-green-100 text-green-800" };
}

export default function WalletsBoard({
  canManage = true,
  lockTo,
}: {
  canManage?: boolean;
  // Направление выбрано в панели — тогда свой переключатель здесь лишний
  // и, хуже того, показывал бы чужие сервисы.
  lockTo?: string;
}) {
  const [project, setProject] = useState(lockTo || "");
  const [sum, setSum] = useState<Summary | null>(null);
  const [adding, setAdding] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newLink, setNewLink] = useState("");
  const [newUnit, setNewUnit] = useState("$");
  const [showInactive, setShowInactive] = useState(false);
  const [projects, setProjects] = useState<{ id: string; title: string }[]>([]);
  const [labels, setLabels] = useState<Labels | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [history, setHistory] = useState<Topup[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState("");
  const [note, setNote] = useState("");
  const [open, setOpen] = useState("");            // у какого сервиса раскрыт ввод
  const [amount, setAmount] = useState("");
  const [comment, setComment] = useState("");
  const [manual, setManual] = useState("");
  const [bill, setBill] = useState({ billing: "", amount: "", currency: "USD" });
  const [paidOn, setPaidOn] = useState("");

  // Ответ на любой запрос — целиком картина одного проекта, поэтому раскладка
  // одна на загрузку, пополнение и удаление.
  function apply(j: any) {
    if (!j?.wallets) return false;
    setRows(j.wallets);
    setHistory(j.topups || []);
    if (j.projects) setProjects(j.projects);
    if (j.labels) setLabels(j.labels);
    setSum(j.summary || null);
    if (j.project && !lockTo) setProject(j.project);
    return true;
  }

  async function load(p: string) {
    const r = await fetch(`/api/factory/wallets?project=${encodeURIComponent(p)}`);
    if (r.ok) apply(await r.json());
    setLoaded(true);
  }
  useEffect(() => { load(project); }, [project]);

  // Заведение кошелька руками: платят и за сервисы, которых нет в справочнике
  // сбора, и учесть их иначе нечем.
  async function addWallet() {
    if (!canManage || !newTitle.trim()) return;
    setBusy("add"); setNote("");
    // В сводке своего проекта нет — новый кошелёк ложится в первый.
    const home = project === "all" ? projects.find((p) => p.id !== "all")?.id : project;
    const r = await fetch(`/api/factory/wallets?project=${encodeURIComponent(project)}`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: newTitle, link: newLink, unit: newUnit || "$", project: home }),
    });
    const j = await r.json();
    if (apply(j)) { setNewTitle(""); setNewLink(""); setNewUnit("$"); setAdding(false); }
    else setNote(j.error || "не получилось");
    setBusy("");
  }

  // Не удаление, а «этим больше не пользуемся»: строка уходит из рабочего
  // списка, но замеры и история остаются, и вернуть её можно одним нажатием.
  async function setInactive(service: string, inactive: boolean) {
    if (!canManage) return;
    setBusy(`act${service}`); setNote("");
    const r = await fetch(`/api/factory/wallets?project=${encodeURIComponent(project)}`, {
      method: "PUT", headers: { "content-type": "application/json" },
      body: JSON.stringify({ service, inactive }),
    });
    const j = await r.json();
    if (!apply(j)) setNote(j.error || "не получилось");
    setBusy("");
  }

  async function removeWallet(service: string, title: string) {
    if (!canManage) return;
    if (!window.confirm(`Удалить кошелёк «${title}» вместе с его пополнениями?`)) return;
    setBusy(`delw${service}`); setNote("");
    const r = await fetch(`/api/factory/wallets?service=${encodeURIComponent(service)}&project=${encodeURIComponent(project)}`, { method: "DELETE" });
    const j = await r.json();
    if (!apply(j)) setNote(j.error || "не получилось");
    setBusy("");
  }

  async function send(body: any, tag: string) {
    if (!canManage) return;
    setBusy(tag); setNote("");
    const r = await fetch(`/api/factory/wallets?project=${encodeURIComponent(project)}`, {
      method: "PUT", headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const j = await r.json();
    if (apply(j)) { setOpen(""); setAmount(""); setComment(""); setManual(""); }
    else setNote(j.error || "не получилось");
    setBusy("");
  }

  async function removeTopup(id: number) {
    if (!canManage) return;
    setBusy(`del${id}`);
    const r = await fetch(`/api/factory/wallets?id=${id}&project=${encodeURIComponent(project)}`, { method: "DELETE" });
    apply(await r.json());
    setBusy("");
  }

  if (!loaded) return <div className="card text-sm text-gray-500">Загружаю кошельки…</div>;

  // Кошелёк, помеченный «не пользуемся», не поднимает тревогу: пустой счёт
  // сервиса, который выключили сознательно, — не поломка.
  const live = rows.filter((r) => !r.inactive);
  const idle = rows.filter((r) => r.inactive);
  const shown = showInactive ? rows : live;
  const stopped = live.filter((r) => r.at && r.fresh && !r.ok && r.blocks);
  const dry = live.filter((r) => r.at && r.fresh && !r.ok && !r.blocks);

  return (
    <div className="space-y-4">
      {!lockTo && projects.length > 1 && (
        <div className="flex flex-wrap gap-2">
          {projects.map((p) => (
            <button
              key={p.id}
              onClick={() => { setProject(p.id); setOpen(""); }}
              className={`px-3 py-1.5 rounded-lg text-sm border ${
                p.id === project
                  ? "bg-brand-600 text-white border-brand-600"
                  : "hover:bg-gray-50"
              }`}
            >
              {p.title}
            </button>
          ))}
        </div>
      )}

      {sum && (
        <div className="card">
          <div className="flex flex-wrap gap-x-10 gap-y-4">
            <div>
              <div className="text-xs text-gray-500">
                {project === "all" ? "Потрачено" : "Доля проекта"} · {MONTHS[Number(sum.month.slice(5, 7)) - 1]}
              </div>
              <div className="text-2xl font-semibold">{money(project === "all" ? sum.total : sum.mine || 0)}</div>
              {project !== "all" && <div className="text-xs text-gray-400">всего по всем проектам {money(sum.total)}</div>}
            </div>
            {project === "all" && sum.byProject.length > 0 && (
              <div className="min-w-[14rem]">
                <div className="text-xs text-gray-500 mb-1">По проектам</div>
                {sum.byProject.map((p) => (
                  <div key={p.brand || "-"} className="flex justify-between gap-6 text-sm">
                    <span className={p.brand ? "" : "text-gray-400"}>{p.title}</span>
                    <span className="tabular-nums">{money(p.amount)}</span>
                  </div>
                ))}
              </div>
            )}
            <div className="min-w-[14rem]">
              <div className="text-xs text-gray-500 mb-1">Кончится первым</div>
              {sum.ending.length ? sum.ending.map((e) => (
                <div key={e.title} className="flex justify-between gap-6 text-sm">
                  <span>{e.title}</span>
                  <span className={`tabular-nums ${e.daysLeft < 7 ? "text-red-600 font-medium" : ""}`}>
                    ~{e.daysLeft} {dayWord(e.daysLeft)}
                  </span>
                </div>
              )) : <div className="text-sm text-gray-400">пока мало замеров, чтобы посчитать</div>}
            </div>
          </div>
          <div className="text-[11px] text-gray-400 mt-3">
            Считаются кошельки в долларах по ежедневным замерам. Общий расход делится между проектами по числу
            готовых роликов, которым нужен этот сервис; день без роликов — «не разнесено».
          </div>
        </div>
      )}

      {stopped.length > 0 && labels && (
        <div className="card border-red-300 bg-red-50 text-sm">
          <b>{labels.blockedTitle}</b> Кончились деньги: {stopped.map((r) => r.title).join(", ")}.
          {" "}{labels.blockedNote}
        </div>
      )}
      {stopped.length === 0 && dry.length > 0 && labels && (
        <div className="card border-orange-300 bg-orange-50 text-sm">
          <b>{labels.dryTitle}</b> Пусто: {dry.map((r) => r.title).join(", ")}.
          {" "}{labels.dryNote}
        </div>
      )}

      {canManage && (
        <div className="card">
          {!adding ? (
            <button className="text-sm px-3 py-1.5 rounded-lg border hover:bg-gray-50"
                    onClick={() => { setAdding(true); setNote(""); }}>
              + Добавить кошелёк
            </button>
          ) : (
            <div className="space-y-3">
              <div className="font-medium">Новый кошелёк</div>
              <div className="text-xs text-gray-500">
                Сервис, который вы оплачиваете сами: замеры по нему не приходят, остаток и
                пополнения вносятся руками.
              </div>
              <div className="flex flex-wrap gap-2 items-end">
                <label className="text-sm flex-1 min-w-[12rem]">
                  <div className="text-xs text-gray-500 mb-1">Название</div>
                  <input className="border rounded-lg px-2 py-1.5 w-full" value={newTitle}
                         onChange={(e) => setNewTitle(e.target.value)} placeholder="Например, Midjourney" />
                </label>
                <label className="text-sm flex-1 min-w-[12rem]">
                  <div className="text-xs text-gray-500 mb-1">Ссылка на кабинет (необязательно)</div>
                  <input className="border rounded-lg px-2 py-1.5 w-full" value={newLink}
                         onChange={(e) => setNewLink(e.target.value)} placeholder="https://…" />
                </label>
                <label className="text-sm">
                  <div className="text-xs text-gray-500 mb-1">В чём остаток</div>
                  <input className="border rounded-lg px-2 py-1.5 w-24" value={newUnit}
                         onChange={(e) => setNewUnit(e.target.value)} placeholder="$" />
                </label>
                <button className="px-3 py-1.5 rounded-lg text-sm bg-brand-600 text-white disabled:opacity-50"
                        disabled={busy !== "" || !newTitle.trim()} onClick={addWallet}>
                  Добавить
                </button>
                <button className="px-3 py-1.5 rounded-lg text-sm text-gray-500 hover:bg-gray-50"
                        onClick={() => { setAdding(false); setNote(""); }}>
                  Отмена
                </button>
              </div>
              {note && <div className="text-sm text-red-600">{note}</div>}
            </div>
          )}
        </div>
      )}

      {idle.length > 0 && (
        <div className="flex items-center gap-2 text-sm text-gray-500">
          <span>
            {showInactive
              ? `Показаны все · не используются: ${idle.length}`
              : `Скрыто неактивных: ${idle.length}`}
          </span>
          <button className="px-2 py-1 rounded border text-xs hover:bg-gray-50"
                  onClick={() => setShowInactive(!showInactive)}>
            {showInactive ? "только активные" : "показать все"}
          </button>
        </div>
      )}

      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-gray-500 border-b">
              <th className="py-2 pr-3 font-medium">Сервис</th>
              <th className="py-2 pr-3 font-medium">Статус</th>
              <th className="py-2 pr-3 font-medium">Остаток</th>
              <th className="py-2 pr-3 font-medium">Хватит на</th>
              <th className="py-2 pr-3 font-medium">Расход</th>
              <th className="py-2 pr-3 font-medium">Замер</th>
              <th className="py-2 font-medium"></th>
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => {
              const b = badge(r);
              return (
                <tr key={r.service} className={`border-b last:border-0 align-top ${r.inactive ? "opacity-50" : ""}`}>
                  <td className="py-2.5 pr-3">
                    <div className="font-medium">
                      {r.title}
                      {r.inactive && (
                        <span className="ml-2 text-xs font-normal text-gray-400">не активен</span>
                      )}
                    </div>
                    {/* Чей кошелёк — всегда: в сводке рядом стоят два «Роутера»,
                        и без подписи не понять, какой из них Оракла. */}
                    {r.users.length > 0 && (
                      <div className="text-[11px] text-brand-700 mt-0.5 max-w-xs">
                        {r.shared ? "общий" : "проект"}: {r.users.join(", ")}
                      </div>
                    )}
                    {r.note && <div className="text-xs text-gray-500 mt-0.5 max-w-xs">{r.note}</div>}
                    {r.needManual && (
                      <div className="text-xs text-amber-800 bg-amber-50 rounded px-1.5 py-0.5 mt-1 max-w-xs">{r.needManual}</div>
                    )}
                  </td>
                  <td className="py-2.5 pr-3">
                    <span className={`inline-block px-2 py-0.5 rounded text-xs whitespace-nowrap ${b.cls}`}>{b.text}</span>
                  </td>
                  <td className="py-2.5 pr-3 whitespace-nowrap">
                    {r.billing === "sub" ? (
                      <span className="font-semibold">
                        {r.subAmount == null ? "сумма не указана" : r.subAmount === 0 ? "бесплатно"
                          : `${r.subCurrency === "RUB" ? `${r.subAmount.toLocaleString("ru-RU")} ₽` : money(r.subAmount)} / мес`}
                      </span>
                    ) : r.balance == null ? (
                      <span className="text-gray-400">неизвестен</span>
                    ) : (
                      <span className="font-semibold">{amt(r.balance, r.unit)}</span>
                    )}
                    <div className="text-xs text-gray-400 mt-0.5">
                      {r.billing === "sub" ? "подписка · в постоянных расходах" : r.source || "нужен ручной ввод"}
                    </div>
                    {r.topups > 0 && <div className="text-xs text-gray-400">пополнено {money(r.topups)}</div>}
                  </td>
                  <td className="py-2.5 pr-3 whitespace-nowrap">
                    {r.billing === "sub" ? (
                      r.nextPay ? (
                        <span className={+new Date(r.nextPay) - Date.now() < 3 * 864e5 ? "text-red-600 font-semibold" : "font-medium"}>
                          списание {new Date(r.nextPay).toLocaleDateString("ru-RU", { day: "numeric", month: "short" })}
                        </span>
                      ) : (
                        <span className="text-xs text-gray-400" title="Нажмите «оплатил» при следующей оплате — дата запомнится">
                          дата списания<br />не известна
                        </span>
                      )
                    ) : r.daysLeft != null ? (
                      <span className={r.daysLeft < 7 ? "text-red-600 font-semibold" : "font-medium"}>
                        ~{r.daysLeft} {dayWord(r.daysLeft)}
                      </span>
                    ) : <span className="text-gray-400">—</span>}
                    {r.resetAt && (
                      <div className="text-xs text-gray-400">обновится {new Date(r.resetAt).toLocaleDateString("ru-RU", { day: "numeric", month: "short" })}</div>
                    )}
                  </td>
                  <td className="py-2.5 pr-3 whitespace-nowrap text-xs">
                    {r.perDay != null ? (
                      <>
                        <div className="text-sm">{amt(r.perDay, r.unit)}<span className="text-gray-400"> /день</span></div>
                        {r.week != null && <div className="text-gray-400">7 дней: {amt(r.week, r.unit)}</div>}
                        {r.month != null && <div className="text-gray-400">месяц: {amt(r.month, r.unit)}</div>}
                      </>
                    ) : <span className="text-gray-400">{r.spent != null || r.left != null ? "копится" : "не виден"}</span>}
                  </td>
                  <td className="py-2.5 pr-3 text-xs text-gray-500 whitespace-nowrap">{when(r.at)}</td>
                  <td className="py-2.5 whitespace-nowrap">
                    <a href={r.link} target="_blank" rel="noreferrer"
                       className="text-brand-600 hover:underline text-xs mr-3">кабинет ↗</a>
                    {canManage && (
                      <button className="text-xs px-2 py-1 rounded border hover:bg-gray-50"
                              onClick={() => {
                                setOpen(open === r.service ? "" : r.service);
                                setBill({ billing: r.billing, amount: r.subAmount != null ? String(r.subAmount) : "", currency: r.subCurrency || "USD" });
                                setPaidOn("");
                              }}>
                        {open === r.service ? "закрыть" : "внести"}
                      </button>
                    )}
                    {/* Основной способ убрать сервис из работы — пометка, а не
                        удаление: справочный кошелёк удалить нельзя вовсе, он
                        вернётся со следующим замером. */}
                    {canManage && (
                      <button className="text-xs px-2 py-1 ml-2 rounded border hover:bg-gray-50 disabled:opacity-50"
                              disabled={busy !== ""}
                              onClick={() => setInactive(r.service, !r.inactive)}>
                        {r.inactive ? "вернуть" : "не активен"}
                      </button>
                    )}
                    {/* Удаляется только заведённое руками — на случай, когда
                        кошелёк создан по ошибке и истории по нему нет смысла. */}
                    {canManage && r.custom && (
                      <button className="text-xs px-2 py-1 ml-2 rounded border border-red-200 text-red-600 hover:bg-red-50 disabled:opacity-50"
                              disabled={busy !== ""}
                              onClick={() => removeWallet(r.service, r.title)}>
                        удалить
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {open && canManage && (() => {
        const r = rows.find((x) => x.service === open);
        if (!r) return null;
        return (
          <div className="card space-y-3">
            <div className="font-medium">{r.title}</div>
            <div className="text-xs text-gray-500">
              Что этот сервис отдаёт сам: {r.left != null ? "остаток" : r.spent != null ? "только расход" : "ничего"}.
              {r.left == null && r.spent != null && " Впишите остаток из кабинета один раз — дальше он будет уменьшаться сам по расходу."}
              {r.left == null && r.spent == null && " Остаток виден только в кабинете — вписывайте его раз в неделю, Постос напомнит."}
            </div>
            <div className="flex flex-wrap gap-2 items-end pb-3 border-b">
              <label className="text-sm">
                <div className="text-xs text-gray-500 mb-1">Как платим</div>
                <select className="border rounded-lg px-2 py-1.5" value={bill.billing}
                        onChange={(e) => setBill({ ...bill, billing: e.target.value })}>
                  <option value="">не указано</option>
                  <option value="sub">подписка — сумма раз в месяц</option>
                  <option value="balance">пополняемый баланс</option>
                </select>
              </label>
              {bill.billing === "sub" && (
                <>
                  <label className="text-sm">
                    <div className="text-xs text-gray-500 mb-1">Сумма в месяц</div>
                    <input className="border rounded-lg px-2 py-1.5 w-28" inputMode="decimal" value={bill.amount}
                           onChange={(e) => setBill({ ...bill, amount: e.target.value })} placeholder="0 — бесплатно" />
                  </label>
                  <select className="border rounded-lg px-2 py-1.5 text-sm" value={bill.currency}
                          onChange={(e) => setBill({ ...bill, currency: e.target.value })}>
                    <option value="USD">$</option>
                    <option value="RUB">₽</option>
                  </select>
                </>
              )}
              <button className="px-3 py-1.5 rounded-lg text-sm border hover:bg-gray-50 disabled:opacity-50"
                      disabled={busy !== "" || (bill.billing === r.billing && (bill.amount || "") === (r.subAmount != null ? String(r.subAmount) : "") && bill.currency === r.subCurrency)}
                      onClick={() => send({ service: r.service, billing: bill.billing, subAmount: bill.amount, subCurrency: bill.currency }, "billing")}>
                Сохранить
              </button>
            </div>
            <div className="text-xs text-gray-500">
              {bill.billing === "sub"
                ? "Подписка сама попадёт в «Постоянные расходы» экономики — там её вносить не нужно."
                : bill.billing === "balance"
                  ? "Каждое пополнение ниже само станет тратой в «Журнале денег» экономики."
                  : "Укажите, как платим за сервис, — от этого зависит, где он появится в экономике."}
            </div>
            {r.billing === "sub" && (
              <div className="flex flex-wrap gap-2 items-end">
                <label className="text-sm">
                  <div className="text-xs text-gray-500 mb-1">Оплатили — когда (пусто — сегодня)</div>
                  <input type="date" className="border rounded-lg px-2 py-1.5" value={paidOn} onChange={(e) => setPaidOn(e.target.value)} />
                </label>
                <button className="px-3 py-1.5 rounded-lg text-sm bg-brand-600 text-white disabled:opacity-50"
                        disabled={busy !== ""} onClick={() => send({ service: r.service, paid: paidOn || null }, "paid")}>
                  Оплатил
                </button>
                <div className="text-xs text-gray-400 self-center">
                  {r.paidAt ? `последняя оплата ${when(r.paidAt)} · ` : ""}следующее списание считается через месяц от оплаты
                </div>
              </div>
            )}
            {r.billing !== "sub" && <div className="flex flex-wrap gap-2 items-end">
              <label className="text-sm">
                <div className="text-xs text-gray-500 mb-1">Записать пополнение, $</div>
                <input className="border rounded-lg px-2 py-1.5 w-32" inputMode="decimal"
                       value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="50" />
              </label>
              <label className="text-sm flex-1 min-w-[12rem]">
                <div className="text-xs text-gray-500 mb-1">Заметка (необязательно)</div>
                <input className="border rounded-lg px-2 py-1.5 w-full"
                       value={comment} onChange={(e) => setComment(e.target.value)} placeholder="перевёл с карты" />
              </label>
              <button className="px-3 py-1.5 rounded-lg text-sm bg-brand-600 text-white disabled:opacity-50"
                      disabled={busy !== "" || !amount}
                      onClick={() => send({ service: r.service, amount, note: comment }, "topup")}>
                Записать
              </button>
            </div>}
            {r.billing !== "sub" && <div className="flex flex-wrap gap-2 items-end pt-2 border-t">
              <label className="text-sm">
                <div className="text-xs text-gray-500 mb-1">
                  Или вписать текущий остаток ({r.unit})
                </div>
                <input className="border rounded-lg px-2 py-1.5 w-32" inputMode="decimal"
                       value={manual} onChange={(e) => setManual(e.target.value)}
                       placeholder={r.manual != null ? String(r.manual) : "12.40"} />
              </label>
              <button className="px-3 py-1.5 rounded-lg text-sm border hover:bg-gray-50 disabled:opacity-50"
                      disabled={busy !== "" || !manual}
                      onClick={() => send({ service: r.service, manual }, "manual")}>
                Сохранить остаток
              </button>
              {r.manual != null && (
                <button className="px-3 py-1.5 rounded-lg text-sm text-gray-500 hover:bg-gray-50"
                        onClick={() => send({ service: r.service, manual: null }, "manual")}>
                  Стереть (вписан {when(r.manualAt)})
                </button>
              )}
            </div>}
            {note && <div className="text-sm text-red-600">{note}</div>}
          </div>
        );
      })()}

      <div className="card">
        <div className="font-medium mb-2">История пополнений</div>
        {history.length === 0 ? (
          <div className="text-sm text-gray-500">
            Пополнений не записано. Вносите их здесь — по ним считается остаток сервисов,
            которые не отдают его по API.
          </div>
        ) : (
          <table className="w-full text-sm">
            <tbody>
              {history.map((t) => (
                <tr key={t.id} className="border-b last:border-0">
                  <td className="py-2 pr-3 text-gray-500 whitespace-nowrap">{when(t.at)}</td>
                  <td className="py-2 pr-3">{t.title}</td>
                  <td className="py-2 pr-3 font-semibold whitespace-nowrap">{money(t.amount)}</td>
                  <td className="py-2 pr-3 text-gray-500">{t.note}</td>
                  <td className="py-2 pr-3 text-gray-400 text-xs">{t.who}</td>
                  <td className="py-2 text-right">
                    {canManage && (
                      <button className="text-xs text-gray-400 hover:text-red-600 disabled:opacity-50"
                              disabled={busy === `del${t.id}`} onClick={() => removeTopup(t.id)}>
                        удалить
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
