"use client";

import { useState } from "react";

// Общие куски каталога и мастера: превью примера, цифры, анкета проекта.

export type Stats = { cost: number | null; minutes: number | null; made: number } | null;
export type Fmt = {
  kind: string; name: string; line: string; media: "video" | "pics" | "none";
  video?: string; pics?: string[]; runsAt: string; how: string[];
  need: { icon: string; title: string; text: string }[];
  warn?: string; steps: string[]; blocked?: string; easy?: boolean;
  stats: Stats; running: boolean;
  added: null | { status: "setup" | "ready" | "live"; config: any; steps: { step: string; done: boolean }[] };
};
export type Anketa = {
  about: string; audience: string; tone: string[]; help: string;
  avoid: string; cta: string; bans: string; example: string;
};
export type State = {
  brand: string; title: string; coded: boolean; anketa: Anketa | null; canEdit: boolean;
  assets: { id: string; role: string; name: string }[];
  sources: Record<string, { type: string; config: any }>;
  catalog: Fmt[];
};

export async function api(body: any): Promise<State> {
  const r = await fetch("/api/formats", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || d.error) throw new Error(d.error || `ошибка ${r.status}`);
  return d;
}

export function statsLine(s: Stats): string {
  if (!s || !s.made) return "";
  const parts = [];
  if (s.cost != null) parts.push(`≈ $${s.cost < 1 ? s.cost.toFixed(2) : s.cost.toFixed(1)} за штуку`);
  if (s.minutes != null) parts.push(`${s.minutes} мин`);
  parts.push(`сделано ${s.made}`);
  return parts.join(" · ");
}

export function StatusPill({ f }: { f: Fmt }) {
  if (f.running) return <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-green-100 text-green-800">● работает</span>;
  if (!f.added) return null;
  if (f.added.status === "live") return <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-green-100 text-green-800">● работает</span>;
  if (f.added.status === "ready") return <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-blue-100 text-blue-800">готов к запуску</span>;
  const done = f.added.steps.filter((s) => s.done).length;
  return <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-amber-100 text-amber-800">настройка {done} из {f.added.steps.length}</span>;
}

/** Картинка формата в карточке: ролик — первый кадр, по наведению играет; карусель — веер слайдов. */
export function Preview({ f, tall }: { f: Fmt; tall?: boolean }) {
  const box = `relative overflow-hidden bg-gradient-to-br from-gray-100 to-gray-200 ${tall ? "aspect-[9/14]" : "aspect-[4/3]"}`;
  if (f.media === "video" && f.video) {
    return (
      <div className={box}>
        <video src={f.video} poster={f.video.replace(/\.mp4$/, ".jpg")} muted loop playsInline preload="none"
          className="absolute inset-0 w-full h-full object-cover"
          onMouseEnter={(e) => e.currentTarget.play().catch(() => {})}
          onMouseLeave={(e) => { e.currentTarget.pause(); e.currentTarget.currentTime = 0; }} />
        <span className="absolute left-2 bottom-2 text-[11px] font-medium bg-black/60 text-white rounded-full px-2 py-0.5">▶ ролик</span>
      </div>
    );
  }
  if (f.media === "pics" && f.pics?.length) {
    const [a, b, c] = f.pics;
    return (
      <div className={`${box} flex items-center justify-center`}>
        {c && <img src={c} alt="" className="absolute h-[78%] aspect-[4/5] object-cover rounded-lg shadow-md rotate-[8deg] translate-x-[38%]" />}
        {b && <img src={b} alt="" className="absolute h-[78%] aspect-[4/5] object-cover rounded-lg shadow-md -rotate-[8deg] -translate-x-[38%]" />}
        <img src={a} alt="" className="relative h-[84%] aspect-[4/5] object-cover rounded-lg shadow-lg" />
        <span className="absolute left-2 bottom-2 text-[11px] font-medium bg-black/60 text-white rounded-full px-2 py-0.5">▦ карусель</span>
      </div>
    );
  }
  return (
    <div className={`${box} flex flex-col items-center justify-center text-gray-400`}>
      <div className="text-4xl">🏋</div>
      <div className="text-xs mt-1">примера пока нет</div>
    </div>
  );
}

const TONES = ["дружелюбный", "экспертный", "с юмором", "дерзкий", "спокойный", "вдохновляющий", "простой, без терминов"];

const FIELDS: { key: keyof Anketa; q: string; hint: string; long?: boolean }[] = [
  { key: "about", q: "О чём проект?", hint: "Одно-два предложения. Например: домашние тренировки и питание для занятых женщин 30+", long: true },
  { key: "audience", q: "Для кого?", hint: "Кто смотрит: возраст, ситуация, чего хочет" },
  { key: "help", q: "Что зритель получает от выпуска?", hint: "Например: один приём, который можно сделать сегодня" },
  { key: "cta", q: "Куда ведём в конце?", hint: "Подписаться, сохранить, перейти в бот — или ничего" },
  { key: "avoid", q: "Чего избегать?", hint: "Темы и приёмы, которые проекту не подходят" },
  { key: "bans", q: "Жёсткие запреты", hint: "Что нельзя никогда: обещания, слова, конкуренты" },
  { key: "example", q: "Пример удачного ролика или поста", hint: "Ссылка или пересказ — чтобы модель поймала манеру", long: true },
];

/** Анкета проекта — одна на все форматы: из неё собирается бриф для модели. */
export function AnketaForm({ initial, onSaved, compact }: { initial: Anketa | null; onSaved: (s: State) => void; compact?: boolean }) {
  const [a, setA] = useState<Anketa>(initial || { about: "", audience: "", tone: [], help: "", avoid: "", cta: "", bans: "", example: "" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const set = (k: keyof Anketa, v: any) => setA((x) => ({ ...x, [k]: v }));

  async function save() {
    setBusy(true); setErr("");
    try { onSaved(await api({ action: "anketa", anketa: a })); }
    catch (e: any) { setErr(e.message); }
    finally { setBusy(false); }
  }

  return (
    <div className="space-y-4">
      {FIELDS.slice(0, compact ? 4 : FIELDS.length).map((f) => (
        <label key={f.key} className="block">
          <div className="text-sm font-medium">{f.q}</div>
          {f.long ? (
            <textarea className="input mt-1" rows={2} value={a[f.key] as string} placeholder={f.hint}
              onChange={(e) => set(f.key, e.target.value)} />
          ) : (
            <input className="input mt-1" value={a[f.key] as string} placeholder={f.hint}
              onChange={(e) => set(f.key, e.target.value)} />
          )}
        </label>
      ))}
      <div>
        <div className="text-sm font-medium">Тон</div>
        <div className="flex flex-wrap gap-1.5 mt-1.5">
          {TONES.map((t) => {
            const on = a.tone.includes(t);
            return (
              <button key={t} type="button"
                onClick={() => set("tone", on ? a.tone.filter((x) => x !== t) : [...a.tone, t].slice(0, 3))}
                className={`text-sm px-3 py-1 rounded-full border transition ${on ? "bg-brand-600 border-brand-600 text-white" : "bg-white hover:border-gray-400"}`}>
                {t}
              </button>
            );
          })}
        </div>
        <div className="text-[11px] text-gray-400 mt-1">до трёх</div>
      </div>
      {err && <p className="text-sm text-red-700 bg-red-50 rounded-lg px-3 py-2">{err}</p>}
      <button className="btn btn-primary" disabled={busy} onClick={save}>{busy ? "Сохраняю…" : "Сохранить анкету"}</button>
    </div>
  );
}
