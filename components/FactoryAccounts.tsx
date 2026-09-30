"use client";

import { useEffect, useMemo, useState } from "react";

// Аккаунты проекта — один блок вместо трёх.
//
// Раньше одно и то же жило в трёх местах: «Каналы» пульта (выпускаем ли сюда
// и кто выкладывает), карточки «Соц.Сетей» (подписчики, архив, заметка) и
// «Аккаунты публикации» upload-post (подключение для автопостинга). Человек
// видел TikTok @superfit05 трижды и не понимал, где главный. Теперь аккаунт —
// одна карточка, и на ней всё: цифры, выход, кто выкладывает, автопостинг,
// архив.
//
// Карточки собираются из двух источников: канал пульта (куда завод выпускает)
// и аккаунт статистики (что собирает сбор). Совпадают по площадке и имени.
// Аккаунт, который есть только в статистике, тоже показываем — с пометкой,
// что завод туда не выкладывает.

type Channel = { key: string; title: string; net: string; account: string; mode: string; paused: boolean; note: string; state: string; word: string };
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
const ICON: Record<string, string> = { instagram: "📸", youtube: "📺", tiktok: "🎵", telegram: "✈️" };
const NAME: Record<string, string> = { instagram: "Instagram", youtube: "YouTube", tiktok: "TikTok", telegram: "Telegram" };
const CHIP: Record<string, string> = {
  auto: "bg-green-100 text-green-800 border-green-200",
  manual: "bg-yellow-50 text-yellow-800 border-yellow-200",
  pause: "bg-white text-gray-500 border-gray-300 border-dashed",
  stats: "bg-gray-50 text-gray-500 border-gray-200",
};

const norm = (s: string) => String(s || "").toLowerCase().replace(/^@/, "").replace(/\s+/g, "");
const fmt = (n: any) => (n == null ? "—" : Number(n).toLocaleString("ru-RU"));

type Card = { key: string; platform: string; ch: Channel | null; st: Stat | null; up: { profile: Prof; conn: Conn } | null };

export default function FactoryAccounts({
  brand, channels, archived, canManage, publisher, bot, busy, put, togglePause,
}: {
  brand: string;
  channels: Channel[];
  archived: Channel[];
  canManage: boolean;
  publisher: string;
  bot: string;
  busy: string;
  put: (body: any, tag: string) => Promise<boolean>;
  togglePause: (key: string, paused: boolean) => void;
}) {
  const [stats, setStats] = useState<Stat[]>([]);
  const [up, setUp] = useState<Up | null>(null);
  const [mine, setMine] = useState("");
  const [note, setNote] = useState("");
  const [asking, setAsking] = useState("");
  const [noting, setNoting] = useState("");
  const [noteText, setNoteText] = useState("");
  const [editing, setEditing] = useState("");
  const [adding, setAdding] = useState(false);
  const [showArch, setShowArch] = useState(false);
  const [showUp, setShowUp] = useState(false);
  const [profTitle, setProfTitle] = useState("");

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
    // Вернулись со страницы подключения upload-post — перечитываем.
    const again = () => document.visibilityState === "visible" && loadUp();
    document.addEventListener("visibilitychange", again);
    return () => document.removeEventListener("visibilitychange", again);
  }, [brand]); // eslint-disable-line react-hooks/exhaustive-deps

  const conns = useMemo(
    () => (up?.profiles || []).flatMap((p) => p.platforms.filter((c) => c.connected).map((c) => ({ profile: p, conn: c }))),
    [up],
  );

  const same = (platform: string, a: string, b: string[]) => b.some((x) => x && norm(x) === norm(a));

  const cards: Card[] = useMemo(() => {
    const live = stats.filter((s) => !s.archived);
    const used = new Set<string>();
    const out: Card[] = channels.map((ch) => {
      const platform = NET[ch.net] || ch.net;
      const st = live.find((s) => s.platform === platform && same(platform, ch.account, [s.username, s.title])) || null;
      if (st) used.add(st.id);
      const upc = conns.find((x) => x.conn.platform === platform && ch.account && same(platform, ch.account, [x.conn.handle])) || null;
      return { key: `ch:${ch.key}`, platform, ch, st, up: upc };
    });
    for (const st of live) {
      if (used.has(st.id)) continue;
      const upc = conns.find((x) => x.conn.platform === st.platform && same(st.platform, x.conn.handle, [st.username, st.title])) || null;
      out.push({ key: `st:${st.id}`, platform: st.platform, ch: null, st, up: upc });
    }
    return out;
  }, [channels, stats, conns]);

  const archStats = stats.filter((s) => s.archived);

  async function archiveStat(id: string, action: "archive" | "restore" | "note", text = "") {
    const r = await fetch("/api/social/archive", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, action, note: text }),
    }).then((x) => x.json()).catch(() => ({ error: "сеть" }));
    if (r.error) setNote(`Не вышло: ${r.error}`);
    return !r.error;
  }

  async function archive(c: Card) {
    setMine(`arch-${c.key}`);
    if (c.ch) await put({ channel: c.ch.key, archived: true }, `arch-${c.ch.key}`);
    if (c.st) await archiveStat(c.st.id, "archive");
    setAsking(""); setMine("");
    setNote(`${label(c)} в архиве: сюда не выкладываем, сбор остановлен. Цифры и история сохранены.`);
    await loadStats();
  }

  async function saveNote(c: Card) {
    if (!c.st) return;
    setMine(`note-${c.key}`);
    await archiveStat(c.st.id, "note", noteText);
    setNoting(""); setNoteText(""); setMine("");
    await loadStats();
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

  async function addProfile() {
    setMine("addprof"); setNote("");
    try { await upPost({ action: "add", title: profTitle }); setProfTitle(""); await loadUp(); }
    catch (e: any) { setNote(`Профиль не заведён: ${e.message}`); }
    finally { setMine(""); }
  }

  async function removeProfile(p: Prof) {
    if (!confirm(`Удалить пустой профиль «${p.title}» (${p.username}) в upload-post? Он освободит место в тарифе.`)) return;
    setMine(`rm-${p.username}`); setNote("");
    try { await upPost({ action: "remove", username: p.username }); await loadUp(); }
    catch (e: any) { setNote(`Не удалён: ${e.message}`); }
    finally { setMine(""); }
  }

  const label = (c: Card) => c.ch?.account ? `${NAME[c.platform] || c.platform} ${c.ch.account}` : c.st?.title || c.ch?.title || "";

  const period = (st: Stat) => {
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

  return (
    <div className="card">
      <div className="flex flex-wrap items-baseline justify-between gap-2 mb-3">
        <div>
          <h2 className="font-semibold">Аккаунты</h2>
          <p className="text-xs text-gray-500">Куда выходят ролики: цифры, выход, кто выкладывает. Статистика — в разделе «Статистика Соц.сети».</p>
        </div>
      </div>

      {note && <p className="text-sm text-gray-600 bg-gray-50 rounded-lg px-3 py-2 mb-3">{note}</p>}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {cards.map((c) => {
          const state = c.ch ? c.ch.state : "stats";
          const word = c.ch ? c.ch.word : "только статистика";
          const d = c.st ? period(c.st) : null;
          return (
            <div key={c.key} className={`rounded-xl border p-3 flex flex-col ${c.ch?.paused ? "border-dashed bg-white" : "bg-gray-50/60"}`}>
              <div className="flex items-start gap-3">
                {c.st?.avatar ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={c.st.avatar} alt="" className="w-10 h-10 rounded-full bg-gray-100 shrink-0" />
                ) : (
                  <div className="w-10 h-10 rounded-full bg-white border flex items-center justify-center shrink-0">{ICON[c.platform] || "•"}</div>
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs text-gray-500 whitespace-nowrap">{NAME[c.platform] || c.platform}</span>
                    <span className={`text-[11px] px-2 py-px rounded-full border shrink-0 ${CHIP[state] || CHIP.stats}`}>{word}</span>
                  </div>
                  {c.st?.url ? (
                    <a href={c.st.url} target="_blank" className="font-semibold text-sm text-brand-700 hover:underline block truncate" title={c.ch?.account || c.st.title}>
                      {c.ch?.account || c.st.title}
                    </a>
                  ) : (
                    <div className="font-semibold text-sm truncate" title={c.ch?.account || c.st?.title}>{c.ch?.account || c.st?.title || "аккаунт не указан"}</div>
                  )}
                  <div className="text-xs text-gray-500">
                    {c.st ? <>{fmt(c.st.followers)} подп.{d != null && d !== 0 && <span className={d > 0 ? "text-green-600" : "text-red-600"}> {d > 0 ? "▲ +" : "▼ "}{fmt(d)} за неделю</span>}</> : "цифры не собираются"}
                  </div>
                </div>
              </div>

              {c.ch && (
                <div className="mt-3 divide-y border-y text-xs">
                  <div className="flex items-center justify-between gap-2 py-1.5">
                    <div>
                      <div className="text-gray-800">{c.ch.paused ? "Выход закрыт" : "Выход открыт"}</div>
                      <div className="text-gray-500">{c.ch.paused ? "сюда ничего не уходит" : "ролики для этого аккаунта выпускаем"}</div>
                    </div>
                    <Toggle on={!c.ch.paused} tag={`ch-${c.ch.key}`} name={`Выход в ${label(c)}`} onClick={() => togglePause(c.ch!.key, c.ch!.paused)} />
                  </div>
                  <div className="flex items-center justify-between gap-2 py-1.5">
                    <div>
                      <div className="text-gray-800">{c.ch.mode === "manual" ? "Выкладываете вы" : `Выкладывает ${publisher}`}</div>
                      <div className="text-gray-500">{c.ch.mode === "manual" ? `ролик приходит в бот ${bot}` : "без ручной работы"}</div>
                    </div>
                    <Toggle on={c.ch.mode !== "manual"} tag={`conn-${c.ch.key}`} name={`Автопубликация ${label(c)}`}
                      onClick={() => put({ channel: c.ch!.key, connected: c.ch!.mode === "manual" }, `conn-${c.ch!.key}`)} />
                  </div>
                </div>
              )}
              {!c.ch && (
                <p className="mt-2 text-xs text-gray-500">Завод сюда не выкладывает — аккаунт только в статистике.</p>
              )}

              <div className="mt-2 flex flex-wrap gap-1.5 text-[11px]">
                {c.up && <span className="px-2 py-0.5 rounded-full bg-brand-50 text-brand-700">upload-post · {c.up.profile.title}</span>}
                {c.st && !c.st.publishes && c.st.reason && (
                  <span className="relative group px-2 py-0.5 rounded-full bg-amber-50 text-amber-800 cursor-help">
                    {c.st.suspicious ? "❓ не читается" : "⏸ не публикуется"}
                    <span className="hidden group-hover:block absolute bottom-full left-0 mb-1.5 w-64 bg-gray-900 text-white text-xs leading-5 rounded-lg px-3 py-2 z-20 shadow-lg">
                      <b className="block mb-0.5">{c.st.reason.title}</b>{c.st.reason.body}
                    </span>
                  </span>
                )}
              </div>
              {c.ch?.note && <div className="text-xs text-gray-500 mt-1.5">{c.ch.note}</div>}
              {c.st?.note && <div className="mt-1.5 text-xs text-gray-700 bg-yellow-50 border border-yellow-200 rounded-lg px-2 py-1">✎ {c.st.note}</div>}

              {canManage && (
                <div className="flex flex-wrap items-center gap-3 mt-auto pt-2.5 text-xs">
                  {c.ch && (
                    <button className="text-brand-700 hover:underline" onClick={() => setEditing(editing === c.key ? "" : c.key)}>
                      {editing === c.key ? "свернуть" : "заменить аккаунт"}
                    </button>
                  )}
                  {c.st && (
                    <button className="text-gray-500 hover:text-gray-900" onClick={() => { setNoting(noting === c.key ? "" : c.key); setNoteText(c.st!.note || ""); }}>
                      ✎ заметка
                    </button>
                  )}
                  <button className="text-gray-500 hover:text-red-700 ml-auto" onClick={() => setAsking(asking === c.key ? "" : c.key)}>
                    🗄 в архив
                  </button>
                </div>
              )}

              {editing === c.key && c.ch && (
                <form className="mt-2 flex flex-wrap gap-2" onSubmit={async (e) => {
                  e.preventDefault();
                  const f = new FormData(e.currentTarget as HTMLFormElement);
                  if (await put({ channel: c.ch!.key, account: f.get("account") }, `c-${c.ch!.key}`)) setEditing("");
                }}>
                  <input name="account" defaultValue={c.ch.account} className="input text-sm flex-1 min-w-0" placeholder="имя нового аккаунта" />
                  <button className="btn btn-primary text-xs" type="submit">Заменить</button>
                  <p className="text-[11px] text-gray-500 basis-full">Новый аккаунт считается неподключённым: ролики идут в бот, пока не включите «Выкладывает завод».</p>
                </form>
              )}

              {noting === c.key && (
                <div className="mt-2 flex gap-2">
                  <input className="input text-sm" value={noteText} autoFocus placeholder="Ждём документы от Меты"
                    onChange={(e) => setNoteText(e.target.value)} onKeyDown={(e) => e.key === "Enter" && saveNote(c)} />
                  <button className="btn btn-primary shrink-0 text-xs" disabled={mine === `note-${c.key}`} onClick={() => saveNote(c)}>Сохранить</button>
                </div>
              )}

              {asking === c.key && (
                <div className="mt-2 p-2.5 rounded-lg bg-yellow-50 border border-yellow-200 text-[13px] text-yellow-900">
                  <b>Убрать {label(c)} в архив?</b>
                  <ul className="list-disc pl-4 my-1.5 space-y-0.5">
                    {c.ch && <li>завод сюда больше не выкладывает</li>}
                    {c.st && <li>сбор цифр останавливаем, из сумм аккаунт уходит</li>}
                    <li>подписчики, история{c.st ? ` и ${c.st.postsKept} постов` : ""} сохраняются — вернуть можно одной кнопкой</li>
                  </ul>
                  <div className="flex gap-2">
                    <button className="btn bg-red-100 text-red-800 hover:bg-red-200" disabled={mine === `arch-${c.key}`} onClick={() => archive(c)}>В архив</button>
                    <button className="btn btn-secondary" onClick={() => setAsking("")}>Отмена</button>
                  </div>
                </div>
              )}
            </div>
          );
        })}

        {!cards.length && (
          <p className="text-sm text-gray-500 border border-dashed rounded-xl p-3 bg-gray-50 sm:col-span-2 lg:col-span-3">
            Аккаунтов нет: готовые ролики уходят в бот {bot}, выкладываете вы.
          </p>
        )}
      </div>

      {canManage && (
        <div className="mt-3 flex flex-wrap items-center gap-3 text-sm">
          <button className="btn btn-secondary" onClick={() => setAdding(!adding)}>{adding ? "Отменить" : "＋ Добавить аккаунт"}</button>
          {up && !up.error && (
            <button className="text-gray-600 hover:text-brand-700" onClick={() => setShowUp(!showUp)}>
              ⚡ Автопубликация · {up.profiles?.length || 0} {showUp ? "▴" : "▾"}
            </button>
          )}
          {(archived.length + archStats.length) > 0 && (
            <button className="text-gray-500 hover:text-gray-900" onClick={() => setShowArch(!showArch)}>
              🗄 Архив · {archived.length + archStats.length}
            </button>
          )}
        </div>
      )}

      {adding && canManage && (
        <form className="mt-3 flex flex-wrap gap-2 items-start" onSubmit={async (e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget as HTMLFormElement);
          const net = String(f.get("net"));
          const account = String(f.get("account") || "");
          const ok = await put({ newChannel: { title: `${NAME[NET[net]] || net}${account ? ` · ${account}` : ""}`, net, account } }, "newCh");
          if (ok) setAdding(false);
        }}>
          <select name="net" className="input text-sm max-w-[150px]" defaultValue="TT">
            <option value="TT">TikTok</option>
            <option value="YT">YouTube</option>
            <option value="IG">Instagram</option>
            <option value="TG">Telegram</option>
          </select>
          <input name="account" className="input text-sm max-w-[220px]" placeholder="имя аккаунта, например superfit05" />
          <button className="btn btn-primary text-sm" type="submit">Добавить</button>
          <p className="text-xs text-gray-500 basis-full">Новый аккаунт появляется с ручной выкладкой: ролики идут в бот, пока не включите «Выкладывает завод».</p>
        </form>
      )}

      {showUp && up && !up.error && (
        <div className="mt-3 border-t pt-3 space-y-2">
          <p className="text-xs text-gray-500">
            Автопубликация через upload-post (сервис, который выкладывает сразу во все соцсети). Профиль — связка
            из одного TikTok, одного YouTube и одного Instagram для одной аудитории: общий, мужской, под язык.
            {up.limit != null && <> Тариф {up.plan}: занято {up.used} из {up.limit} профилей на все проекты.</>}
          </p>
          {(up.profiles || []).map((p) => {
            const empty = !p.platforms.some((x) => x.connected);
            return (
              <div key={p.username} className="flex flex-wrap items-center gap-2 rounded-lg border px-3 py-2">
                <div className="min-w-[8rem]">
                  <div className="text-sm font-medium">{p.title}{p.main && <span className="ml-1.5 text-[11px] text-gray-400">основной</span>}</div>
                  <div className="text-[11px] text-gray-400 font-mono">{p.username}</div>
                </div>
                <div className="flex flex-wrap gap-1.5 flex-1">
                  {p.platforms.map((x) => (
                    <span key={x.platform} className={`text-xs px-2 py-0.5 rounded-lg ${x.connected ? "bg-green-50 text-green-800" : "bg-gray-50 text-gray-400"}`}>
                      {ICON[x.platform]} {x.label}{x.connected ? (x.handle ? ` · @${x.handle}` : " ✓") : " —"}
                    </span>
                  ))}
                </div>
                <button className="btn btn-secondary text-xs" disabled={mine === `link-${p.username}`} onClick={() => connect(p.username)}>
                  {mine === `link-${p.username}` ? "Открываю…" : "Подключить соцсети"}
                </button>
                {empty && !p.main && (
                  <button className="text-xs text-gray-400 hover:text-red-700" disabled={mine === `rm-${p.username}`} onClick={() => removeProfile(p)}>удалить</button>
                )}
              </div>
            );
          })}
          <div className="flex flex-wrap gap-2">
            <input className="input text-sm max-w-xs" value={profTitle} onChange={(e) => setProfTitle(e.target.value)}
              placeholder={(up.profiles || []).length ? "Название: Мужской, Футбол, English" : "Основной"}
              onKeyDown={(e) => e.key === "Enter" && profTitle.trim() && addProfile()} />
            <button className="btn btn-secondary text-sm" disabled={!profTitle.trim() || mine === "addprof"} onClick={addProfile}>
              {mine === "addprof" ? "Завожу…" : "＋ Профиль"}
            </button>
          </div>
        </div>
      )}

      {showArch && (
        <div className="mt-3 border-t pt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {archived.map((ch) => (
            <div key={ch.key} className="border rounded-lg p-3 bg-white text-sm">
              <div className="flex items-center justify-between gap-2">
                <b>{ICON[NET[ch.net]]} {ch.account || ch.title}</b>
                <span className="text-[11px] px-2 py-px rounded-full border bg-gray-50 text-gray-500">в архиве</span>
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

