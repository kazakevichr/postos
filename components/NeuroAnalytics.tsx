"use client";

// Нейро-аналитика контента: выводы со значками достоверности, срезы по осям
// паспорта, lead-gen по заявкам и рекомендации с судьбой.
import { useEffect, useState } from "react";

// Значки достоверности: плотная заливка + символ, чтобы различались
// не только цветом.
const conf = (n: number) =>
  n >= 8
    ? { label: `✓ вывод · ${n}`, cls: "bg-emerald-600 text-white" }
    : n >= 4
      ? { label: `~ наблюдение · ${n}`, cls: "bg-amber-500 text-white" }
      : { label: `? гипотеза · ${n}`, cls: "bg-red-600 text-white" };

function PostChips({ ids, posts }: { ids: string[]; posts: any[] }) {
  const found = ids.map((id) => posts.find((p) => p.id === id)).filter(Boolean);
  if (!found.length) return null;
  return (
    <span className="inline-flex gap-1 ml-1 align-middle">
      {found.map((p: any) => (
        <a key={p.id} href={p.permalink} target="_blank" rel="noreferrer"
          title={p.caption}
          className="inline-block w-6 h-6 rounded overflow-hidden border border-gray-200 hover:ring-2 hover:ring-brand-400">
          {p.thumbnail
            ? <img src={p.thumbnail} alt="" className="w-full h-full object-cover" />
            : <span className="block w-full h-full bg-gray-100 text-[10px] text-gray-400 text-center leading-6">↗</span>}
        </a>
      ))}
    </span>
  );
}

function Bars({ title, rows }: { title: string; rows: any[] }) {
  const max = Math.max(1, ...rows.map((r) => r.median));
  return (
    <div className="flex-1 min-w-[210px]">
      <div className="text-xs font-medium text-gray-500 mb-2">{title}</div>
      {rows.length === 0 && <div className="text-xs text-gray-300">пока нет размеченных постов</div>}
      <div className="space-y-1.5">
        {rows.slice(0, 5).map((r) => (
          <div key={r.label} className="flex items-center gap-2 text-xs">
            <span className="w-24 truncate" title={r.label}>{r.label}</span>
            <div className="flex-1 h-3.5 bg-gray-100 rounded">
              <div className="h-3.5 bg-brand-400 rounded" style={{ width: `${(r.median / max) * 100}%` }} />
            </div>
            <span className="text-gray-500 whitespace-nowrap">{r.median} · n={r.n}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function NeuroAnalytics({
  isOwner,
  projectName,
}: {
  isOwner: boolean;
  // Рамки направления живут на сервере: разбираются те же аккаунты, что
  // показывают Соц.Сети. Отсюда нужно только имя — для подписи среза.
  projectName?: string;
}) {
  const [account, setAccount] = useState("all");
  const [days, setDays] = useState(30);
  const [data, setData] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");

  async function load(acc = account, d = days) {
    // Рамки направления сервер знает сам из доступа — присылать их отсюда
    // значило бы позволить браузеру расширить себе видимость.
    const r = await fetch(`/api/analytics?account=${encodeURIComponent(acc)}&days=${d}`);
    if (r.ok) setData(await r.json());
  }
  useEffect(() => { load(); }, [account, days]);

  async function refresh() {
    setBusy(true); setNote("Анализирую…");
    try {
      const r = await fetch("/api/analytics", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "refresh", account, days }),
      });
      const j = await r.json();
      setNote(j.error ? `Не вышло: ${j.error}` : "");
      await load();
    } finally { setBusy(false); }
  }

  async function recAction(action: string, recId: string) {
    await fetch("/api/analytics", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action, recId }),
    });
    await load();
  }

  if (!data) return <div className="p-6 text-gray-400">Загружаю…</div>;
  const ins = data.insight;
  const STATUS: Record<string, { label: string; cls: string }> = {
    new: { label: "● новая", cls: "bg-blue-600 text-white" },
    task: { label: "◐ в работе у СММ", cls: "bg-amber-500 text-white" },
    done: { label: "✓ внедрено", cls: "bg-emerald-600 text-white" },
  };

  return (
    <div className="space-y-4 max-w-6xl">
      <div className="card flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold">🧠 Нейро-аналитика контента</h1>
          <p className="text-xs text-gray-400 mt-0.5">
            {data.stats.total} постов · размечено {data.stats.labeled} · в сравнениях {data.stats.mature} (старше 72 ч)
            {ins && <> · анализ от {new Date(ins.updatedAt).toLocaleString("ru-RU")}</>}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <select value={account} onChange={(e) => setAccount(e.target.value)} className="border rounded-lg px-2 py-1.5 text-sm">
            <option value="all">{projectName ? `Все аккаунты · ${projectName}` : "Все аккаунты"}</option>
            {data.accounts.map((a: string) => <option key={a} value={a}>@{a}</option>)}
          </select>
          <select value={days} onChange={(e) => setDays(Number(e.target.value))} className="border rounded-lg px-2 py-1.5 text-sm">
            {[14, 30, 60, 90].map((d) => <option key={d} value={d}>{d} дней</option>)}
          </select>
          {isOwner && (
            <button onClick={refresh} disabled={busy} className="btn btn-primary text-sm">
              {busy ? "Анализирую…" : "✨ Обновить анализ"}
            </button>
          )}
        </div>
      </div>
      {note && <p className="text-sm text-gray-500">{note}</p>}

      {ins && (
        <div className="card border-l-4 border-brand-500">
          <div className="text-sm font-semibold mb-1">Главный вывод</div>
          <p className="text-sm text-gray-600 leading-relaxed">{ins.summary}</p>
        </div>
      )}

      {ins && (
        <div className="grid md:grid-cols-2 gap-4">
          {[
            { title: "✅ Что заходит", items: ins.working },
            { title: "❌ Что не заходит", items: ins.not_working },
          ].map((col) => (
            <div key={col.title} className="card">
              <div className="text-sm font-semibold mb-3">{col.title}</div>
              <div className="space-y-3">
                {col.items.map((w: any, i: number) => {
                  const c = conf(w.n);
                  return (
                    <div key={i}>
                      <div className="text-sm font-medium flex items-center gap-2 flex-wrap">
                        {w.pattern}
                        <span className={`text-[11px] px-2 rounded-full ${c.cls}`}>{c.label}</span>
                        <PostChips ids={w.example_ids || []} posts={data.posts} />
                      </div>
                      <div className="text-xs text-gray-500 leading-relaxed">{w.evidence}</div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="card">
        <div className="text-sm font-semibold">🪪 Срезы по паспорту</div>
        <p className="text-xs text-gray-400 mb-3">медианный охват · посты старше 72 часов</p>
        <div className="flex flex-wrap gap-6">
          <Bars title="Содержание" rows={data.slices.content} />
          <Bars title="Хук" rows={data.slices.hook} />
          <Bars title="Визуал в кадре" rows={data.slices.visual || []} />
          <Bars title="Происхождение" rows={data.slices.origin} />
        </div>
      </div>

      <div className="card">
        <div className="text-sm font-semibold">🎯 Lead-gen: заявки, а не охват</div>
        <p className="text-xs text-gray-400 mb-2">заявка = комментарий с кодовым словом</p>
        {data.leadgen.length === 0 ? (
          <p className="text-sm text-gray-400">Пока нет размеченных lead-gen постов с подсчитанными заявками — они появятся после ближайшего прогона разметки.</p>
        ) : (
          <table className="w-full text-sm">
            <thead><tr className="text-left text-gray-400 text-xs">
              <th className="py-1 pr-3 font-normal">Кодовое слово</th><th className="py-1 pr-3 font-normal">Постов</th>
              <th className="py-1 pr-3 font-normal">Охват</th><th className="py-1 pr-3 font-normal">Заявок</th>
              <th className="py-1 font-normal">Заявок на 100 охвата</th>
            </tr></thead>
            <tbody>
              {data.leadgen.map((g: any) => (
                <tr key={g.word} className="border-t">
                  <td className="py-1.5 pr-3 font-medium">{g.word}</td>
                  <td className="py-1.5 pr-3">{g.posts}</td>
                  <td className="py-1.5 pr-3">{g.reach}</td>
                  <td className={`py-1.5 pr-3 font-medium ${g.leads ? "text-emerald-700" : "text-red-600"}`}>{g.leads}</td>
                  <td className="py-1.5">{g.per100}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="card">
        <div className="text-sm font-semibold mb-3">📌 Рекомендации и их судьба</div>
        {data.recommendations.length === 0 && (
          <p className="text-sm text-gray-400">Рекомендации появятся после первого анализа.</p>
        )}
        <div className="space-y-2.5">
          {data.recommendations.map((rec: any) => {
            const st = STATUS[rec.status] || STATUS.new;
            return (
              <div key={rec.id} className="flex items-start gap-3 flex-wrap">
                <span className={`text-[11px] px-2 py-0.5 rounded-full whitespace-nowrap mt-0.5 ${st.cls}`}>{st.label}</span>
                <div className="flex-1 min-w-[220px]">
                  <div className="text-sm">{rec.text}</div>
                  {rec.status === "done" && (
                    <div className="text-xs text-emerald-700">
                      внедрено {rec.doneAt ? new Date(rec.doneAt).toLocaleDateString("ru-RU") : ""}
                      {rec.effect && <> · {rec.effect}</>}
                    </div>
                  )}
                </div>
                {isOwner && rec.status === "new" && (
                  <span className="flex gap-1.5">
                    <button onClick={() => recAction("task", rec.id)} className="btn text-xs">→ в задачи СММ</button>
                    <button onClick={() => recAction("dismiss", rec.id)} className="btn text-xs text-gray-400">скрыть</button>
                  </span>
                )}
                {isOwner && rec.status === "task" && (
                  <button onClick={() => recAction("done", rec.id)} className="btn text-xs">внедрено ✓</button>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {ins && (
        <div className="grid md:grid-cols-2 gap-4">
          {[
            { title: "🏆 Топ периода", ids: ins.top_post_ids },
            { title: "📉 Антитоп", ids: ins.flop_post_ids },
          ].map((col) => (
            <div key={col.title} className="card">
              <div className="text-sm font-semibold mb-2">{col.title}</div>
              <div className="space-y-2">
                {col.ids.map((id: string) => {
                  const p = data.posts.find((x: any) => x.id === id);
                  if (!p) return null;
                  return (
                    <a key={id} href={p.permalink} target="_blank" rel="noreferrer"
                      className="flex items-center gap-2 hover:bg-gray-50 rounded-lg p-1 -m-1">
                      {p.thumbnail
                        ? <img src={p.thumbnail} alt="" className="w-9 h-9 rounded object-cover" />
                        : <span className="w-9 h-9 rounded bg-gray-100" />}
                      <span className="text-xs text-gray-600 line-clamp-2 flex-1">{p.caption || p.permalink}</span>
                      <span className="text-sm font-medium">{p.reach ?? ""}</span>
                    </a>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      <p className="text-xs text-gray-400 flex gap-4 flex-wrap">
        <span><span className="px-2 py-0.5 rounded-full bg-emerald-600 text-white">✓ вывод</span> 8+ постов</span>
        <span><span className="px-2 py-0.5 rounded-full bg-amber-500 text-white">~ наблюдение</span> 4–7</span>
        <span><span className="px-2 py-0.5 rounded-full bg-red-600 text-white">? гипотеза</span> 1–3</span>
      </p>
    </div>
  );
}
