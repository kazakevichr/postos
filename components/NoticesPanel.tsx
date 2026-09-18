"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

// Уровни: важное — работа встала или встанет; внимание — идёт не так, но
// работает; к сведению — руки дойдут. Сортируем по важности, а не по
// разделам: человек открывает список, чтобы понять, что горит.
const LEVELS = [
  { key: "crit", label: "важное", dot: "bg-red-600" },
  { key: "warn", label: "внимание", dot: "bg-yellow-500" },
  { key: "info", label: "к сведению", dot: "bg-brand-600" },
];

const KINDS: Record<string, string> = {
  wallet: "Кошельки",
  meta: "Площадки",
  factory: "Завод",
  tasks: "Задачи",
  access: "Доступы",
  analytics: "Аналитика",
  plan: "План",
};

type Notice = {
  key: string; kind: string; level: string; title: string; body: string;
  href: string; actionText: string; times: number; firstAt: string; lastAt: string; read: boolean;
};

const when = (iso: string) => {
  const d = new Date(iso);
  const mins = Math.round((Date.now() - +d) / 60000);
  if (mins < 60) return `${mins} мин назад`;
  if (mins < 60 * 24) return `${Math.round(mins / 60)} ч назад`;
  return d.toLocaleDateString("ru-RU", { day: "numeric", month: "long" });
};

export default function NoticesPanel({ initial }: { initial: Notice[] }) {
  const [notices, setNotices] = useState(initial);
  const [kind, setKind] = useState("all");
  const [onlyUnread, setOnlyUnread] = useState(false);

  useEffect(() => {
    const t = setInterval(() => {
      fetch("/api/notices").then((r) => r.json()).then((d) => setNotices(d.notices || [])).catch(() => {});
    }, 60 * 1000);
    return () => clearInterval(t);
  }, []);

  const kinds = useMemo(() => [...new Set(notices.map((n) => n.kind))], [notices]);
  const shown = notices.filter(
    (n) => (kind === "all" || n.kind === kind) && (!onlyUnread || !n.read)
  );

  // Отложить: беда настоящая, ею занимаются, напоминать каждый день незачем.
  // Не «прочитано» — прочитанное остаётся на виду; и не «погашено» — причина
  // никуда не делась.
  async function snoozeOne(key: string, days: number) {
    setNotices((prev) => prev.filter((n) => n.key !== key));
    await fetch("/api/notices", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "snooze", key, days }),
    });
  }

  async function readAll() {
    setNotices((prev) => prev.map((n) => ({ ...n, read: true })));
    await fetch("/api/notices", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
  }

  const chip = (on: boolean) =>
    `px-3 py-1.5 rounded-lg text-sm ${on ? "bg-brand-600 text-white" : "bg-white border hover:bg-gray-50"}`;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold mb-1">Уведомления</h1>
        <p className="text-sm text-gray-500">
          Всё, что требует внимания, по всем разделам · повторы склеены · копия важного уходит в Телеграм
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button className={chip(!onlyUnread)} onClick={() => setOnlyUnread(false)}>Все</button>
        <button className={chip(onlyUnread)} onClick={() => setOnlyUnread(true)}>Непрочитанные</button>
        <span className="w-px h-6 bg-gray-200 mx-1" />
        <button className={chip(kind === "all")} onClick={() => setKind("all")}>Везде</button>
        {kinds.map((k) => (
          <button key={k} className={chip(kind === k)} onClick={() => setKind(k)}>{KINDS[k] || k}</button>
        ))}
        <span className="flex-1" />
        <button className="text-brand-700 text-sm" onClick={readAll}>Отметить всё прочитанным</button>
      </div>

      {LEVELS.map((lvl) => {
        const rows = shown.filter((n) => n.level === lvl.key);
        if (!rows.length) return null;
        return (
          <div key={lvl.key}>
            <div className="flex items-center gap-2 mb-2">
              <span className={`w-2 h-2 rounded-full ${lvl.dot}`} />
              <h2 className="font-semibold text-[15px]">{lvl.label} · {rows.length}</h2>
            </div>
            <div className="card p-0 divide-y divide-gray-100">
              {rows.map((n) => (
                <div key={n.key} className={`flex gap-3 p-4 ${n.read ? "opacity-60" : ""}`}>
                  <span className={`w-2 h-2 rounded-full mt-2 shrink-0 ${lvl.dot}`} />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium text-sm">{n.title}</span>
                      {n.times > 1 && (
                        <span className="text-[11px] bg-gray-100 text-gray-600 px-2 py-px rounded-full">
                          {n.times} раза
                        </span>
                      )}
                      <span className="text-[11px] bg-brand-50 text-brand-700 px-2 py-px rounded-full">
                        {KINDS[n.kind] || n.kind}
                      </span>
                    </div>
                    {n.body && <div className="text-[13px] text-gray-500 mt-1 leading-5">{n.body}</div>}
                    <div className="text-xs text-gray-400 mt-1">{when(n.lastAt)}</div>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0 self-start">
                    <button className="btn btn-secondary" title="Скрыть на неделю: этим уже занимаются"
                      onClick={() => snoozeOne(n.key, 7)}>
                      Отложить
                    </button>
                    {n.href && (
                      <Link href={n.href} className="btn btn-secondary">
                        {n.actionText || "Открыть"} →
                      </Link>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        );
      })}

      {!shown.length && (
        <div className="card text-sm text-gray-500">
          Ничего не требует внимания. Уведомления гаснут сами, когда причина исчезает:
          кошелёк пополнили, завод опубликовал, задачу закрыли. Отложенные вернутся,
          когда выйдет срок.
        </div>
      )}
    </div>
  );
}
