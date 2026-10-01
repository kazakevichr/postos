"use client";

import { useEffect, useMemo, useState } from "react";

// Аккаунты проекта — один блок, одна иерархия.
//
//   АККАУНТ (общий, мужской, под язык)
//     └ соцсети: TikTok, YouTube, Instagram, Telegram
//         └ по каждой: подключена ли, выпускаем ли сюда, кто выкладывает
//
// Раньше это было три разных вещи: «канал» пульта (куда завод выпускает и
// кто выкладывает), карточка статистики (подписчики, архив) и профиль
// upload-post (подключение соцсетей для автопубликации). Человек видел одну
// и ту же соцсеть по три раза. Теперь аккаунт — это профиль upload-post, его
// соцсети — строки внутри, а канал пульта и цифры статистики приклеены к
// своей строке.
//
// Порядок работы такой, как его описал Роман: завёл аккаунт → подключил
// соцсеть → решил, выкладывает завод сам или присылает ролик в бот.

type Channel = { key: string; title: string; net: string; account: string; profile: string; mode: string; paused: boolean; note: string; state: string; word: string };
type Stat = {
  id: string; platform: string; brand: string; username: string; title: string; avatar: string | null; url: string;
  followers: number | null; history: any[]; archived: boolean; archiveNote: string; note: string;
  publishes: boolean; suspicious: boolean; reason: { title: string; body: string; source: string } | null;
  postsKept: number; lastSeenAt: string; updatedAt: string;
};
type Conn = { platform: string; label: string; connected: boolean; handle: string };
type Prof = { username: string; title: string; main: boolean; platforms: Conn[] };
type Up = { brand: string; plan?: string; limit?: number | null; used?: number; profiles?: Prof[]; error?: string };

const NET: Record<string, string> = { IG: "instagram", YT: "youtube", TT: "tiktok", TG: "telegram" };
const NET_OF: Record<string, string> = { instagram: "IG", youtube: "YT", tiktok: "TT", telegram: "TG" };
const ICON: Record<string, string> = { instagram: "📸", youtube: "📺", tiktok: "🎵", telegram: "✈️" };
const NAME: Record<string, string> = { instagram: "Instagram", youtube: "YouTube", tiktok: "TikTok", telegram: "Telegram" };
const UP_PLATFORMS = ["tiktok", "youtube", "instagram"];

const norm = (s: string) => String(s || "").toLowerCase().replace(/^@/, "").replace(/\s+/g, "");
const fmt = (n: any) => (n == null ? "—" : Number(n).toLocaleString("ru-RU"));

type Row = {
  key: string; platform: string;
  ch: Channel | null; st: Stat | null; conn: Conn | null;
};
type Group = { prof: Prof | null; title: string; username: string; main: boolean; rows: Row[] };

export default function FactoryAccounts({
  brand, channels, archived, canManage, bot, busy, put, togglePause,
}: {
  brand: string;
  // СуперФит выкладывает своими ключами площадок, остальные — через
  // upload-post. Для вторых неподключённая в upload-post соцсеть значит, что
  // автопубликация не сработает, и строка обязана сказать это прямо.
  channels: Channel[];
  archived: Channel[];
  canManage: boolean;
  bot: string;
  busy: string;
  put: (body: any, tag: string) => Promise<boolean>;
  togglePause: (key: string, paused: boolean) => void;
}) {
  const [stats, setStats] = useState<Stat[]>([]);
  const [up, setUp] = useState<Up | null>(null);
  const [mine, setMine] = useState("");
  const [note, setNote] = useState("");
  const [menu, setMenu] = useState("");
  const [asking, setAsking] = useState("");
  const [noting, setNoting] = useState("");
  const [noteText, setNoteText] = useState("");
  const [editing, setEditing] = useState("");
  const [adding, setAdding] = useState("");
  const [showArch, setShowArch] = useState(false);
  const [newAcc, setNewAcc] = useState<string | null>(null);

  async function loadStats() {
    const d = await fetch("/api/social/stats").then((r) => r.json()).catch(() => null);
    setStats((d?.accounts || []).filter((a: Stat) => a.brand === brand));
  }
  async function loadUp() {
    const d = await fetch("/api/social/accounts").then((r) => r.json()).catch(() => null);
    setUp((d?.projects || []).find((p: Up) => p.brand === brand) || null);
  }
  useEffect(() => { loadStats(); loadUp(); }, [brand]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    // Вернулись со страницы подключения соцсетей — перечитываем.
    const again = () => document.visibilityState === "visible" && loadUp();
    document.addEventListener("visibilitychange", again);
    return () => document.removeEventListener("visibilitychange", again);
  }, [brand]); // eslint-disable-line react-hooks/exhaustive-deps

  const viaUpload = brand !== "superfit";
  const profiles = useMemo(() => (up && !up.error ? up.profiles || [] : []), [up]);
  const same = (a: string, b: string[]) => Boolean(a) && b.some((x) => x && norm(x) === norm(a));

  const groups: Group[] = useMemo(() => {
    const live = stats.filter((s) => !s.archived);
    const usedStat = new Set<string>();
    const main = profiles.find((p) => p.main) || profiles[0] || null;
    const base: Group[] = profiles.length
      ? profiles.map((p) => ({ prof: p, title: p.title, username: p.username, main: p.main, rows: [] as Row[] }))
      : [{ prof: null, title: "Аккаунт проекта", username: "", main: true, rows: [] as Row[] }];
    const groupOf = (profile: string) =>
      base.find((g) => g.username && g.username === profile) || base.find((g) => g.username === main?.username) || base[0];

    for (const ch of channels) {
      const platform = NET[ch.net] || ch.net;
      const g = groupOf(ch.profile);
      const st = live.find((s) => s.platform === platform && same(ch.account, [s.username, s.title])) || null;
      if (st) usedStat.add(st.id);
      const conn = g.prof?.platforms.find((c) => c.platform === platform && c.connected) || null;
      g.rows.push({ key: `ch:${ch.key}`, platform, ch, st, conn });
    }
    // Соцсети, которых у аккаунта ещё нет: пустая строка «подключить» — это и
    // есть следующий шаг, который человеку нужно увидеть.
    for (const g of base) {
      if (!g.prof) continue;
      for (const platform of UP_PLATFORMS) {
        if (g.rows.some((r) => r.platform === platform)) continue;
        const conn = g.prof.platforms.find((c) => c.platform === platform) || null;
        const st = conn?.connected ? live.find((s) => s.platform === platform && same(conn.handle, [s.username, s.title])) || null : null;
        if (st) usedStat.add(st.id);
        g.rows.push({ key: `up:${g.username}:${platform}`, platform, ch: null, st, conn });
      }
    }
    // Аккаунты, которые есть только в статистике, — в основной аккаунт.
    for (const st of live) {
      if (usedStat.has(st.id)) continue;
      groupOf("").rows.push({ key: `st:${st.id}`, platform: st.platform, ch: null, st, conn: null });
    }
    const order = ["tiktok", "youtube", "instagram", "telegram"];
    for (const g of base) g.rows.sort((a, b) => order.indexOf(a.platform) - order.indexOf(b.platform));
    return base;
  }, [channels, stats, profiles]); // eslint-disable-line react-hooks/exhaustive-deps

  const archStats = stats.filter((s) => s.archived);

  async function archiveStat(id: string, action: "archive" | "restore" | "note", text = "") {
    const r = await fetch("/api/social/archive", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, action, note: text }),
    }).then((x) => x.json()).catch(() => ({ error: "сеть" }));
    if (r.error) setNote(`Не вышло: ${r.error}`);
    return !r.error;
  }

  async function upPost(body: any) {
    const r = await fetch("/api/social/accounts", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ brand, ...body }),
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok || d.error) throw new Error(d.error || `ошибка ${r.status}`);
    return d;
  }

  async function connect(username: string) {
    setMine(`link-${username}`); setNote("");
    // Окно открываем сразу по клику: после ожидания браузер его заблокирует.
    const win = window.open("about:blank", "_blank");
    try {
      const d = await upPost({ action: "link", username });
      if (win) win.location.href = d.url; else window.location.href = d.url;
    } catch (e: any) {
      win?.close();
      setNote(`Не вышло получить ссылку: ${e.message}`);
    } finally { setMine(""); }
  }

  async function addAccount() {
    if (newAcc === null) return;
    setMine("addacc"); setNote("");
    try { await upPost({ action: "add", title: newAcc }); setNewAcc(null); await loadUp(); }
    catch (e: any) { setNote(`Аккаунт не заведён: ${e.message}`); }
    finally { setMine(""); }
  }

  async function removeAccount(g: Group) {
    if (!confirm(`Удалить пустой аккаунт «${g.title}»? Он освободит место в тарифе upload-post.`)) return;
    setMine(`rm-${g.username}`); setNote("");
    try { await upPost({ action: "remove", username: g.username }); await loadUp(); }
    catch (e: any) { setNote(`Не удалён: ${e.message}`); }
    finally { setMine(""); }
  }

  // Соцсеть подключена в upload-post, а завод про неё не знает: заводим канал
  // сразу с автопубликацией — человек для того и подключал.
  async function startChannel(g: Group, r: Row) {
    await put({
      newChannel: {
        title: `${NAME[r.platform]} · ${r.conn?.handle || g.title}`, net: NET_OF[r.platform],
        account: r.conn?.handle || "", profile: g.username, connected: true,
      },
    }, `new-${r.key}`);
  }

  async function archive(r: Row) {
    setMine(`arch-${r.key}`);
    if (r.ch) await put({ channel: r.ch.key, archived: true }, `arch-${r.ch.key}`);
    if (r.st) await archiveStat(r.st.id, "archive");
    setAsking(""); setMenu(""); setMine("");
    setNote(`${label(r)} в архиве: сюда не выкладываем, сбор остановлен. Цифры и история сохранены.`);
    await loadStats();
  }

  async function saveNote(r: Row) {
    if (!r.st) return;
    await archiveStat(r.st.id, "note", noteText);
    setNoting(""); setNoteText("");
    await loadStats();
  }

  const handle = (r: Row) => r.ch?.account || (r.conn?.connected ? r.conn.handle : "") || r.st?.title || "";
  const label = (r: Row) => `${NAME[r.platform] || r.platform}${handle(r) ? ` ${handle(r)}` : ""}`;
  const weekDelta = (st: Stat) => {
    const h = (st.history || []).filter((x: any) => x.followers != null).slice(-8);
    return h.length >= 2 ? h[h.length - 1].followers - h[0].followers : null;
  };

  const Toggle = ({ on, onClick, tag, name }: { on: boolean; onClick: () => void; tag: string; name: string }) => (
    <button role="switch" aria-checked={on} aria-label={name} disabled={!canManage || busy === tag}
      onClick={onClick}
      className={`relative w-9 h-5 rounded-full transition-colors shrink-0 ${on ? "bg-green-500" : "bg-gray-300"} ${canManage ? "" : "opacity-50 cursor-default"}`}>
      <span className={`absolute top-0.5 w-4 h-4 bg-white rounded-full transition-all ${on ? "left-4" : "left-0.5"}`} />
    </button>
  );

  const row = (g: Group, r: Row) => {
    const d = r.st ? weekDelta(r.st) : null;
    const h = handle(r);
    return (
      <div key={r.key} className="px-3 py-2.5">
        <div className="grid grid-cols-[minmax(0,1fr)_auto] md:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,1fr)_auto] gap-x-4 gap-y-2 items-center">
          {/* Соцсеть и аккаунт в ней */}
          <div className="flex items-center gap-2.5 min-w-0">
            {r.st?.avatar ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={r.st.avatar} alt="" className="w-8 h-8 rounded-full bg-gray-100 shrink-0" />
            ) : (
              <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${r.ch || r.conn?.connected ? "bg-white border" : "bg-gray-100 grayscale opacity-60"}`}>{ICON[r.platform] || "•"}</div>
            )}
            <div className="min-w-0">
              <div className="text-sm truncate">
                <span className="text-gray-500">{NAME[r.platform] || r.platform}</span>
                {h && (r.st?.url
                  ? <a href={r.st.url} target="_blank" className="font-semibold text-brand-700 hover:underline ml-1.5">{h}</a>
                  : <span className="font-semibold ml-1.5">{h}</span>)}
              </div>
              <div className="text-xs text-gray-500 truncate">
                {r.st ? <>{fmt(r.st.followers)} подп.{d != null && d !== 0 && <span className={d > 0 ? "text-green-600" : "text-red-600"}> {d > 0 ? "▲ +" : "▼ "}{fmt(d)} за неделю</span>}</>
                  : r.ch ? "цифры не собираются" : r.conn?.connected ? "подключено" : "не подключено"}
                {r.conn?.connected && r.ch && <span className="text-brand-700"> · ⚡ подключено</span>}
              </div>
              {r.ch && viaUpload && g.prof && !r.conn?.connected && (
                <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px]">
                  <span className="px-2 py-0.5 rounded-full bg-red-50 text-red-700">
                    ⚠ не подключено — {r.ch.mode !== "manual" ? "автопубликация не сработает" : "выложить некуда"}
                  </span>
                  {canManage && (
                    <button className="text-brand-700 hover:underline" disabled={mine === `link-${g.username}`} onClick={() => connect(g.username)}>
                      Подключить {NAME[r.platform]}
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>

          {r.ch ? (
            <>
              <div className="flex items-center gap-2 col-span-2 md:col-span-1 order-3 md:order-none">
                <Toggle on={!r.ch.paused} tag={`ch-${r.ch.key}`} name={`Выход в ${label(r)}`} onClick={() => togglePause(r.ch!.key, r.ch!.paused)} />
                <div className="text-xs leading-tight">
                  <div className="text-gray-800">{r.ch.paused ? "Выход закрыт" : "Выпускаем сюда"}</div>
                  <div className="text-gray-500">{r.ch.paused ? "ролики сюда не идут" : "ролики для этой соцсети"}</div>
                </div>
              </div>
              <div className={`flex items-center gap-2 col-span-2 md:col-span-1 order-4 md:order-none ${r.ch.paused ? "opacity-40" : ""}`}>
                <Toggle on={r.ch.mode !== "manual"} tag={`conn-${r.ch.key}`} name={`Автопубликация ${label(r)}`}
                  onClick={() => put({ channel: r.ch!.key, connected: r.ch!.mode === "manual" }, `conn-${r.ch!.key}`)} />
                <div className="text-xs leading-tight">
                  <div className="text-gray-800">{r.ch.mode === "manual" ? "В бот автопостинга" : "Автопубликация"}</div>
                  <div className="text-gray-500">{r.ch.mode === "manual" ? `ролик приходит в ${bot}, выкладываете вы` : "завод выкладывает сам"}</div>
                </div>
              </div>
            </>
          ) : (
            <div className="col-span-2 order-3 md:order-none text-xs">
              {r.conn?.connected ? (
                canManage ? (
                  <button className="btn btn-primary text-xs" disabled={busy === `new-${r.key}`} onClick={() => startChannel(g, r)}>
                    Выпускать сюда ролики
                  </button>
                ) : <span className="text-gray-500">подключено, завод сюда пока не выпускает</span>
              ) : r.st ? (
                <span className="text-gray-500">завод сюда не выпускает — аккаунт только в статистике</span>
              ) : g.prof && canManage ? (
                <button className="btn btn-secondary text-xs" disabled={mine === `link-${g.username}`} onClick={() => connect(g.username)}>
                  Подключить {NAME[r.platform]}
                </button>
              ) : <span className="text-gray-400">не подключено</span>}
            </div>
          )}

          {/* Редкие действия — в меню, чтобы строка не рябила кнопками */}
          <div className="relative justify-self-end order-2 md:order-none">
            {canManage && (r.ch || r.st) && (
              <button className="w-8 h-8 rounded-lg text-gray-400 hover:bg-gray-100 hover:text-gray-800" aria-label="Ещё"
                onClick={() => setMenu(menu === r.key ? "" : r.key)}>⋯</button>
            )}
            {menu === r.key && (
              <div className="absolute right-0 top-9 z-20 w-52 bg-white border rounded-xl shadow-lg py-1 text-sm">
                {r.ch && <button className="block w-full text-left px-3 py-1.5 hover:bg-gray-50" onClick={() => { setEditing(r.key); setMenu(""); }}>Заменить аккаунт</button>}
                {r.ch && profiles.length > 1 && profiles.filter((p) => p.username !== g.username).map((p) => (
                  <button key={p.username} className="block w-full text-left px-3 py-1.5 hover:bg-gray-50"
                    onClick={() => { put({ channel: r.ch!.key, profile: p.username }, `mv-${r.ch!.key}`); setMenu(""); }}>
                    Перенести в «{p.title}»
                  </button>
                ))}
                {r.st && <button className="block w-full text-left px-3 py-1.5 hover:bg-gray-50" onClick={() => { setNoting(r.key); setNoteText(r.st!.note || ""); setMenu(""); }}>Заметка</button>}
                <button className="block w-full text-left px-3 py-1.5 hover:bg-gray-50 text-red-700" onClick={() => { setAsking(r.key); setMenu(""); }}>В архив</button>
              </div>
            )}
          </div>
        </div>

        {(r.ch?.note || r.st?.note || (r.st && !r.st.publishes && r.st.reason)) && (
          <div className="mt-1.5 md:pl-[42px] flex flex-wrap gap-1.5 text-[11px]">
            {r.ch?.note && <span className="text-gray-500">{r.ch.note}</span>}
            {r.st?.note && <span className="px-2 py-0.5 rounded-full bg-yellow-50 border border-yellow-200 text-gray-700">✎ {r.st.note}</span>}
            {r.st && !r.st.publishes && r.st.reason && (
              <span className="relative group px-2 py-0.5 rounded-full bg-amber-50 text-amber-800 cursor-help">
                {r.st.suspicious ? "❓ не читается" : "⏸ не публикуется"}
                <span className="hidden group-hover:block absolute bottom-full left-0 mb-1.5 w-64 bg-gray-900 text-white text-xs leading-5 rounded-lg px-3 py-2 z-20 shadow-lg">
                  <b className="block mb-0.5">{r.st.reason.title}</b>{r.st.reason.body}
                </span>
              </span>
            )}
          </div>
        )}

        {editing === r.key && r.ch && (
          <form className="mt-2 md:pl-[42px] flex flex-wrap gap-2" onSubmit={async (e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget as HTMLFormElement);
            if (await put({ channel: r.ch!.key, account: f.get("account") }, `c-${r.ch!.key}`)) setEditing("");
          }}>
            <input name="account" defaultValue={r.ch.account} className="input text-sm max-w-xs" placeholder="имя нового аккаунта" />
            <button className="btn btn-primary text-xs" type="submit">Заменить</button>
            <button className="btn btn-secondary text-xs" type="button" onClick={() => setEditing("")}>Отмена</button>
            <p className="text-[11px] text-gray-500 basis-full">Новый аккаунт начинает с выкладки через бот: автопубликацию включите, когда он подключён.</p>
          </form>
        )}

        {noting === r.key && (
          <div className="mt-2 md:pl-[42px] flex gap-2 max-w-lg">
            <input className="input text-sm" value={noteText} autoFocus placeholder="Ждём документы от Меты"
              onChange={(e) => setNoteText(e.target.value)} onKeyDown={(e) => e.key === "Enter" && saveNote(r)} />
            <button className="btn btn-primary shrink-0 text-xs" onClick={() => saveNote(r)}>Сохранить</button>
          </div>
        )}

        {asking === r.key && (
          <div className="mt-2 md:ml-[42px] p-2.5 rounded-lg bg-yellow-50 border border-yellow-200 text-[13px] text-yellow-900 max-w-lg">
            <b>Убрать {label(r)} в архив?</b>
            <ul className="list-disc pl-4 my-1.5 space-y-0.5">
              {r.ch && <li>завод сюда больше не выкладывает</li>}
              {r.st && <li>сбор цифр останавливаем, из сумм аккаунт уходит</li>}
              <li>подписчики, история{r.st ? ` и ${r.st.postsKept} постов` : ""} сохраняются — вернуть можно одной кнопкой</li>
            </ul>
            <div className="flex gap-2">
              <button className="btn bg-red-100 text-red-800 hover:bg-red-200" disabled={mine === `arch-${r.key}`} onClick={() => archive(r)}>В архив</button>
              <button className="btn btn-secondary" onClick={() => setAsking("")}>Отмена</button>
            </div>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="card">
      <div className="mb-3">
        <h2 className="font-semibold">Аккаунты</h2>
        <p className="text-xs text-gray-500 max-w-3xl">
          Аккаунт — соцсети одной аудитории: общий, мужской, под язык. Заведите аккаунт, подключите соцсети
          и решите для каждой: завод выкладывает сам или присылает ролик в бот. Цифры подробно — в «Статистике Соц.сети».
        </p>
      </div>

      {note && <p className="text-sm text-gray-600 bg-gray-50 rounded-lg px-3 py-2 mb-3">{note}</p>}
      {up?.error && <p className="text-xs text-red-700 mb-3">upload-post не ответил: {up.error}. Подключение соцсетей временно недоступно, остальное работает.</p>}

      <div className="space-y-3">
        {groups.map((g) => {
          const empty = !g.rows.some((r) => r.ch || r.conn?.connected || r.st);
          const key = g.username || "one";
          return (
            <div key={key} className="rounded-xl border">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-3 py-2 bg-gray-50 border-b rounded-t-xl">
                <div className="font-semibold text-sm">{g.title}</div>
                {g.main && profiles.length > 1 && <span className="text-[11px] text-gray-400">основной — сюда завод выкладывает по умолчанию</span>}
                <div className="ml-auto flex items-center gap-3 text-xs">
                  {canManage && (
                    <button className="text-brand-700 hover:underline" onClick={() => setAdding(adding === key ? "" : key)}>
                      + соцсеть вручную
                    </button>
                  )}
                  {canManage && g.prof && empty && !g.main && (
                    <button className="text-gray-400 hover:text-red-700" disabled={mine === `rm-${g.username}`} onClick={() => removeAccount(g)}>удалить аккаунт</button>
                  )}
                </div>
              </div>
              <div className="divide-y">{g.rows.map((r) => row(g, r))}</div>
              {!g.rows.length && <p className="px-3 py-3 text-sm text-gray-500">Соцсетей нет: готовые ролики уходят в бот {bot}, выкладываете вы.</p>}

              {adding === key && canManage && (
                <form className="border-t px-3 py-2.5 flex flex-wrap gap-2 items-start bg-white rounded-b-xl" onSubmit={async (e) => {
                  e.preventDefault();
                  const f = new FormData(e.currentTarget as HTMLFormElement);
                  const net = String(f.get("net"));
                  const account = String(f.get("account") || "");
                  const ok = await put({ newChannel: { title: `${NAME[NET[net]] || net}${account ? ` · ${account}` : ""}`, net, account, profile: g.username } }, "newCh");
                  if (ok) setAdding("");
                }}>
                  <select name="net" className="input text-sm max-w-[150px]" defaultValue="TG">
                    <option value="TT">TikTok</option>
                    <option value="YT">YouTube</option>
                    <option value="IG">Instagram</option>
                    <option value="TG">Telegram</option>
                  </select>
                  <input name="account" className="input text-sm max-w-[220px]" placeholder="имя аккаунта в соцсети" />
                  <button className="btn btn-primary text-sm" type="submit">Добавить</button>
                  <p className="text-xs text-gray-500 basis-full">
                    Для соцсети, которую завод ведёт без upload-post (например, Telegram). Начинает с выкладки через бот.
                  </p>
                </form>
              )}
            </div>
          );
        })}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-3 text-sm">
        {canManage && up && !up.error && (
          newAcc === null ? (
            <button className="btn btn-secondary" onClick={() => setNewAcc("")}>＋ Аккаунт</button>
          ) : (
            <span className="flex flex-wrap gap-2">
              <input className="input text-sm max-w-xs" autoFocus value={newAcc} onChange={(e) => setNewAcc(e.target.value)}
                placeholder={profiles.length ? "Название: Мужской, Футбол, English" : "Основной"}
                onKeyDown={(e) => { if (e.key === "Enter" && newAcc.trim()) addAccount(); if (e.key === "Escape") setNewAcc(null); }} />
              <button className="btn btn-primary text-sm" disabled={!newAcc.trim() || mine === "addacc"} onClick={addAccount}>
                {mine === "addacc" ? "Завожу…" : "Завести"}
              </button>
              <button className="btn btn-secondary text-sm" onClick={() => setNewAcc(null)}>Отмена</button>
            </span>
          )
        )}
        {up?.limit != null && <span className="text-xs text-gray-400">тариф upload-post {up.plan}: занято {up.used} из {up.limit} аккаунтов на все проекты</span>}
        {(archived.length + archStats.length) > 0 && (
          <button className="text-gray-500 hover:text-gray-900 ml-auto" onClick={() => setShowArch(!showArch)}>
            🗄 Архив · {archived.length + archStats.length}
          </button>
        )}
      </div>

      {showArch && (
        <div className="mt-3 border-t pt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {archived.map((ch) => (
            <div key={ch.key} className="border rounded-lg p-3 bg-white text-sm">
              <div className="flex items-center justify-between gap-2">
                <b className="truncate">{ICON[NET[ch.net]]} {ch.account || ch.title}</b>
                <span className="text-[11px] px-2 py-px rounded-full border bg-gray-50 text-gray-500 shrink-0">в архиве</span>
              </div>
              <div className="text-xs text-gray-500">{ch.title} · завод не выкладывает</div>
              {canManage && (
                <button className="text-xs text-brand-700 mt-1" onClick={() => put({ channel: ch.key, archived: false }, `un-${ch.key}`)}>вернуть</button>
              )}
            </div>
          ))}
          {archStats.map((st) => (
            <div key={st.id} className="border rounded-lg p-3 bg-gray-50 text-sm">
              <div className="flex items-center justify-between gap-2">
                <b className="text-gray-600 truncate">{ICON[st.platform]} {st.title}</b>
                <span className="text-[11px] px-2 py-px rounded-full border bg-white text-gray-500 shrink-0">в архиве</span>
              </div>
              <div className="text-xs text-gray-500">
                {fmt(st.followers)} подп. · {st.postsKept} постов · цифры на {new Date(st.lastSeenAt || st.updatedAt).toLocaleDateString("ru-RU")}
              </div>
              {st.archiveNote && <div className="text-[11px] text-red-700 mt-0.5">{st.archiveNote}</div>}
              {canManage && (
                <button className="text-xs text-brand-700 mt-1"
                  onClick={async () => { if (await archiveStat(st.id, "restore")) { setNote(`${st.title} возвращён. Выход в него включите сами, когда будете готовы.`); loadStats(); } }}>
                  вернуть
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
