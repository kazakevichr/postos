"use client";

import { useEffect, useState } from "react";
import { brandLabel } from "@/lib/brands";

// Аккаунты публикации проекта — в начале «Соц.Сетей».
//
// Каждая строка — аккаунт проекта (профиль upload-post): общий, мужской,
// футбольный, англоязычный. Против каждого — какие площадки к нему
// подключены. «Подключить» открывает страницу upload-post, где человек сам
// входит в свои соцсети; после этого его возвращает сюда, и строка
// обновляется.

type Conn = { platform: string; label: string; connected: boolean; handle: string };
type Prof = { username: string; title: string; main: boolean; platforms: Conn[] };
type Proj = {
  brand: string;
  title?: string;
  plan?: string;
  limit?: number | null;
  used?: number;
  profiles?: Prof[];
  error?: string;
};

const ICON: Record<string, string> = { tiktok: "🎵", youtube: "📺", instagram: "📸" };

export default function PublishAccounts({ brands }: { brands?: string[] }) {
  const [projects, setProjects] = useState<Proj[] | null>(null);
  const [canEdit, setCanEdit] = useState(false);
  const [busy, setBusy] = useState("");
  const [adding, setAdding] = useState("");
  const [title, setTitle] = useState("");
  const [note, setNote] = useState("");

  async function load() {
    const d = await fetch("/api/social/accounts").then((r) => r.json()).catch(() => null);
    if (!d || d.error) return setProjects([]);
    const list: Proj[] = d.projects || [];
    setProjects(brands ? list.filter((p) => brands.includes(p.brand)) : list);
    setCanEdit(Boolean(d.canEdit));
  }

  useEffect(() => {
    load();
    // Вернулись со страницы подключения — перечитываем, иначе новая площадка
    // покажется только после ручного обновления.
    const again = () => document.visibilityState === "visible" && load();
    document.addEventListener("visibilitychange", again);
    return () => document.removeEventListener("visibilitychange", again);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function post(body: any) {
    const r = await fetch("/api/social/accounts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok || d.error) throw new Error(d.error || `ошибка ${r.status}`);
    return d;
  }

  async function connect(brand: string, username: string) {
    setBusy(username);
    setNote("");
    // Окно открываем СРАЗУ, по клику, и только потом подставляем адрес:
    // браузер блокирует окна, открытые после ожидания ответа сервера.
    const win = window.open("about:blank", "_blank");
    try {
      const d = await post({ brand, action: "link", username });
      if (win) win.location.href = d.url;
      else window.location.href = d.url;
    } catch (e: any) {
      win?.close();
      setNote(`Не вышло получить ссылку: ${e.message}`);
    } finally {
      setBusy("");
    }
  }

  async function add(brand: string) {
    setBusy(`add:${brand}`);
    setNote("");
    try {
      await post({ brand, action: "add", title });
      setTitle("");
      setAdding("");
      await load();
    } catch (e: any) {
      setNote(`Аккаунт не заведён: ${e.message}`);
    } finally {
      setBusy("");
    }
  }

  // Ключ upload-post не задан ни одному проекту — блоку нечего показывать.
  if (!projects || projects.length === 0) return null;

  return (
    <div className="card space-y-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h2 className="font-semibold">Аккаунты публикации</h2>
          <p className="text-xs text-gray-400">
            Куда завод выкладывает ролики. У проекта может быть сколько угодно аккаунтов —
            общий, мужской, под вид спорта или язык. В каждом — по одному TikTok, YouTube и Instagram.
          </p>
        </div>
      </div>

      {note && <p className="text-sm text-red-700 bg-red-50 rounded-lg px-3 py-2">{note}</p>}

      {projects.map((p) => (
        <div key={p.brand} className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="font-semibold">{p.title || brandLabel(p.brand)}</span>
            {p.limit != null && (
              <span className={`text-xs px-2 py-0.5 rounded-full ${
                (p.used ?? 0) >= p.limit ? "bg-red-100 text-red-800" : "bg-gray-100 text-gray-600"
              }`}>
                тариф {p.plan}: занято {p.used} из {p.limit}
              </span>
            )}
          </div>

          {p.error ? (
            <p className="text-sm text-red-700">upload-post не ответил: {p.error}</p>
          ) : (
            <div className="border rounded-xl divide-y">
              {(p.profiles || []).map((a) => (
                <div key={a.username} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-3 py-2.5">
                  <div className="min-w-[9rem]">
                    <div className="font-medium text-sm">
                      {a.title}
                      {a.main && <span className="ml-2 text-[11px] text-gray-400">основной</span>}
                    </div>
                    <div className="text-[11px] text-gray-400 font-mono">{a.username}</div>
                  </div>
                  <div className="flex flex-wrap gap-1.5 flex-1">
                    {a.platforms.map((c) => (
                      <span key={c.platform}
                        className={`text-xs px-2 py-1 rounded-lg ${
                          c.connected ? "bg-green-50 text-green-800" : "bg-gray-50 text-gray-400"
                        }`}
                        title={c.connected ? "подключено" : "не подключено"}>
                        {ICON[c.platform]} {c.label}
                        {c.connected ? (c.handle ? ` · @${c.handle}` : " ✓") : " —"}
                      </span>
                    ))}
                  </div>
                  {canEdit && (
                    <button className="btn btn-secondary" disabled={busy === a.username}
                      onClick={() => connect(p.brand, a.username)}>
                      {busy === a.username ? "Открываю…" : "Подключить"}
                    </button>
                  )}
                </div>
              ))}
              {(p.profiles || []).length === 0 && (
                <div className="px-3 py-2.5 text-sm text-gray-500">
                  Аккаунтов ещё нет. Первый станет основным — в него завод выкладывает по умолчанию.
                </div>
              )}
            </div>
          )}

          {canEdit && !p.error && (
            adding === p.brand ? (
              <div className="flex flex-wrap gap-2">
                <input className="input max-w-xs" autoFocus value={title}
                  placeholder={(p.profiles || []).length ? "Мужской" : "Основной"}
                  onChange={(e) => setTitle(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && add(p.brand)} />
                <button className="btn btn-primary" disabled={busy === `add:${p.brand}`}
                  onClick={() => add(p.brand)}>
                  {busy === `add:${p.brand}` ? "Завожу…" : "Завести"}
                </button>
                <button className="btn btn-secondary" onClick={() => { setAdding(""); setTitle(""); }}>
                  Отмена
                </button>
              </div>
            ) : (
              <button className="text-sm text-brand-700 hover:underline"
                disabled={p.limit != null && (p.used ?? 0) >= p.limit}
                onClick={() => { setAdding(p.brand); setTitle(""); }}>
                + Добавить аккаунт
              </button>
            )
          )}
        </div>
      ))}
    </div>
  );
}
