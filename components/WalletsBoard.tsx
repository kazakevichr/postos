"use client";

// Кошельки платных сервисов: где кончились деньги, сколько осталось,
// когда пополняли и куда идти пополнять.
//
// Половину строки присылает источник замеров раз в час, половину вносит
// человек — те сервисы, что остаток по API не отдают (роутер, OpenAI, fal,
// BetsAPI, TalorData), иначе знать его неоткуда. Поэтому ручной ввод здесь не
// «дополнительная возможность», а единственный источник половины цифр.
//
// Проектов два — завод СуперФита и Оракл, — и переключатель наверху меняет
// выборку целиком: сервисы, история пополнений и тексты предупреждений
// приходят с сервера уже для выбранного проекта.
import { useEffect, useState } from "react";

type Row = {
  service: string; title: string; ok: boolean; low: boolean;
  left: number | null; unit: string; spent: number | null; note: string;
  link: string; manual: number | null; manualAt: string | null;
  at: string | null; fresh: boolean; topups: number; custom: boolean;
  balance: number | null; source: string; blocks: boolean;
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
  const [project, setProject] = useState(lockTo || "superfit");
  const [adding, setAdding] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newLink, setNewLink] = useState("");
  const [newUnit, setNewUnit] = useState("$");
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

  // Ответ на любой запрос — целиком картина одного проекта, поэтому раскладка
  // одна на загрузку, пополнение и удаление.
  function apply(j: any) {
    if (!j?.wallets) return false;
    setRows(j.wallets);
    setHistory(j.topups || []);
    if (j.projects) setProjects(j.projects);
    if (j.labels) setLabels(j.labels);
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
    const r = await fetch("/api/factory/wallets", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: newTitle, link: newLink, unit: newUnit || "$", project }),
    });
    const j = await r.json();
    if (apply(j)) { setNewTitle(""); setNewLink(""); setNewUnit("$"); setAdding(false); }
    else setNote(j.error || "не получилось");
    setBusy("");
  }

  async function removeWallet(service: string, title: string) {
    if (!canManage) return;
    if (!window.confirm(`Удалить кошелёк «${title}» вместе с его пополнениями?`)) return;
    setBusy(`delw${service}`); setNote("");
    const r = await fetch(`/api/factory/wallets?service=${encodeURIComponent(service)}`, { method: "DELETE" });
    const j = await r.json();
    if (!apply(j)) setNote(j.error || "не получилось");
    setBusy("");
  }

  async function send(body: any, tag: string) {
    if (!canManage) return;
    setBusy(tag); setNote("");
    const r = await fetch("/api/factory/wallets", {
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

  const stopped = rows.filter((r) => r.at && r.fresh && !r.ok && r.blocks);
  const dry = rows.filter((r) => r.at && r.fresh && !r.ok && !r.blocks);

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

      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-gray-500 border-b">
              <th className="py-2 pr-3 font-medium">Сервис</th>
              <th className="py-2 pr-3 font-medium">Статус</th>
              <th className="py-2 pr-3 font-medium">Остаток</th>
              <th className="py-2 pr-3 font-medium">Пополнено всего</th>
              <th className="py-2 pr-3 font-medium">Замер</th>
              <th className="py-2 font-medium"></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const b = badge(r);
              return (
                <tr key={r.service} className="border-b last:border-0 align-top">
                  <td className="py-2.5 pr-3">
                    <div className="font-medium">{r.title}</div>
                    {r.note && <div className="text-xs text-gray-500 mt-0.5 max-w-xs">{r.note}</div>}
                  </td>
                  <td className="py-2.5 pr-3">
                    <span className={`inline-block px-2 py-0.5 rounded text-xs whitespace-nowrap ${b.cls}`}>{b.text}</span>
                  </td>
                  <td className="py-2.5 pr-3 whitespace-nowrap">
                    {r.balance == null ? (
                      <span className="text-gray-400">неизвестен</span>
                    ) : (
                      <span className="font-semibold">
                        {r.unit === "$" ? money(r.balance) : `${r.balance.toLocaleString("ru-RU")} ${r.unit}`}
                      </span>
                    )}
                    <div className="text-xs text-gray-400 mt-0.5">{r.source || "нужен ручной ввод"}</div>
                    {r.spent != null && (
                      <div className="text-xs text-gray-400">потрачено {money(r.spent)}</div>
                    )}
                  </td>
                  <td className="py-2.5 pr-3 whitespace-nowrap">
                    {r.topups > 0 ? money(r.topups) : <span className="text-gray-400">—</span>}
                  </td>
                  <td className="py-2.5 pr-3 text-xs text-gray-500 whitespace-nowrap">{when(r.at)}</td>
                  <td className="py-2.5 whitespace-nowrap">
                    <a href={r.link} target="_blank" rel="noreferrer"
                       className="text-brand-600 hover:underline text-xs mr-3">кабинет ↗</a>
                    {canManage && (
                      <button className="text-xs px-2 py-1 rounded border hover:bg-gray-50"
                              onClick={() => setOpen(open === r.service ? "" : r.service)}>
                        {open === r.service ? "закрыть" : "внести"}
                      </button>
                    )}
                    {/* Удаляется только заведённое руками: справочный кошелёк
                        вернётся через час со следующим замером. */}
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
              {r.left == null && " Остаток считается как пополнения минус расход — или вписывается руками."}
            </div>
            <div className="flex flex-wrap gap-2 items-end">
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
            </div>
            <div className="flex flex-wrap gap-2 items-end pt-2 border-t">
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
            </div>
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
