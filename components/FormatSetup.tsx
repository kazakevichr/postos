"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AnketaForm, State, StatusPill, api } from "@/components/formatsUi";

// Настройка формата у проекта — по шагам. Каждый шаг сохраняется сам по
// себе: можно уйти посреди и вернуться, заполненное не пропадёт.

const STEP: Record<string, { title: string; sub: string }> = {
  brief: { title: "Анкета проекта", sub: "о чём, для кого, каким тоном" },
  source: { title: "Откуда темы", sub: "где завод берёт идеи" },
  face: { title: "Лицо", sub: "два фото героя" },
  voice: { title: "Голос", sub: "как звучит ролик" },
  schedule: { title: "Расписание", sub: "как часто и куда" },
};

const WAYS: { type: string; icon: string; title: string; text: string }[] = [
  { type: "donor", icon: "📺", title: "Доноры", text: "Смотрим чужие ролики вашей темы, берём идею и пишем своими словами." },
  { type: "search", icon: "🔎", title: "Поиск в интернете", text: "Свежие новости, исследования и факты по заданному запросу." },
  { type: "kb", icon: "📚", title: "База знаний", text: "Ваши файлы: гайды, статьи, методички. Темы и факты — оттуда." },
  { type: "brief", icon: "✍", title: "По анкете", text: "Идеи придумываются из анкеты проекта. Самый быстрый старт." },
  { type: "manual", icon: "🗓", title: "Вручную", text: "Темы вписываете сами в контент-плане. Пустые дни завод не трогает." },
];

const VOICES = [
  { id: "female_calm", title: "Женский, спокойный", text: "доверительно, без спешки" },
  { id: "female_bright", title: "Женский, живой", text: "бодро, с эмоцией" },
  { id: "male_calm", title: "Мужской, спокойный", text: "уверенно, по-экспертному" },
  { id: "male_bright", title: "Мужской, энергичный", text: "быстро, с напором" },
  { id: "clone", title: "Свой голос", text: "клон по записи 1–2 минуты — пришлём, как записать" },
];

const TIMES = ["08:00", "10:00", "12:00", "15:00", "18:00", "20:00", "22:00"];
const PER_WEEK = [3, 5, 7, 14];

export default function FormatSetup({ kind }: { kind: string }) {
  const router = useRouter();
  const [s, setS] = useState<State | null>(null);
  const [step, setStep] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState("");
  const [profiles, setProfiles] = useState<{ username: string; title: string }[]>([]);

  async function load() {
    const d = await fetch("/api/formats").then((r) => r.json()).catch(() => null);
    if (!d || d.error) return setErr(d?.error || "не загрузилось");
    setS(d);
    const f = d.catalog.find((x: any) => x.kind === kind);
    if (f?.added && !step) setStep(f.added.steps.find((x: any) => !x.done)?.step || "done");
    const a = await fetch("/api/social/accounts").then((r) => r.json()).catch(() => null);
    setProfiles(((a?.projects || []).find((x: any) => x.brand === d.brand)?.profiles) || []);
  }
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (err && !s) return <div className="card text-red-700">{err}</div>;
  if (!s) return <div className="text-sm text-gray-400">Загружаю…</div>;
  const f = s.catalog.find((x) => x.kind === kind);
  if (!f) return <div className="card">Такого формата нет. <a className="text-brand-700" href="/formats">К каталогу</a></div>;
  if (!f.added) {
    return (
      <div className="card max-w-xl">
        <div className="font-semibold">«{f.name}» ещё не добавлен в проект</div>
        <a className="btn btn-primary mt-3" href="/formats">Открыть каталог</a>
      </div>
    );
  }

  const cfg = f.added.config || {};
  const steps = f.added.steps;
  const idx = steps.findIndex((x) => x.step === step);
  const allDone = steps.every((x) => x.done);

  function next(d: State) {
    setS({ ...d, canEdit: s!.canEdit });
    const nf = d.catalog.find((x) => x.kind === kind);
    const later = nf?.added?.steps.slice(idx + 1).find((x) => !x.done) || nf?.added?.steps.find((x) => !x.done);
    setStep(later ? later.step : "done");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function run(body: any, key: string) {
    setBusy(key); setErr("");
    try { next(await api({ kind, ...body })); }
    catch (e: any) { setErr(e.message); }
    finally { setBusy(""); }
  }

  async function remove() {
    if (!confirm(`Убрать «${f!.name}» из проекта? Настройки формата сотрутся.`)) return;
    await api({ action: "remove", kind });
    router.push("/formats");
  }

  return (
    <div className="max-w-5xl space-y-6">
      <div>
        <a href="/formats" className="text-sm text-gray-400 hover:text-brand-700">← Форматы · {s.title}</a>
        <div className="flex items-center gap-3 flex-wrap mt-1">
          <h1 className="text-2xl font-semibold">{f.name}</h1>
          <StatusPill f={f} />
        </div>
        <p className="text-sm text-gray-500">{f.line}</p>
      </div>

      <div className="grid md:grid-cols-[15rem_minmax(0,1fr)] gap-6 items-start">
        <nav className="flex md:flex-col gap-1 overflow-x-auto -mx-4 px-4 md:mx-0 md:px-0">
          {steps.map((x, i) => {
            const on = x.step === step;
            return (
              <button key={x.step} onClick={() => setStep(x.step)}
                className={`shrink-0 flex items-center gap-3 rounded-xl px-3 py-2.5 text-left transition ${on ? "bg-white shadow-sm border" : "hover:bg-white/70"}`}>
                <span className={`shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-xs font-semibold ${
                  x.done ? "bg-green-600 text-white" : on ? "bg-brand-600 text-white" : "bg-gray-200 text-gray-500"}`}>
                  {x.done ? "✓" : i + 1}
                </span>
                <span>
                  <span className="block text-sm font-medium whitespace-nowrap">{STEP[x.step]?.title || x.step}</span>
                  <span className="hidden md:block text-[11px] text-gray-400">{STEP[x.step]?.sub}</span>
                </span>
              </button>
            );
          })}
          <button onClick={() => setStep("done")}
            className={`shrink-0 flex items-center gap-3 rounded-xl px-3 py-2.5 text-left transition ${step === "done" ? "bg-white shadow-sm border" : "hover:bg-white/70"}`}>
            <span className={`shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-xs ${allDone ? "bg-blue-600 text-white" : "bg-gray-200 text-gray-400"}`}>🚀</span>
            <span className="text-sm font-medium whitespace-nowrap">Запуск</span>
          </button>
        </nav>

        <div className="card p-5 md:p-6 min-h-[22rem]">
          {err && <p className="text-sm text-red-700 bg-red-50 rounded-lg px-3 py-2 mb-4">{err}</p>}
          {!s.canEdit && step !== "done" && (
            <p className="text-sm text-gray-500 bg-gray-50 rounded-lg px-3 py-2 mb-4">Смотреть можно, менять — с правом изменения в проекте.</p>
          )}

          {step === "brief" && (
            <Section title="Анкета проекта" sub="Одна на все форматы: заполните один раз — остальные форматы её подхватят.">
              {s.coded ? (
                <p className="text-sm text-gray-600">У проекта выверенный вручную бриф — анкета его не перезаписывает.</p>
              ) : (
                <AnketaForm key={JSON.stringify(s.anketa)} initial={s.anketa} onSaved={next} />
              )}
            </Section>
          )}

          {step === "source" && (
            <SourceStep s={s} kind={kind} busy={busy} onSave={(type, config) => run({ action: "source", type, config }, "source")} onReload={load} />
          )}

          {step === "face" && (
            <FaceStep s={s} cfg={cfg} busy={busy} onSave={(face) => run({ action: "config", config: { face } }, "face")} onReload={load} />
          )}

          {step === "voice" && (
            <Section title="Голос" sub="Каким голосом говорит ролик. Точный тембр подберём под лицо на пробном ролике.">
              <div className="grid sm:grid-cols-2 gap-2">
                {VOICES.map((v) => (
                  <Choice key={v.id} on={cfg.voice === v.id} icon={v.id === "clone" ? "🎙" : "🔊"} title={v.title} text={v.text}
                    onClick={() => s.canEdit && run({ action: "config", config: { voice: v.id } }, "voice")} />
                ))}
              </div>
            </Section>
          )}

          {step === "schedule" && (
            <ScheduleStep cfg={cfg} profiles={profiles} busy={busy} canEdit={s.canEdit}
              onSave={(schedule, account) => run({ action: "config", config: { schedule, account } }, "schedule")} />
          )}

          {step === "done" && (
            <Section title={allDone ? "Готово к запуску" : "Почти готово"}
              sub={allDone ? "Всё, что нужно формату, заполнено." : "Остались незаполненные шаги — они отмечены слева серым."}>
              {allDone ? (
                <div className="space-y-3">
                  <Next n="1" text="Владелец получил уведомление: формат ждёт включения на заводе." />
                  <Next n="2" text="Завод снимает пробный ролик — он появится в контент-плане на согласование." />
                  <Next n="3" text="После «Утвердить» формат выходит по расписанию сам." />
                  <div className="flex gap-2 pt-2 flex-wrap">
                    <a href="/plan" className="btn btn-primary">Открыть контент-план</a>
                    <a href="/formats" className="btn btn-secondary">Добавить ещё формат</a>
                  </div>
                </div>
              ) : (
                <ul className="space-y-1.5">
                  {steps.filter((x) => !x.done).map((x) => (
                    <li key={x.step}>
                      <button className="text-sm text-brand-700 hover:underline" onClick={() => setStep(x.step)}>
                        {STEP[x.step]?.title} →
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {s.canEdit && (
                <button className="text-xs text-gray-400 hover:text-red-700 mt-8 block" onClick={remove}>Убрать формат из проекта</button>
              )}
            </Section>
          )}
        </div>
      </div>
    </div>
  );
}

function Section({ title, sub, children }: { title: string; sub?: string; children: React.ReactNode }) {
  return (
    <div>
      <h2 className="text-lg font-semibold">{title}</h2>
      {sub && <p className="text-sm text-gray-500 mt-0.5 mb-5">{sub}</p>}
      {children}
    </div>
  );
}

function Choice({ on, icon, title, text, onClick }: { on: boolean; icon: string; title: string; text: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick}
      className={`text-left flex gap-3 rounded-xl border px-3 py-2.5 transition ${on ? "border-brand-600 ring-2 ring-brand-600/20 bg-brand-50/50" : "hover:border-gray-400"}`}>
      <span className="text-xl leading-6">{icon}</span>
      <span>
        <span className="block text-sm font-medium">{title}</span>
        <span className="block text-xs text-gray-500">{text}</span>
      </span>
    </button>
  );
}

function Next({ n, text }: { n: string; text: string }) {
  return (
    <div className="flex gap-3 items-start">
      <span className="shrink-0 w-6 h-6 rounded-full bg-blue-100 text-blue-800 text-xs font-semibold flex items-center justify-center">{n}</span>
      <span className="text-sm">{text}</span>
    </div>
  );
}

async function upload(role: string, file: File) {
  const fd = new FormData();
  fd.append("role", role);
  fd.append("file", file);
  const r = await fetch("/api/formats/asset", { method: "POST", body: fd });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || d.error) throw new Error(d.error || `ошибка ${r.status}`);
  return d.id as string;
}

function SourceStep({ s, kind, busy, onSave, onReload }: {
  s: State; kind: string; busy: string; onSave: (type: string, config: any) => void; onReload: () => void;
}) {
  const saved = s.sources[kind];
  const [type, setType] = useState(saved?.type || "");
  const [donors, setDonors] = useState((saved?.config?.donors || []).join("\n"));
  const [query, setQuery] = useState(saved?.config?.query || "");
  const [err, setErr] = useState("");
  const kb = s.assets.filter((a) => a.role === "kb");

  function save() {
    setErr("");
    if (type === "donor") {
      const list = donors.split(/\s+/).map((x: string) => x.trim()).filter(Boolean);
      if (!list.length) return setErr("добавьте хотя бы один канал");
      return onSave(type, { donors: list });
    }
    if (type === "search" && !query.trim()) return setErr("напишите, что искать");
    if (type === "kb" && !kb.length) return setErr("загрузите хотя бы один файл");
    onSave(type, type === "search" ? { query: query.trim() } : {});
  }

  async function addFiles(files: FileList | null) {
    setErr("");
    try { for (const f of Array.from(files || [])) await upload("kb", f); onReload(); }
    catch (e: any) { setErr(e.message); }
  }

  return (
    <Section title="Откуда темы" sub="Идею завод никогда не копирует — берёт мысль и пишет своими словами. Тема, вписанная в контент-план вручную, всегда важнее источника.">
      <div className="grid sm:grid-cols-2 gap-2">
        {WAYS.map((w) => <Choice key={w.type} on={type === w.type} icon={w.icon} title={w.title} text={w.text} onClick={() => setType(w.type)} />)}
      </div>

      {type === "donor" && (
        <label className="block mt-5">
          <div className="text-sm font-medium">Каналы-доноры</div>
          <textarea className="input mt-1 font-mono text-xs" rows={4} value={donors} onChange={(e) => setDonors(e.target.value)}
            placeholder={"https://www.youtube.com/@канал\nhttps://www.tiktok.com/@канал"} />
          <div className="text-[11px] text-gray-400 mt-1">По одной ссылке в строке. Лучше 3–10 каналов вашей темы.</div>
        </label>
      )}
      {type === "search" && (
        <label className="block mt-5">
          <div className="text-sm font-medium">Что искать</div>
          <input className="input mt-1" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Например: новые исследования сна и восстановления" />
        </label>
      )}
      {type === "kb" && (
        <div className="mt-5 space-y-2">
          <div className="text-sm font-medium">Файлы базы знаний</div>
          {kb.map((a) => (
            <div key={a.id} className="flex items-center justify-between rounded-lg border px-3 py-1.5 text-sm">
              <span className="truncate">📄 {a.name}</span>
              {s.canEdit && (
                <button className="text-xs text-gray-400 hover:text-red-700"
                  onClick={async () => { await fetch(`/api/formats/asset?id=${a.id}`, { method: "DELETE" }); onReload(); }}>убрать</button>
              )}
            </div>
          ))}
          {s.canEdit && (
            <label className="flex items-center justify-center rounded-xl border-2 border-dashed py-5 text-sm text-gray-500 cursor-pointer hover:border-brand-600 hover:text-brand-700">
              + Загрузить файлы (текст, PDF, Word — до 6 МБ)
              <input type="file" multiple className="hidden" accept=".txt,.md,.pdf,.doc,.docx,.json,text/*"
                onChange={(e) => addFiles(e.target.files)} />
            </label>
          )}
        </div>
      )}

      {err && <p className="text-sm text-red-700 mt-3">{err}</p>}
      {s.canEdit && type && (
        <button className="btn btn-primary mt-5" disabled={busy === "source"} onClick={save}>
          {busy === "source" ? "Сохраняю…" : "Сохранить и дальше"}
        </button>
      )}
    </Section>
  );
}

function FaceStep({ s, cfg, busy, onSave, onReload }: {
  s: State; cfg: any; busy: string; onSave: (face: any) => void; onReload: () => void;
}) {
  const [err, setErr] = useState("");
  const [up, setUp] = useState("");
  const asset = (role: string) => s.assets.find((a) => a.role === role);
  const slots = [
    { role: "face_medium", key: "medium", title: "Средний план", hint: "по пояс, смотрит в камеру", example: "/formats/face_medium.jpg" },
    { role: "face_close", key: "close", title: "Крупный план", hint: "лицо и плечи, ровный свет", example: "/formats/face_close.jpg" },
  ];

  async function put(role: string, file?: File) {
    if (!file) return;
    setErr(""); setUp(role);
    try { await upload(role, file); onReload(); }
    catch (e: any) { setErr(e.message); }
    finally { setUp(""); }
  }

  const medium = asset("face_medium");
  const close = asset("face_close");

  return (
    <Section title="Лицо" sub="Два кадра одного человека — из них оживает говорящий аватар. Своё лицо, сотрудник или сгенерированный персонаж.">
      <div className="grid sm:grid-cols-2 gap-4">
        {slots.map((sl) => {
          const a = asset(sl.role);
          return (
            <label key={sl.role} className={`group relative block rounded-2xl border-2 border-dashed overflow-hidden ${s.canEdit ? "cursor-pointer hover:border-brand-600" : ""}`}>
              <div className="aspect-[3/4] bg-gray-50 relative">
                {a ? (
                  <img src={`/api/formats/asset?id=${a.id}`} alt="" className="absolute inset-0 w-full h-full object-cover" />
                ) : (
                  <>
                    <img src={sl.example} alt="" className="absolute inset-0 w-full h-full object-cover opacity-25 grayscale" />
                    <div className="absolute inset-0 flex flex-col items-center justify-center text-center p-4">
                      <div className="text-3xl">📷</div>
                      <div className="text-sm font-medium mt-1">{up === sl.role ? "Загружаю…" : "Загрузить фото"}</div>
                      <div className="text-xs text-gray-500">{sl.hint}</div>
                    </div>
                  </>
                )}
              </div>
              <div className="px-3 py-2 text-sm font-medium flex justify-between bg-white">
                {sl.title}
                {a && <span className="text-xs text-brand-700 opacity-0 group-hover:opacity-100">заменить</span>}
              </div>
              {s.canEdit && <input type="file" accept="image/*" className="hidden" onChange={(e) => put(sl.role, e.target.files?.[0])} />}
            </label>
          );
        })}
      </div>
      <p className="text-[11px] text-gray-400 mt-2">Серым — пример кадра из СуперФита. Без очков и масок, фон спокойный.</p>
      {err && <p className="text-sm text-red-700 mt-3">{err}</p>}
      {s.canEdit && (
        <div className="flex flex-wrap items-center gap-3 mt-5">
          <button className="btn btn-primary" disabled={!medium || !close || busy === "face"}
            onClick={() => onSave({ medium: medium!.id, close: close!.id })}>
            {busy === "face" ? "Сохраняю…" : "Сохранить и дальше"}
          </button>
          <button className="text-sm text-gray-500 hover:text-brand-700" onClick={() => onSave({ persona: "request" })}>
            {cfg.face?.persona ? "✓ Подбираем персонажа вместе" : "Нет своего лица — подобрать персонажа вместе"}
          </button>
        </div>
      )}
    </Section>
  );
}

function ScheduleStep({ cfg, profiles, busy, canEdit, onSave }: {
  cfg: any; profiles: { username: string; title: string }[]; busy: string; canEdit: boolean;
  onSave: (schedule: any, account: string) => void;
}) {
  const [per, setPer] = useState<number>(cfg.schedule?.perWeek || 7);
  const [times, setTimes] = useState<string[]>(cfg.schedule?.times || ["18:00"]);
  const [account, setAccount] = useState<string>(cfg.account || profiles[0]?.username || "");
  const perDay = Math.max(1, Math.ceil(per / 7));

  return (
    <Section title="Расписание" sub="Сколько выпусков в неделю, во сколько и в какой аккаунт. Поменять можно в любой момент в пульте завода.">
      <div className="space-y-5">
        <div>
          <div className="text-sm font-medium mb-1.5">Выпусков в неделю</div>
          <div className="flex gap-1.5">
            {PER_WEEK.map((n) => (
              <button key={n} onClick={() => setPer(n)}
                className={`w-14 py-2 rounded-xl border text-sm font-medium ${per === n ? "bg-brand-600 border-brand-600 text-white" : "hover:border-gray-400"}`}>{n}</button>
            ))}
          </div>
        </div>
        <div>
          <div className="text-sm font-medium mb-1.5">Время выхода <span className="text-gray-400 font-normal">· по Москве, нужно {perDay} в день</span></div>
          <div className="flex flex-wrap gap-1.5">
            {TIMES.map((t) => {
              const on = times.includes(t);
              return (
                <button key={t} onClick={() => setTimes(on ? times.filter((x) => x !== t) : [...times, t].sort())}
                  className={`px-3 py-1.5 rounded-xl border text-sm tabular-nums ${on ? "bg-brand-600 border-brand-600 text-white" : "hover:border-gray-400"}`}>{t}</button>
              );
            })}
          </div>
        </div>
        <div>
          <div className="text-sm font-medium mb-1.5">Аккаунт публикации</div>
          {profiles.length ? (
            <select className="input max-w-xs" value={account} onChange={(e) => setAccount(e.target.value)}>
              {profiles.map((p) => <option key={p.username} value={p.username}>{p.title}</option>)}
            </select>
          ) : (
            <p className="text-sm text-gray-500">Аккаунтов ещё нет — заведите их в <a href="/social" className="text-brand-700 hover:underline">Соц.Сетях</a>. Пока ролики будут приходить на согласование.</p>
          )}
        </div>
        {canEdit && (
          <button className="btn btn-primary" disabled={!times.length || busy === "schedule"}
            onClick={() => onSave({ perWeek: per, times }, account)}>
            {busy === "schedule" ? "Сохраняю…" : "Сохранить"}
          </button>
        )}
      </div>
    </Section>
  );
}
