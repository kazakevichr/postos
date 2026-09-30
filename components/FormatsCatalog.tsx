"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AnketaForm, Fmt, Preview, State, StatusPill, api, statsLine } from "@/components/formatsUi";

// Каталог форматов проекта.
//
// Сверху — запуск нового проекта в три шага (анкета → форматы → аккаунты),
// ниже — что уже в проекте и что можно добавить. Каждый формат открывается
// карточкой с настоящим примером, тем, как он делается, и тем, что нужно от
// проекта: решать «брать или нет» по названию нельзя.

export default function FormatsCatalog() {
  const router = useRouter();
  const [s, setS] = useState<State | null>(null);
  const [err, setErr] = useState("");
  const [open, setOpen] = useState("");
  const [anketaOpen, setAnketaOpen] = useState(false);
  const [busy, setBusy] = useState("");
  const [accounts, setAccounts] = useState<{ total: number; connected: number } | null>(null);

  async function load() {
    const d = await fetch("/api/formats").then((r) => r.json()).catch(() => null);
    if (!d || d.error) return setErr(d?.error || "каталог не загрузился");
    setS(d);
    const a = await fetch("/api/social/accounts").then((r) => r.json()).catch(() => null);
    const p = (a?.projects || []).find((x: any) => x.brand === d.brand);
    if (p) {
      const profiles = p.profiles || [];
      setAccounts({ total: profiles.length, connected: profiles.filter((x: any) => x.platforms.some((c: any) => c.connected)).length });
    }
  }
  useEffect(() => { load(); }, []);

  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === "Escape" && (setOpen(""), setAnketaOpen(false));
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, []);

  async function add(kind: string) {
    setBusy(kind); setErr("");
    try { await api({ action: "add", kind }); router.push(`/formats/${kind}`); }
    catch (e: any) { setErr(e.message); setBusy(""); }
  }

  if (err && !s) return <div className="card text-red-700">{err}</div>;
  if (!s) return <div className="text-sm text-gray-400">Загружаю каталог…</div>;

  const mine = s.catalog.filter((f) => f.running || f.added);
  const free = s.catalog.filter((f) => !f.running && !f.added && !f.blocked);
  const locked = s.catalog.filter((f) => !f.running && !f.added && f.blocked);
  const cur = s.catalog.find((f) => f.kind === open);
  const added = s.catalog.filter((f) => f.added).length;

  const launch = [
    {
      n: 1, title: "Анкета проекта", done: Boolean(s.anketa) || s.coded,
      text: s.coded ? "Бриф выверен вручную" : s.anketa ? "Заполнена — из неё пишутся темы и тексты" : "8 вопросов: о чём, для кого, каким тоном",
      action: s.canEdit && !s.coded ? { label: s.anketa ? "Изменить" : "Заполнить", go: () => setAnketaOpen(true) } : null,
    },
    {
      n: 2, title: "Форматы", done: mine.length > 0,
      text: mine.length ? `${mine.length} в проекте` : "Выберите, что будет делать завод",
      action: null,
    },
    {
      n: 3, title: "Аккаунты публикации", done: Boolean(accounts?.connected),
      text: accounts == null ? "Куда выкладывать готовое" : accounts.connected ? `подключено ${accounts.connected} из ${accounts.total}` : "Ни одной площадки ещё не подключено",
      action: { label: "Открыть", go: () => router.push("/social") },
    },
  ];

  return (
    <div className="space-y-8 max-w-6xl">
      <div>
        <a href="/factory" className="text-sm text-gray-400 hover:text-brand-700">← Контент-завод</a>
        <h1 className="text-2xl font-semibold mt-1">Форматы · {s.title}</h1>
        <p className="text-sm text-gray-500 mt-1 max-w-2xl">
          Что умеет делать завод. Откройте формат — внутри настоящий пример, как он делается и что нужно от проекта.
        </p>
      </div>

      {!s.coded && (
        <div className="grid sm:grid-cols-3 gap-3">
          {launch.map((st) => (
            <div key={st.n} className={`rounded-2xl border p-4 flex gap-3 ${st.done ? "bg-green-50/50 border-green-200" : "bg-white"}`}>
              <div className={`shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-sm font-semibold ${st.done ? "bg-green-600 text-white" : "bg-gray-100 text-gray-500"}`}>
                {st.done ? "✓" : st.n}
              </div>
              <div className="min-w-0">
                <div className="font-medium text-sm">{st.title}</div>
                <div className="text-xs text-gray-500 mt-0.5">{st.text}</div>
                {st.action && (
                  <button className="text-xs text-brand-700 hover:underline mt-1.5" onClick={st.action.go}>{st.action.label} →</button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {s.coded && (
        <div className="rounded-xl bg-gray-50 border px-4 py-3 text-sm text-gray-600">
          Проект работает на своём заводе: его форматы, расписание и каналы — в «Контент-заводе».
          Здесь можно посмотреть весь каталог и добавить новое.
        </div>
      )}

      {err && <p className="text-sm text-red-700 bg-red-50 rounded-lg px-3 py-2">{err}</p>}

      {mine.length > 0 && (
        <section>
          <h2 className="font-semibold mb-3">В проекте</h2>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {mine.map((f) => <Card key={f.kind} f={f} onOpen={() => (f.added && !f.running ? router.push(`/formats/${f.kind}`) : setOpen(f.kind))} />)}
          </div>
        </section>
      )}

      {free.length > 0 && (
        <section>
          <h2 className="font-semibold">Можно добавить</h2>
          <p className="text-xs text-gray-400 mb-3">Цифры — средние по заказам наших заводов, не обещания.</p>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {free.map((f) => <Card key={f.kind} f={f} onOpen={() => setOpen(f.kind)} />)}
          </div>
        </section>
      )}

      {locked.length > 0 && (
        <section>
          <h2 className="font-semibold mb-3 text-gray-500">Пока не для нового проекта</h2>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {locked.map((f) => <Card key={f.kind} f={f} muted onOpen={() => setOpen(f.kind)} />)}
          </div>
        </section>
      )}

      {cur && (
        <Modal onClose={() => setOpen("")}>
          <div className="grid md:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
            <div className="bg-gray-950 flex items-center justify-center md:rounded-l-2xl overflow-hidden">
              {cur.media === "video" && cur.video ? (
                <video src={cur.video} poster={cur.video.replace(/\.mp4$/, ".jpg")} controls autoPlay muted loop playsInline className="w-full max-h-[80vh] object-contain" />
              ) : cur.media === "pics" && cur.pics ? (
                <div className="flex gap-2 overflow-x-auto snap-x p-3 w-full">
                  {cur.pics.map((p) => <img key={p} src={p} alt="" className="snap-center h-[60vh] max-h-[520px] aspect-[4/5] object-cover rounded-lg" />)}
                </div>
              ) : (
                <div className="py-24 text-gray-500 text-sm">Примера пока нет</div>
              )}
            </div>
            <div className="p-5 md:p-6 space-y-5">
              <div>
                <div className="flex items-center gap-2 flex-wrap">
                  <h3 className="text-xl font-semibold">{cur.name}</h3>
                  <StatusPill f={cur} />
                  {cur.easy && !cur.running && <span className="text-[11px] px-2 py-0.5 rounded-full bg-brand-50 text-brand-700">быстрый старт</span>}
                </div>
                <p className="text-gray-600 mt-1">{cur.line}</p>
                <p className="text-xs text-gray-400 mt-1">
                  Работает в {cur.runsAt}{statsLine(cur.stats) ? ` · ${statsLine(cur.stats)}` : ""}
                </p>
              </div>

              <div>
                <div className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-2">Как делается</div>
                <ol className="space-y-1.5">
                  {cur.how.map((h, i) => (
                    <li key={i} className="flex gap-2.5 text-sm">
                      <span className="shrink-0 w-5 h-5 rounded-full bg-gray-100 text-gray-500 text-[11px] flex items-center justify-center">{i + 1}</span>
                      <span>{h}</span>
                    </li>
                  ))}
                </ol>
              </div>

              <div>
                <div className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-2">Что нужно от проекта</div>
                <div className="space-y-2">
                  {cur.need.map((n) => (
                    <div key={n.title} className="flex gap-3 rounded-xl border px-3 py-2">
                      <div className="text-lg leading-6">{n.icon}</div>
                      <div className="text-sm"><span className="font-medium">{n.title}</span> <span className="text-gray-500">— {n.text}</span></div>
                    </div>
                  ))}
                </div>
              </div>

              {cur.warn && <div className="text-sm rounded-xl bg-amber-50 text-amber-900 px-3 py-2">{cur.warn}</div>}

              <div className="pt-1">
                {cur.running ? (
                  <a href="/factory" className="btn btn-secondary">Уже работает — открыть пульт</a>
                ) : cur.added ? (
                  <a href={`/formats/${cur.kind}`} className="btn btn-primary">Настроить →</a>
                ) : cur.blocked ? (
                  <div className="text-sm rounded-xl bg-gray-100 text-gray-600 px-3 py-2">{cur.blocked}</div>
                ) : s.canEdit ? (
                  <button className="btn btn-primary px-5 py-2" disabled={busy === cur.kind} onClick={() => add(cur.kind)}>
                    {busy === cur.kind ? "Добавляю…" : `Добавить в «${s.title}»`}
                  </button>
                ) : (
                  <div className="text-sm text-gray-500">Добавить может тот, у кого есть право изменения в проекте.</div>
                )}
              </div>
            </div>
          </div>
        </Modal>
      )}

      {anketaOpen && (
        <Modal onClose={() => setAnketaOpen(false)} narrow>
          <div className="p-5 md:p-6">
            <h3 className="text-xl font-semibold">Анкета проекта</h3>
            <p className="text-sm text-gray-500 mt-1 mb-4">Одна на все форматы. Из неё модель придумывает темы и пишет тексты.</p>
            <AnketaForm initial={s.anketa} onSaved={(d) => { setS({ ...d, canEdit: s.canEdit }); setAnketaOpen(false); }} />
          </div>
        </Modal>
      )}
    </div>
  );
}

function Card({ f, onOpen, muted }: { f: Fmt; onOpen: () => void; muted?: boolean }) {
  const st = statsLine(f.stats);
  return (
    <button onClick={onOpen}
      className={`group text-left rounded-2xl border bg-white overflow-hidden transition hover:shadow-lg hover:-translate-y-0.5 ${muted ? "opacity-60 hover:opacity-100" : ""}`}>
      <Preview f={f} />
      <div className="p-4">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-semibold">{f.name}</span>
          <StatusPill f={f} />
          {f.easy && !f.running && !f.added && <span className="text-[11px] px-2 py-0.5 rounded-full bg-brand-50 text-brand-700">быстрый старт</span>}
        </div>
        <div className="text-sm text-gray-600 mt-1">{f.line}</div>
        <div className="text-[11px] text-gray-400 mt-2">
          {muted && f.blocked ? f.blocked : `Работает в ${f.runsAt}${st ? ` · ${st}` : ""}`}
        </div>
      </div>
    </button>
  );
}

function Modal({ children, onClose, narrow }: { children: React.ReactNode; onClose: () => void; narrow?: boolean }) {
  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-start md:items-center justify-center p-0 md:p-6 overflow-y-auto" onClick={onClose}>
      <div className={`relative bg-white w-full ${narrow ? "max-w-xl" : "max-w-5xl"} md:rounded-2xl shadow-2xl min-h-full md:min-h-0`}
        onClick={(e) => e.stopPropagation()}>
        <button onClick={onClose} aria-label="Закрыть"
          className="absolute right-3 top-3 z-10 w-8 h-8 rounded-full bg-white/90 shadow text-gray-500 hover:text-gray-900">✕</button>
        {children}
      </div>
    </div>
  );
}
