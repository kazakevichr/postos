"use client";

// «Соц.Сети»: все платформы и проекты на одном экране. Три фильтра —
// платформа, проект, профиль — плюс период. Кнопки сбора нет: данные
// обновляет сам сервер каждые 20 минут (instrumentation.ts).
import { useEffect, useMemo, useState } from "react";
import PeriodPicker, { Range, rangeDays, rangeFor } from "@/components/PeriodPicker";
import { BRAND_NAMES } from "@/lib/brands";

const PLATFORM_NAMES: Record<string, string> = {
  instagram: "📸 Инстаграм",
  youtube: "📺 Ютуб",
  tiktok: "🎵 ТикТок",
};
const LANG_NAMES: Record<string, string> = {
  ru: "🇷🇺", en: "🇺🇸", "en-in": "🇮🇳", es: "🇪🇸", pt: "🇧🇷", tr: "🇹🇷",
};

const fmt = (n: any) => (n == null ? "—" : Number(n).toLocaleString("ru-RU"));

// Рост/снижение к прошлому периоду: ▲ +12% зелёным, ▼ −5% красным
function Delta({ cur, prev }: { cur: number; prev: number }) {
  if (!prev) return cur > 0 ? <span className="text-gray-400">новое</span> : null;
  const pct = ((cur - prev) / prev) * 100;
  if (Math.abs(pct) < 0.05) return <span className="text-gray-400">без изменений</span>;
  return (
    <span className={pct > 0 ? "text-green-600" : "text-red-600"}>
      {pct > 0 ? "▲" : "▼"} {Math.abs(pct) >= 100 ? Math.round(Math.abs(pct)) : Math.abs(pct).toFixed(1)}%
    </span>
  );
}

// Абсолютное изменение для малых величин (подписчики): +6 / −2, где проценты
// врут — +1 подписчик на 2000 это 0.05% и «без изменений», хотя рост есть.
function AbsDelta({ cur, prev }: { cur: number; prev: number }) {
  const d = cur - prev;
  if (d === 0) return <span className="text-gray-400">без изменений</span>;
  return (
    <span className={d > 0 ? "text-green-600" : "text-red-600"}>
      {d > 0 ? "▲ +" : "▼ −"}{fmt(Math.abs(d))}
    </span>
  );
}

// Мини-график тренда (как у CoinMarketCap): линия без осей и подписей
function Spark({ points, up }: { points: number[]; up: boolean }) {
  if (points.length < 2) return null;
  const min = Math.min(...points);
  const max = Math.max(...points);
  const xy = points.map((v, i) => {
    const x = (i / (points.length - 1)) * 100;
    const y = max === min ? 15 : 28 - ((v - min) / (max - min)) * 26;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  return (
    <svg viewBox="0 0 100 30" preserveAspectRatio="none" className="w-24 h-8 shrink-0">
      <polyline points={xy.join(" ")} fill="none" strokeWidth="2"
        stroke={up ? "#16a34a" : "#dc2626"} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

function humanError(e: string): string {
  if (e.includes("17841435633230475") || e.toLowerCase().includes("does not exist")) {
    const id = e.split(":")[0].trim();
    return `${id === "17841435633230475" ? "superfit24_training" : id}: аккаунт отвязан от Business Manager — добавь его в портфолио заново и назначь HQ Bot`;
  }
  return e;
}

export default function SocialDashboard({
  canManage = true,
  brands: only,
  projectName,
}: {
  canManage?: boolean;
  // Бренды выбранного направления. Заданы — показываем только их и убираем
  // переключатель проектов: он выбирал бы то, чего человеку видеть нечего.
  brands?: string[];
  projectName?: string;
}) {
  const [allRaw, setAll] = useState<any[]>([]);
  const [range, setRange] = useState<Range>(() => rangeFor("7"));
  const [platform, setPlatform] = useState("all");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [brand, setBrand] = useState("all");
  const [profile, setProfile] = useState("all");
  // Вкладка: живые аккаунты или архив. Архив — не отдельная страница: он про
  // те же карточки, просто выключенные.
  const [view, setView] = useState<"live" | "arch">("live");
  // Какую карточку сейчас спрашивают «точно архивировать?». Архивация гасит
  // маршруты публикации — это не то, что делают случайным кликом.
  const [asking, setAsking] = useState("");
  // Кому сейчас пишут заметку и что именно. «Ждём документы от Меты» — знание,
  // которого нет ни в одном ответе площадки.
  const [noting, setNoting] = useState("");
  const [noteText, setNoteText] = useState("");

  async function load() {
    const r = await fetch("/api/social/stats");
    const j = await r.json();
    setAll(j.accounts || []);
  }
  useEffect(() => {
    load();
    const t = setInterval(load, 5 * 60 * 1000); // подтягиваем свежие срезы фоном
    return () => clearInterval(t);
  }, []);

  // Ручной сбор поверх автоматического: авто идёт раз в 20 минут, кнопка —
  // когда нужно оперативно (после публикации, перед созвоном).
  async function collectNow() {
    setBusy(true);
    setNote("Собираю: Инстаграм + Ютуб/ТикТок…");
    try {
      const [ig, or_] = await Promise.all([
        fetch("/api/insta/collect", { method: "POST" }).then((r) => r.json()).catch((e) => ({ errors: [String(e)] })),
        fetch("/api/oracle/collect", { method: "POST" }).then((r) => r.json()).catch((e) => ({ errors: [String(e)] })),
      ]);
      const errors = [...(ig.errors || []), ...(or_.errors || [])].map(humanError);
      setNote(
        `Собрано: Инстаграм ${ig.accounts ?? 0} акк., Оракл ${or_.channels ?? 0} канал.` +
        (errors.length ? ` ⚠️ ${errors.join("; ")}` : "")
      );
      await load();
    } finally {
      setBusy(false);
    }
  }

  // Архивация и возврат. Кнопка живёт в самой карточке, потому что решение
  // принимают глядя на аккаунт, а не на список где-то внизу страницы.
  async function archive(id: string, action: "archive" | "restore") {
    setBusy(true);
    try {
      const r = await fetch("/api/social/archive", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, action }),
      }).then((x) => x.json());
      setNote(
        r.error
          ? `Не вышло: ${r.error}`
          : action === "archive"
            ? `@${r.username} в архиве${r.routeOff ? `, маршрут «${r.platform}» выключен` : ""}. Цифры сохранены.`
            : `@${r.username} возвращён. Маршруты остались выключенными — включите вручную, когда будете готовы.`
      );
      setAsking("");
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function saveNote(id: string) {
    setBusy(true);
    try {
      await fetch("/api/social/archive", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, action: "note", note: noteText }),
      });
      setNoting("");
      setNoteText("");
      await load();
    } finally {
      setBusy(false);
    }
  }

  // Аккаунты вне направления не должны попадать даже в подсчёты, поэтому
  // режем не на показе, а на входе.
  const inBrand = useMemo(
    () => (only ? allRaw.filter((a) => only.includes(a.brand)) : allRaw),
    [allRaw, only]
  );
  // Архивный аккаунт не должен попадать ни в плитки, ни в графики: его цифры
  // заморожены, и подмешивание их в суммы выглядит как провал по подписчикам.
  const all = useMemo(() => inBrand.filter((a) => !a.archived), [inBrand]);
  const archivedAccounts = useMemo(() => inBrand.filter((a) => a.archived), [inBrand]);
  // Оси фильтров строятся от данных: появится новая платформа — появится чип
  const platforms = useMemo(() => [...new Set(all.map((a) => a.platform))], [all]);
  const brands = useMemo(() => [...new Set(all.map((a) => a.brand))], [all]);
  const profileOptions = useMemo(
    () => all.filter((a) => (platform === "all" || a.platform === platform) && (brand === "all" || a.brand === brand)),
    [all, platform, brand]
  );

  const accounts = useMemo(
    () => profileOptions.filter((a) => profile === "all" || a.id === profile),
    [profileOptions, profile]
  );

  useEffect(() => {
    if (profile !== "all" && !profileOptions.some((a) => a.id === profile)) setProfile("all");
  }, [profileOptions, profile]);

  // Границы периода: обе включительно. Прошлый период — такой же длины,
  // приставленный слева, чтобы сравнение было честным при любом диапазоне.
  const period = rangeDays(range);
  const edgeDate = range.from;
  const topDate = range.to;
  const edgeIso = `${range.from}T00:00:00.000Z`;
  const topIso = `${range.to}T23:59:59.999Z`;
  const shift = (date: string, days: number) =>
    new Date(Date.parse(`${date}T00:00:00Z`) - days * 864e5).toISOString().slice(0, 10);
  const prevEdgeDate = shift(edgeDate, period);
  const prevEdgeIso = `${prevEdgeDate}T00:00:00.000Z`;

  const followers = accounts.reduce((s, a) => s + (a.followers || 0), 0);
  const fDelta = useMemo(() => {
    let now = 0, then = 0;
    for (const a of accounts) {
      const hist = (a.history || []).filter((h: any) => h.followers != null);
      if (!hist.length) continue;
      now += hist[hist.length - 1].followers;
      const old = hist.filter((h: any) => h.date <= edgeDate);
      then += old.length ? old[old.length - 1].followers : hist[0].followers;
    }
    return now - then;
  }, [accounts, edgeDate]);

  const sumHist = (field: string, from = edgeDate, to = topDate) =>
    accounts.reduce((s, a) => s + (a.history || []).filter((h: any) => h.date >= from && h.date <= to).reduce((x: number, h: any) => x + (h[field] || 0), 0), 0);

  const posts = useMemo(
    () => accounts
      .flatMap((a) => (a.media || []).map((m: any) => ({ ...m, username: a.username, source: m.source ?? a.source, platform: a.platform, lang: a.lang })))
      .filter((m) => m.timestamp)
      .sort((a, b) => (b.timestamp || "").localeCompare(a.timestamp || "")),
    [accounts]
  );
  const periodPosts = posts.filter((p) => p.timestamp >= edgeIso && p.timestamp <= topIso);
  const prevPosts = posts.filter((p) => p.timestamp >= prevEdgeIso && p.timestamp < edgeIso);
  const sumPosts = (f: string, list = periodPosts) => list.reduce((s, p) => s + (p[f] || 0), 0);

  const tiles: any[] = [
    {
      label: "Подписчики", value: fmt(followers),
      sub: fDelta === 0 ? `без изменений за ${period} дн` : `${fDelta > 0 ? "↑ +" : "↓ "}${fmt(fDelta)} за ${period} дн`,
      subClass: fDelta > 0 ? "text-green-600" : fDelta < 0 ? "text-red-600" : "text-gray-500",
    },
    {
      label: `Просмотры за ${period} дн`,
      value: fmt(sumHist("views")),
      delta: { cur: sumHist("views"), prev: sumHist("views", prevEdgeDate, shift(edgeDate, 1)) },
      note: sumHist("views") === 0 && sumPosts("views") > 0 ? "история копится с 19.08" : "",
    },
    {
      label: `Постов за ${period} дн`, value: fmt(periodPosts.length),
      delta: { cur: periodPosts.length, prev: prevPosts.length },
      note: `завод ${periodPosts.filter((p) => p.source === "factory").length} · вручную ${periodPosts.filter((p) => p.source !== "factory").length}`,
    },
    { label: `Лайки за ${period} дн`, value: fmt(sumPosts("likes")), delta: { cur: sumPosts("likes"), prev: sumPosts("likes", prevPosts) } },
    { label: `Сейвы за ${period} дн`, value: fmt(sumPosts("saved")), delta: { cur: sumPosts("saved"), prev: sumPosts("saved", prevPosts) } },
    { label: `Репосты за ${period} дн`, value: fmt(sumPosts("shares")), delta: { cur: sumPosts("shares"), prev: sumPosts("shares", prevPosts) } },
  ];

  const daily = useMemo(() => {
    const byDate: Record<string, { views: number; reach: number }> = {};
    for (const a of accounts) {
      for (const h of a.history || []) {
        if (h.date < edgeDate || h.date > topDate) continue;
        const d = (byDate[h.date] ||= { views: 0, reach: 0 });
        d.views += h.views || 0;
        d.reach += h.reach || 0;
      }
    }
    return Object.entries(byDate).sort(([a], [b]) => a.localeCompare(b));
  }, [accounts, edgeDate, topDate]);

  const factoryStatus = useMemo(() => {
    if (platform !== "all" && platform !== "instagram") return null;
    if (brand !== "all" && brand !== "superfit") return null;
    const last = posts
      .filter((p) => p.platform === "instagram" && p.source === "factory")
      .map((p) => p.timestamp).sort().at(-1);
    if (!last) return { text: "заводских постов ещё нет", ok: false };
    const hours = Math.round((Date.now() - +new Date(last)) / 36e5);
    const when = hours < 1 ? "меньше часа назад" : hours < 24 ? `${hours} ч назад` : `${Math.round(hours / 24)} дн назад`;
    return { text: `последний пост ${when}`, ok: hours <= 36 };
  }, [posts, platform, brand]);

  const maxViews = Math.max(1, ...posts.slice(0, 120).map((p) => p.views || 0));
  const byDay: [string, any[]][] = useMemo(() => {
    const m: Record<string, any[]> = {};
    for (const p of posts.slice(0, 120)) (m[(p.timestamp || "").slice(0, 10)] ||= []).push(p);
    return Object.entries(m);
  }, [posts]);

  const scope = `${platform}|${brand}|${profile}|${range.from}|${range.to}`;
  useEffect(() => {
  }, [scope]);



  // Хитмап «день × часы» считаем сами из постов — модели он не нужен
  const heat = useMemo(() => {
    const buckets = [[6, 9], [9, 12], [12, 15], [15, 17], [17, 19], [19, 22]];
    const grid: number[][] = Array.from({ length: 7 }, () => buckets.map(() => 0));
    const cnt: number[][] = Array.from({ length: 7 }, () => buckets.map(() => 0));
    for (const p of posts) {
      const d = new Date(p.timestamp);
      const msk = new Date(d.toLocaleString("en-US", { timeZone: "Europe/Moscow" }));
      const day = (msk.getDay() + 6) % 7;
      const hour = msk.getHours();
      const bi = buckets.findIndex(([a, b]) => hour >= a && hour < b);
      if (bi < 0) continue;
      grid[day][bi] += p.views || 0;
      cnt[day][bi]++;
    }
    const avg = grid.map((row, d) => row.map((v, i) => (cnt[d][i] ? v / cnt[d][i] : 0)));
    const max = Math.max(1, ...avg.flat());
    return { avg, max, buckets, has: cnt.flat().some((c) => c > 0) };
  }, [posts]);

  const postById = useMemo(() => new Map(posts.map((p) => [p.id, p])), [posts]);

  const updatedAt = accounts.length
    ? new Date(Math.max(...accounts.map((a) => +new Date(a.updatedAt)))).toLocaleString("ru-RU")
    : "ещё не собиралось";

  const chip = (on: boolean) =>
    `px-3 py-1.5 rounded-lg text-sm ${on ? "bg-brand-600 text-white" : "bg-white border hover:bg-gray-50"}`;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold mb-1">Соц.Сети</h1>
          <p className="text-sm text-gray-500">
            Все платформы и проекты · обновлено {updatedAt} · авто-сбор каждые 20 минут
          </p>
        </div>
        {canManage && (
          <button className="btn btn-primary" onClick={collectNow} disabled={busy}>
            {busy ? "Собираю…" : "🔄 Обновить статистику"}
          </button>
        )}
      </div>
      {note && <p className="text-sm text-gray-500">{note}</p>}

      <div className="flex gap-1 border-b pl-0.5">
        <button
          className={`px-3.5 py-2 text-[15px] font-medium rounded-t-lg border border-b-0 ${view === "live" ? "bg-white border-gray-200" : "border-transparent text-gray-500 hover:text-gray-700"}`}
          onClick={() => setView("live")}>
          Аккаунты · {all.length}
        </button>
        <button
          className={`px-3.5 py-2 text-[15px] font-medium rounded-t-lg border border-b-0 ${view === "arch" ? "bg-white border-gray-200" : "border-transparent text-gray-500 hover:text-gray-700"}`}
          onClick={() => setView("arch")}>
          🗄 Архив аккаунтов · {archivedAccounts.length}
        </button>
      </div>

      {view === "arch" ? (
        <div className="space-y-4">
          <p className="card text-sm text-gray-500">
            Архивные не опрашиваются у площадки, не входят в суммы и не получают публикаций.
            Подписчики, история и все посты сохранены — «Вернуть аккаунт» поднимает его с того же места.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {archivedAccounts.map((a) => (
              <div key={a.id} className="card relative bg-gray-50">
                <span className="absolute top-3 right-3 w-8 h-8 rounded-full bg-gray-100 grayscale flex items-center justify-center">🗄</span>
                <div className="flex items-center gap-3 pr-9">
                  {a.avatar ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={a.avatar} alt="" className="w-10 h-10 rounded-full bg-gray-100 grayscale opacity-60" />
                  ) : (
                    <div className="w-10 h-10 rounded-full bg-gray-200 flex items-center justify-center">📸</div>
                  )}
                  <div className="min-w-0">
                    <div className="font-semibold text-gray-600 truncate">{a.title}</div>
                    <div className="text-sm text-gray-500 truncate">
                      {PLATFORM_NAMES[a.platform] || a.platform} · {fmt(a.followers)} подп. · {a.postsKept ?? 0} постов
                    </div>
                    <div className="text-xs text-gray-400">
                      цифры на {new Date(a.lastSeenAt || a.updatedAt).toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric" })}
                    </div>
                  </div>
                </div>
                <div className="flex items-center justify-between gap-2 mt-3 pt-2 border-t border-gray-100">
                  <span className="badge-red">{a.archiveNote || "убран вручную"}</span>
                  {canManage && (
                    <button className="btn btn-secondary" disabled={busy} onClick={() => archive(a.id, "restore")}>
                      ↩ Вернуть аккаунт
                    </button>
                  )}
                </div>
              </div>
            ))}
            {!archivedAccounts.length && (
              <div className="card text-sm text-gray-500">
                В архиве пусто. Аккаунты попадают сюда кнопкой «Архивировать» в карточке.
              </div>
            )}
          </div>
        </div>
      ) : (
      <>
      <div className="flex flex-wrap items-center gap-2">
        <PeriodPicker value={range} onChange={setRange} />
        <button className={chip(platform === "all")} onClick={() => setPlatform("all")}>Все платформы</button>
        {platforms.map((p) => (
          <button key={p} className={chip(platform === p)} onClick={() => setPlatform(p)}>{PLATFORM_NAMES[p] || p}</button>
        ))}
        <span className="w-px h-6 bg-gray-200 mx-1" />
        {!only && (
          <button className={chip(brand === "all")} onClick={() => setBrand("all")}>Все проекты</button>
        )}
        {!only && brands.map((b) => (
          <button key={b} className={chip(brand === b)} onClick={() => setBrand(b)}>{BRAND_NAMES[b] || b}</button>
        ))}
        <span className="w-px h-6 bg-gray-200 mx-1" />
        <select value={profile} onChange={(e) => setProfile(e.target.value)}
          className="border rounded-lg px-2 py-1.5 text-sm bg-white">
          <option value="all">Все профили</option>
          {profileOptions.map((a) => (
            <option key={a.id} value={a.id}>{a.title}</option>
          ))}
        </select>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
        {tiles.map((t) => (
          <div key={t.label} className="card">
            <div className="text-sm text-gray-500">{t.label}</div>
            <div className="text-2xl font-bold mt-1">{t.value}</div>
            {t.sub && <div className={`text-sm mt-1 ${t.subClass}`}>{t.sub}</div>}
            {t.delta && (
              <div className="text-sm mt-1">
                <Delta cur={t.delta.cur} prev={t.delta.prev} />{" "}
                <span className="text-gray-400 text-xs">к прошлым {period} дн</span>
              </div>
            )}
            {t.note && <div className="text-xs mt-0.5 text-gray-400">{t.note}</div>}
          </div>
        ))}
      </div>

      {daily.length > 1 && (
        <div className="card">
          <h2 className="font-semibold mb-1">Динамика по дням</h2>
          <p className="text-xs text-gray-400 mb-3">синее — просмотры, зелёное — охват</p>
          <div className="flex items-end gap-1 h-32">
            {daily.map(([date, d]) => {
              const max = Math.max(1, ...daily.map(([, x]) => x.views));
              return (
                <div key={date} className="flex-1 max-w-14 h-full flex flex-col justify-end items-center gap-0.5 group relative min-w-0">
                  <div className="hidden group-hover:block absolute -top-10 bg-gray-900 text-white text-xs rounded px-2 py-1 whitespace-nowrap z-10">
                    {new Date(date + "T00:00:00").toLocaleDateString("ru-RU", { day: "numeric", month: "short" })}:{" "}
                    {fmt(d.views)} просм{d.reach ? ` · ${fmt(d.reach)} охват` : ""}
                  </div>
                  <div className="w-full bg-brand-600 rounded-t" style={{ height: `${Math.max(2, (d.views / max) * 100)}%` }} />
                  {d.reach > 0 && <div className="w-full bg-green-500 rounded-t" style={{ height: `${Math.max(1, (d.reach / max) * 100 * 0.6)}%` }} />}
                </div>
              );
            })}
          </div>
          <div className="flex justify-between text-xs text-gray-400 mt-1">
            <span>{daily[0] && new Date(daily[0][0] + "T00:00:00").toLocaleDateString("ru-RU", { day: "numeric", month: "short" })}</span>
            <span>{daily.at(-1) && new Date(daily.at(-1)![0] + "T00:00:00").toLocaleDateString("ru-RU", { day: "numeric", month: "short" })}</span>
          </div>
        </div>
      )}

      <a href="/analytics" className="card flex items-center justify-between gap-3 hover:bg-gray-50">
        <div>
          <h2 className="font-semibold">🧠 Нейро-аналитика контента</h2>
          <p className="text-xs text-gray-400">
            переехала на отдельную страницу: выводы с достоверностью, срезы по паспорту, lead-gen и рекомендации
          </p>
        </div>
        <span className="text-brand-700 text-sm whitespace-nowrap">Открыть →</span>
      </a>

      {factoryStatus && (
        <div className={`card flex items-center gap-3 text-sm ${factoryStatus.ok ? "" : "border-yellow-400 bg-yellow-50"}`}>
          <span className="text-lg">🏭</span>
          <div>
            <span className="font-semibold">Контент-завод (Инстаграм): </span>
            {factoryStatus.text}
            {!factoryStatus.ok && " — похоже, завод молчит, стоит проверить"}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {accounts.map((a) => (
          <div key={a.id} className={`card relative ${profile === a.id ? "ring-2 ring-brand-500" : ""}`}>
            {/* Состояние публикации — в углу карточки: видно, не открывая
                маршруты. Заводской, на паузе или перестал читаться. */}
            <span
              className={`absolute top-3 right-3 w-8 h-8 rounded-full flex items-center justify-center ${
                a.publishes ? "bg-green-100" : a.suspicious ? "bg-yellow-100" : "bg-amber-50"
              }`}
              title={a.publishes ? "завод публикует сюда" : a.reason?.title || ""}>
              {a.publishes ? "🏭" : a.suspicious ? "❓" : "⏸"}
            </span>
            <div className="flex items-center gap-3 cursor-pointer pr-9"
              onClick={() => setProfile(profile === a.id ? "all" : a.id)}>
            {a.avatar ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={a.avatar} alt="" className="w-10 h-10 rounded-full bg-gray-100" />
            ) : (
              <div className="w-10 h-10 rounded-full bg-gray-100 flex items-center justify-center">
                {a.platform === "youtube" ? "📺" : a.platform === "tiktok" ? "🎵" : "📸"}
              </div>
            )}
            <div className="min-w-0 flex-1">
              <a href={a.url} target="_blank" className="font-semibold text-brand-700 block truncate" onClick={(e) => e.stopPropagation()}>
                {a.title}
              </a>
              <div className="text-sm text-gray-500 truncate">
                {PLATFORM_NAMES[a.platform] || a.platform}{a.lang && LANG_NAMES[a.lang] ? ` ${LANG_NAMES[a.lang]}` : ""} · {fmt(a.followers)} подп.
              </div>
              {(() => {
                const hist = (a.history || []).filter((h: any) => h.date >= edgeDate && h.date <= topDate && h.followers != null);
                if (hist.length < 2) return null;
                const first = hist[0].followers;
                const last = hist[hist.length - 1].followers;
                return (
                  <div className="text-sm mt-0.5">
                    <AbsDelta cur={last} prev={first} />
                    <span className="text-gray-400 text-xs"> подписчиков за {period} дн</span>
                  </div>
                );
              })()}
            </div>
            {(() => {
              const pts = (a.history || [])
                .filter((h: any) => h.date >= edgeDate && h.date <= topDate)
                .map((h: any) => h.views ?? h.followers ?? 0);
              const fh = (a.history || []).filter((h: any) => h.date >= edgeDate && h.date <= topDate && h.followers != null);
              const up = fh.length >= 2 ? fh[fh.length - 1].followers >= fh[0].followers : true;
              return <Spark points={pts} up={up} />;
            })()}
            </div>

            {a.note && (
              <div className="mt-2 text-xs text-gray-600 bg-yellow-50 border border-yellow-200 rounded-lg px-2 py-1">
                ✎ {a.note}
              </div>
            )}

            <div className="flex items-center justify-between gap-2 mt-3 pt-2 border-t border-gray-100">
              {a.publishes ? (
                <span className="text-xs text-gray-400">публикуется</span>
              ) : (
                <span className="relative group text-xs text-gray-400 border-b border-dotted border-gray-300 cursor-help whitespace-nowrap">
                  {a.suspicious ? "не читается" : "не публикуется"}
                  {a.reason && (
                    <span className="hidden group-hover:block absolute bottom-full left-0 mb-1.5 w-64 bg-gray-900 text-white text-xs leading-5 rounded-lg px-3 py-2 z-20 shadow-lg">
                      <b className="block mb-0.5">{a.reason.title}</b>
                      {a.reason.body}
                      <span className="block mt-1.5 text-gray-400">источник: {a.reason.source}</span>
                    </span>
                  )}
                </span>
              )}
              {canManage && (
                <span className="flex gap-1.5 shrink-0">
                  {!a.publishes && (
                    <button className="btn btn-secondary" disabled={busy}
                      onClick={() => {
                        setNoting(noting === a.id ? "" : a.id);
                        setNoteText(a.note || "");
                      }}>
                      ✎
                    </button>
                  )}
                  <button className="btn btn-secondary" disabled={busy}
                    onClick={() => setAsking(asking === a.id ? "" : a.id)}>
                    🗄 Архивировать
                  </button>
                </span>
              )}
            </div>

            {noting === a.id && (
              <div className="mt-2 flex gap-2">
                <input className="input" value={noteText} autoFocus
                  placeholder="Ждём документы от Меты"
                  onChange={(e) => setNoteText(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && saveNote(a.id)} />
                <button className="btn btn-primary shrink-0" disabled={busy} onClick={() => saveNote(a.id)}>
                  Сохранить
                </button>
              </div>
            )}

            {asking === a.id && (
              <div className="mt-2.5 p-2.5 rounded-lg bg-yellow-50 border border-yellow-200 text-[13px] text-yellow-900">
                <b>Архивировать {a.title}?</b>
                <ul className="list-disc pl-4 my-1.5 space-y-0.5">
                  <li>перестаём опрашивать площадку — ошибок сбора не будет</li>
                  <li>маршрут публикации гасим: завод сюда не постит</li>
                  <li>уходит из сумм и очереди зеркалирования</li>
                  <li>подписчики, история и {a.postsKept ?? 0} постов сохраняются</li>
                </ul>
                <div className="flex gap-2">
                  <button className="btn bg-red-100 text-red-800 hover:bg-red-200" disabled={busy}
                    onClick={() => archive(a.id, "archive")}>Архивировать</button>
                  <button className="btn btn-secondary" onClick={() => setAsking("")}>Отмена</button>
                </div>
              </div>
            )}
          </div>
        ))}
        {!accounts.length && (
          <div className="card text-sm text-gray-500">Пока пусто — сервер собирает данные каждые 20 минут, загляни чуть позже.</div>
        )}
      </div>

      {byDay.length > 0 && (
        <div className="card">
          <h2 className="font-semibold mb-3">Публикации</h2>
          <div className="space-y-4">
            {byDay.map(([day, list]) => (
              <div key={day}>
                <div className="text-xs uppercase text-gray-400 mb-2">
                  {new Date(day + "T00:00:00").toLocaleDateString("ru-RU", { day: "numeric", month: "long" })}
                </div>
                <div className="space-y-2">
                  {list.map((p: any) => (
                    <a key={p.id} href={p.permalink} target="_blank"
                      className="grid grid-cols-[56px_1fr] sm:grid-cols-[56px_1fr_auto] gap-3 items-start rounded-lg border border-transparent hover:border-gray-200 hover:bg-gray-50 p-2 -m-2 transition-colors">
                      {p.thumbnail ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={p.thumbnail} alt="" loading="lazy"
                          className="w-14 h-20 object-cover rounded-md bg-gray-100"
                          onError={(e) => ((e.target as HTMLImageElement).style.visibility = "hidden")} />
                      ) : (
                        <div className="w-14 h-20 rounded-md bg-gray-100 flex items-center justify-center text-gray-300 text-xl">▶</div>
                      )}
                      <div className="min-w-0">
                        <div className="text-xs text-gray-400 mb-0.5">
                          {String(p.username || "").startsWith("@") ? p.username : `@${p.username}`}
                          <span className="ml-2">{PLATFORM_NAMES[p.platform] || p.platform}</span>
                          <span className="ml-2">{p.source === "factory" ? "🏭 завод" : "✋ вручную"}</span>
                          {p.type && <span className="badge-green ml-2">{p.type}</span>}
                        </div>
                        <div className="text-sm line-clamp-2">{p.caption || "(без подписи)"}</div>
                        <div className="h-1.5 bg-gray-100 rounded mt-1.5 max-w-xl">
                          <div className="h-1.5 bg-brand-600 rounded"
                            style={{ width: `${Math.max(1, Math.round(((p.views || 0) / maxViews) * 100))}%` }} />
                        </div>
                      </div>
                      <div className="text-sm text-gray-500 sm:text-right whitespace-nowrap leading-6 col-start-2 sm:col-start-3">
                        <div><b className="text-gray-900">{fmt(p.views)}</b> просмотров{p.reach != null ? ` · охват ${fmt(p.reach)}` : ""}</div>
                        <div>♥ {fmt(p.likes)} · 💬 {fmt(p.comments)}{p.saved != null ? ` · 🔖 ${fmt(p.saved)}` : ""}{p.shares != null ? ` · ↗ ${fmt(p.shares)}` : ""}</div>
                      </div>
                    </a>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
      </>
      )}
    </div>
  );
}
