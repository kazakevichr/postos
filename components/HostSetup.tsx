"use client";

import { useEffect, useRef, useState } from "react";
import { Choice, SourcePicker, State, StatusPill, api, upload } from "@/components/formatsUi";

// Мастер формата «Ведущий» (спецификация 14.10.2026). Пять шагов, каждый
// сохраняется сам; последний — расписание и пробный выпуск. В расписание
// формат встаёт только после «Утвердить» пробного ролика.

const STEPS = [
  { key: "photo", title: "Ведущий", sub: "фото, которое оживёт" },
  { key: "voice", title: "Голос", sub: "из библиотеки ElevenLabs" },
  { key: "material", title: "Материал", sub: "темы, ссылки, угол подачи" },
  { key: "video", title: "Ролик", sub: "длина, вставки, концовка" },
  { key: "schedule", title: "Запуск", sub: "расписание и пробный ролик" },
];

const INSERTS = [
  { id: "low", title: "Мало", text: "ведущий почти всё время в кадре" },
  { id: "mid", title: "Средне", text: "ведущий и вставки поровну" },
  { id: "high", title: "Много", text: "вставки чаще, ведущий — в начале, в конце и между ними" },
];
const TIMES = ["08:00", "10:00", "12:00", "15:00", "18:00", "20:00", "22:00"];
const PER_WEEK = [3, 5, 7];

function Section({ title, sub, children }: { title: string; sub?: string; children: React.ReactNode }) {
  return (
    <div>
      <h2 className="text-lg font-semibold">{title}</h2>
      {sub && <p className="text-sm text-gray-500 mt-0.5 mb-5">{sub}</p>}
      {children}
    </div>
  );
}

async function hostApi(body: any) {
  const r = await fetch("/api/formats/host", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || d.error) throw new Error(d.error || `ошибка ${r.status}`);
  return d;
}

export default function HostSetup({ s, reload }: { s: State; reload: () => Promise<void> }) {
  const f = s.catalog.find((x) => x.kind === "host")!;
  const cfg = f.added?.config || {};
  const done = (k: string) => Boolean(f.added?.steps.find((x) => x.step === k)?.done)
    || (k === "schedule" && Boolean(cfg.schedule?.perWeek && (cfg.schedule?.times || []).length));
  const [step, setStep] = useState(STEPS.find((x) => !done(x.key))?.key || "schedule");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState("");
  const [host, setHost] = useState<any>(null);

  async function loadHost() {
    const d = await fetch("/api/formats/host").then((r) => r.json()).catch(() => null);
    if (d && !d.error) setHost(d);
  }
  useEffect(() => { loadHost(); }, []);

  async function save(part: any, key: string) {
    setBusy(key); setErr("");
    try { await hostApi({ action: "config", config: part }); await reload(); }
    catch (e: any) { setErr(e.message); }
    finally { setBusy(""); }
  }

  const ro = !s.canEdit;

  return (
    <div className="max-w-5xl space-y-6">
      <div>
        <a href="/formats" className="text-sm text-gray-400 hover:text-brand-700">← Форматы · {s.title}</a>
        <div className="flex items-center gap-3 flex-wrap mt-1">
          <h1 className="text-2xl font-semibold">Ведущий</h1>
          <StatusPill f={f} />
          {host?.status === "live" && <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-green-100 text-green-800">● в расписании</span>}
        </div>
        <p className="text-sm text-gray-500">{f.line}</p>
      </div>

      <div className="grid md:grid-cols-[15rem_minmax(0,1fr)] gap-6 items-start">
        <nav className="flex md:flex-col gap-1 overflow-x-auto -mx-4 px-4 md:mx-0 md:px-0">
          {STEPS.map((x, i) => {
            const on = x.key === step;
            const ok = x.key === "schedule" ? host?.status === "live" : done(x.key);
            return (
              <button key={x.key} onClick={() => setStep(x.key)}
                className={`shrink-0 flex items-center gap-3 rounded-xl px-3 py-2.5 text-left transition ${on ? "bg-white shadow-sm border" : "hover:bg-white/70"}`}>
                <span className={`shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-xs font-semibold ${
                  ok ? "bg-green-600 text-white" : on ? "bg-brand-600 text-white" : "bg-gray-200 text-gray-500"}`}>
                  {ok ? "✓" : i + 1}
                </span>
                <span>
                  <span className="block text-sm font-medium whitespace-nowrap">{x.title}</span>
                  <span className="hidden md:block text-[11px] text-gray-400">{x.sub}</span>
                </span>
              </button>
            );
          })}
        </nav>

        <div className="card p-5 md:p-6 min-h-[22rem]">
          {err && <p className="text-sm text-red-700 bg-red-50 rounded-lg px-3 py-2 mb-4">{err}</p>}
          {ro && <p className="text-sm text-gray-500 bg-gray-50 rounded-lg px-3 py-2 mb-4">Смотреть можно, менять — с правом изменения в проекте.</p>}

          {step === "photo" && <PhotoStep s={s} cfg={cfg} ro={ro} onDone={async () => { await reload(); setStep("voice"); }} />}
          {step === "voice" && <VoiceStep cfg={cfg} ro={ro} sample={host?.sample || ""} onSaved={async () => { await reload(); await loadHost(); }} onNext={() => setStep("material")} />}
          {step === "material" && (
            <Section title="Материал" sub="Откуда ролики берут темы, факты и вставки. Тема, вписанная в контент-план руками, всегда важнее источника.">
              <SourcePicker current={s.sources.host} assets={s.assets} canEdit={!ro} busy={busy === "src"}
                onSave={async (type, config) => {
                  setBusy("src"); setErr("");
                  try { await api({ action: "source", kind: "host", type, config }); await reload(); }
                  catch (e: any) { setErr(e.message); } finally { setBusy(""); }
                }} onReload={reload} />
              <AngleField value={cfg.angle || ""} ro={ro} busy={busy === "angle"} onSave={(angle) => save({ angle }, "angle")} />
            </Section>
          )}
          {step === "video" && <VideoStep s={s} cfg={cfg} ro={ro} busy={busy} onSave={(v) => save({ video: { ...(cfg.video || {}), ...v } }, "video")} onReload={reload} />}
          {step === "schedule" && <LaunchStep cfg={cfg} ro={ro} host={host} busy={busy}
            onSave={(part) => save(part, "schedule")} reloadHost={loadHost} setErr={setErr} ready={done("photo") && done("voice")} />}
        </div>
      </div>
    </div>
  );
}

// ── 1. Фото ──────────────────────────────────────────────────────────────────

function PhotoStep({ s, cfg, ro, onDone }: { s: State; cfg: any; ro: boolean; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [check, setCheck] = useState<any>(cfg.photo?.check || null);
  const asset = cfg.photo?.asset || s.assets.find((a) => a.role === "host_photo")?.id;

  async function put(file?: File) {
    if (!file) return;
    setErr(""); setBusy(true); setCheck(null);
    try {
      const dims = await new Promise<{ w: number; h: number }>((res) => {
        const img = new Image();
        img.onload = () => res({ w: img.naturalWidth, h: img.naturalHeight });
        img.onerror = () => res({ w: 0, h: 0 });
        img.src = URL.createObjectURL(file);
      });
      const id = await upload("host_photo", file);
      const d = await hostApi({ action: "photo", asset: id, ...dims });
      setCheck(d.check);
      if (d.check?.ok) onDone();
    } catch (e: any) { setErr(e.message); }
    finally { setBusy(false); }
  }

  return (
    <Section title="Ведущий" sub="Одно фото человека, который будет вести ролики. Нейросеть оживит его под голос. Фон остаётся тем, что на снимке.">
      <div className="grid sm:grid-cols-[14rem_minmax(0,1fr)] gap-5 items-start">
        <label className={`block rounded-2xl border-2 border-dashed overflow-hidden ${ro ? "" : "cursor-pointer hover:border-brand-600"}`}>
          <div className="aspect-[9/16] bg-gray-50 relative">
            {asset ? (
              <img src={`/api/formats/asset?id=${asset}`} alt="" className="absolute inset-0 w-full h-full object-cover" />
            ) : (
              <div className="absolute inset-0 flex flex-col items-center justify-center text-center p-4 text-gray-500">
                <div className="text-3xl">📷</div>
                <div className="text-sm font-medium mt-1">{busy ? "Проверяю…" : "Загрузить фото"}</div>
              </div>
            )}
            {busy && asset && <div className="absolute inset-0 bg-white/70 flex items-center justify-center text-sm">Проверяю…</div>}
          </div>
          {!ro && <input type="file" accept="image/*" className="hidden" onChange={(e) => put(e.target.files?.[0])} />}
        </label>
        <div className="space-y-3 text-sm">
          <div className="rounded-xl border px-3 py-2.5">
            <div className="font-medium mb-1">Что подходит</div>
            <ul className="text-gray-600 space-y-0.5 list-disc pl-4">
              <li>вертикальное фото или по пояс, от 1080 пикселей</li>
              <li>лицо смотрит в камеру, рот виден</li>
              <li>руки не у лица; очки — можно</li>
              <li>над головой немного места — туда ложатся плашки</li>
            </ul>
          </div>
          {check && (check.ok
            ? <p className="rounded-xl bg-green-50 text-green-800 px-3 py-2">✓ Фото подходит для оживления</p>
            : <div className="rounded-xl bg-amber-50 text-amber-900 px-3 py-2">
                <div className="font-medium">Фото может оживиться плохо:</div>
                <ul className="list-disc pl-4 mt-1">{(check.issues || []).map((x: string) => <li key={x}>{x}</li>)}</ul>
                {!ro && <button className="text-xs underline mt-2" onClick={onDone}>Всё равно использовать это фото</button>}
              </div>)}
          {err && <p className="text-red-700">{err}</p>}
        </div>
      </div>
    </Section>
  );
}

// ── 2. Голос ─────────────────────────────────────────────────────────────────

function VoiceStep({ cfg, ro, sample, onSaved, onNext }: { cfg: any; ro: boolean; sample: string; onSaved: () => Promise<void>; onNext: () => void }) {
  const [ref, setRef] = useState(cfg.voice?.ref || "");
  const [speed, setSpeed] = useState<number>(cfg.voice?.speed || 1.1);
  const [style, setStyle] = useState<number>(cfg.voice?.style ?? 0.35);
  const [state, setState] = useState("");
  const [err, setErr] = useState("");
  const [audio, setAudio] = useState(sample);
  const timer = useRef<any>(null);
  useEffect(() => () => clearInterval(timer.current), []);
  useEffect(() => { setAudio(sample); }, [sample]);

  async function check() {
    setErr(""); setState("Добавляю голос и озвучиваю пробную фразу…");
    try {
      const d = await hostApi({ action: "voice", ref, speed, style });
      clearInterval(timer.current);
      let n = 0;
      timer.current = setInterval(async () => {
        n++;
        const t = await fetch(`/api/formats/host?task=${d.task}`).then((r) => r.json()).catch(() => null);
        if (t?.state === "done") {
          clearInterval(timer.current); setState("");
          await onSaved();
          setAudio((t.result?.sample ? `/api/formats/asset?id=${t.result.sample}` : sample) + `&t=${Date.now()}`);
        } else if (t?.state === "fail") {
          clearInterval(timer.current); setState(""); setErr(t.error || "голос не проверился");
        } else if (n > 60) {
          clearInterval(timer.current); setState(""); setErr("завод не ответил за три минуты — попробуйте ещё раз");
        }
      }, 3000);
    } catch (e: any) { setState(""); setErr(e.message); }
  }

  return (
    <Section title="Голос" sub="Голос берётся из библиотеки ElevenLabs. Озвучку оплачиваем мы — от вас только ссылка или ID голоса.">
      <ol className="text-sm text-gray-600 list-decimal pl-5 space-y-1 mb-5">
        <li>Откройте <a className="text-brand-700 hover:underline" href="https://elevenlabs.io/app/voice-library" target="_blank">библиотеку голосов ElevenLabs</a> и выберите голос. Свой клон тоже подойдёт — опубликуйте его в библиотеку.</li>
        <li>Скопируйте ссылку на голос или его ID (кнопка «Copy voice ID»).</li>
        <li>Вставьте сюда и нажмите «Проверить» — услышите пробную фразу этим голосом.</li>
      </ol>
      <div className="flex flex-wrap gap-2">
        <input className="input flex-1 min-w-[16rem] font-mono text-xs" value={ref} disabled={ro}
          onChange={(e) => setRef(e.target.value)} placeholder="https://elevenlabs.io/app/voice-library?voiceId=… или ID" />
        {!ro && <button className="btn btn-primary" disabled={!ref.trim() || Boolean(state)} onClick={check}>{state ? "Проверяю…" : "Проверить"}</button>}
      </div>
      <div className="grid sm:grid-cols-2 gap-5 mt-5">
        <label className="block text-sm">
          <div className="font-medium">Скорость речи · ×{speed.toFixed(2)}</div>
          <input type="range" min={0.9} max={1.3} step={0.05} value={speed} disabled={ro} onChange={(e) => setSpeed(Number(e.target.value))} className="w-full" />
          <div className="flex justify-between text-[11px] text-gray-400"><span>спокойно</span><span>быстро</span></div>
        </label>
        <label className="block text-sm">
          <div className="font-medium">Выразительность</div>
          <input type="range" min={0} max={1} step={0.05} value={1 - style} disabled={ro} onChange={(e) => setStyle(1 - Number(e.target.value))} className="w-full" />
          <div className="flex justify-between text-[11px] text-gray-400"><span>ровно</span><span>эмоционально</span></div>
        </label>
      </div>
      {state && <p className="text-sm text-gray-500 mt-4">{state}</p>}
      {err && <p className="text-sm text-red-700 mt-4">{err}</p>}
      {audio && !state && (
        <div className="mt-5 rounded-xl border px-3 py-3">
          <div className="text-sm font-medium mb-2">Пробная фраза {cfg.voice?.name ? `· ${cfg.voice.name}` : ""}</div>
          <audio controls src={audio} className="w-full" />
          <p className="text-[11px] text-gray-400 mt-1">Поменяли скорость или выразительность — нажмите «Проверить» ещё раз.</p>
        </div>
      )}
      {cfg.voice?.id && !ro && <button className="btn btn-secondary mt-5" onClick={onNext}>Дальше →</button>}
    </Section>
  );
}

// ── 3. Угол подачи ───────────────────────────────────────────────────────────

function AngleField({ value, ro, busy, onSave }: { value: string; ro: boolean; busy: boolean; onSave: (v: string) => void }) {
  const [v, setV] = useState(value);
  return (
    <label className="block mt-6">
      <div className="text-sm font-medium">Угол подачи</div>
      <p className="text-xs text-gray-500 mb-1.5">Чей взгляд и какой вывод для зрителя. Работает при любом источнике.</p>
      <textarea className="input" rows={3} value={v} disabled={ro} onChange={(e) => setV(e.target.value)}
        placeholder="Семейный психолог разбирает новости о звёздах: что это говорит об отношениях и как не повторить у себя" />
      {!ro && <button className="btn btn-primary mt-2" disabled={busy || v === value} onClick={() => onSave(v.trim())}>{busy ? "Сохраняю…" : "Сохранить"}</button>}
    </label>
  );
}

// ── 4. Ролик ─────────────────────────────────────────────────────────────────

function VideoStep({ s, cfg, ro, busy, onSave, onReload }: { s: State; cfg: any; ro: boolean; busy: string; onSave: (v: any) => void; onReload: () => Promise<void> }) {
  const v = cfg.video || {};
  const [min, setMin] = useState<number>(v.min || 40);
  const [max, setMax] = useState<number>(v.max || 60);
  const [inserts, setInserts] = useState<string>(v.inserts || "mid");
  const [plates, setPlates] = useState<boolean>(v.plates !== false);
  const [subs, setSubs] = useState<boolean>(v.subtitles !== false);
  const [c1, setC1] = useState<string>((v.colors || [])[0] || "#22D07A");
  const [c2, setC2] = useState<string>((v.colors || [])[1] || "#FFFFFF");
  const [ending, setEnding] = useState<string>(v.ending || "");
  const [err, setErr] = useState("");
  const logo = v.logo || s.assets.find((a) => a.role === "logo")?.id;

  function submit() {
    setErr("");
    if (!(min >= 10 && max <= 180 && min < max)) return setErr("длина: «от» меньше «до», в пределах 10–180 секунд");
    onSave({ min, max, inserts, plates, subtitles: subs, colors: [c1, c2], ending: ending.trim(), logo });
  }

  return (
    <Section title="Ролик" sub="Как выглядит каждый выпуск. Всё можно поменять в любой момент.">
      <div className="space-y-6">
        <div>
          <div className="text-sm font-medium mb-1.5">Длина, секунд</div>
          <div className="flex items-center gap-2">
            <input type="number" className="input w-24" value={min} disabled={ro} onChange={(e) => setMin(Number(e.target.value))} />
            <span className="text-gray-400">—</span>
            <input type="number" className="input w-24" value={max} disabled={ro} onChange={(e) => setMax(Number(e.target.value))} />
          </div>
          <p className="text-[11px] text-gray-400 mt-1">Текст пишется под этот коридор, даже если тема тянет на две минуты.</p>
        </div>
        <div>
          <div className="text-sm font-medium mb-1.5">Вставки между фразами ведущего</div>
          <div className="grid sm:grid-cols-3 gap-2">
            {INSERTS.map((x) => <Choice key={x.id} on={inserts === x.id} icon={x.id === "low" ? "🧑" : x.id === "mid" ? "🎞" : "🎬"} title={x.title} text={x.text} onClick={() => !ro && setInserts(x.id)} />)}
          </div>
          <p className="text-[11px] text-gray-400 mt-1">Начало и концовку всегда ведёт ведущий. Вставка встаёт только туда, где к фразе нашёлся подходящий кадр. Чем больше вставок, тем дешевле ролик: фото оживляется только под ведущего.</p>
        </div>
        <div className="flex flex-wrap gap-6 text-sm">
          <label className="flex items-center gap-2"><input type="checkbox" checked={plates} disabled={ro} onChange={(e) => setPlates(e.target.checked)} /> Плашки с тезисами и цифрами</label>
          <label className="flex items-center gap-2"><input type="checkbox" checked={subs} disabled={ro} onChange={(e) => setSubs(e.target.checked)} /> Субтитры</label>
        </div>
        <div>
          <div className="text-sm font-medium mb-1.5">Фирменные цвета и логотип</div>
          <p className="text-[11px] text-gray-500 mb-2">Ими красятся плашки, акцентные слова в субтитрах и обложка.</p>
          <div className="flex flex-wrap items-center gap-4">
            <label className="flex items-center gap-2 text-sm"><input type="color" value={c1} disabled={ro} onChange={(e) => setC1(e.target.value)} /> акцент</label>
            <label className="flex items-center gap-2 text-sm"><input type="color" value={c2} disabled={ro} onChange={(e) => setC2(e.target.value)} /> текст</label>
            <label className={`flex items-center gap-2 text-sm ${ro ? "" : "cursor-pointer text-brand-700"}`}>
              {logo ? <img src={`/api/formats/asset?id=${logo}`} alt="" className="h-8 rounded bg-gray-100" /> : "＋ логотип (PNG)"}
              {!ro && <input type="file" accept="image/png" className="hidden" onChange={async (e) => {
                const file = e.target.files?.[0]; if (!file) return;
                try { const id = await upload("logo", file); onSave({ logo: id }); await onReload(); } catch (x: any) { setErr(x.message); }
              }} />}
            </label>
            <div className="ml-auto rounded-lg px-3 py-2 text-sm font-bold" style={{ background: c1, color: c2 }}>Пример плашки</div>
          </div>
        </div>
        <label className="block">
          <div className="text-sm font-medium">Концовка</div>
          <p className="text-[11px] text-gray-500 mb-1.5">Что ведущий говорит в конце и куда ведёт. Сначала можно звать подписаться, набралась аудитория — менять на призыв к продукту.</p>
          <textarea className="input" rows={2} value={ending} disabled={ro} onChange={(e) => setEnding(e.target.value)}
            placeholder="Подписывайся — каждый день разбираю одну историю. А разбор твоей ситуации — по ссылке в шапке профиля." />
        </label>
        {err && <p className="text-sm text-red-700">{err}</p>}
        {!ro && <button className="btn btn-primary" disabled={busy === "video"} onClick={submit}>{busy === "video" ? "Сохраняю…" : "Сохранить"}</button>}
      </div>
    </Section>
  );
}

// ── 5. Запуск ────────────────────────────────────────────────────────────────

function LaunchStep({ cfg, ro, host, busy, onSave, reloadHost, setErr, ready }: {
  cfg: any; ro: boolean; host: any; busy: string; onSave: (p: any) => void; reloadHost: () => Promise<void>;
  setErr: (s: string) => void; ready: boolean;
}) {
  const [per, setPer] = useState<number>(cfg.schedule?.perWeek || 5);
  const [times, setTimes] = useState<string[]>(cfg.schedule?.times || ["18:00"]);
  const [approval, setApproval] = useState<boolean>(Boolean(cfg.approval));
  const [topic, setTopic] = useState("");
  const [wait, setWait] = useState(false);
  const timer = useRef<any>(null);
  useEffect(() => () => clearInterval(timer.current), []);
  const trial = host?.trial;
  const running = trial && ["план", "выдан", "собирается", "на согласовании"].includes(trial.state);

  useEffect(() => {
    clearInterval(timer.current);
    if (running) timer.current = setInterval(reloadHost, 15000);
  }, [running]); // eslint-disable-line react-hooks/exhaustive-deps

  async function act(body: any) {
    setWait(true); setErr("");
    try { await hostApi(body); await reloadHost(); }
    catch (e: any) { setErr(e.message); }
    finally { setWait(false); }
  }

  return (
    <Section title="Запуск" sub="Расписание и пробный ролик. В расписание формат встаёт только после того, как вы утвердите пробу.">
      <div className="space-y-6">
        <div>
          <div className="text-sm font-medium mb-1.5">Выпусков в неделю</div>
          <div className="flex gap-1.5">
            {PER_WEEK.map((n) => (
              <button key={n} onClick={() => !ro && setPer(n)}
                className={`w-14 py-2 rounded-xl border text-sm font-medium ${per === n ? "bg-brand-600 border-brand-600 text-white" : "hover:border-gray-400"}`}>{n}</button>
            ))}
          </div>
        </div>
        <div>
          <div className="text-sm font-medium mb-1.5">Время выхода <span className="text-gray-400 font-normal">· по Москве</span></div>
          <div className="flex flex-wrap gap-1.5">
            {TIMES.map((t) => {
              const on = times.includes(t);
              return <button key={t} onClick={() => !ro && setTimes(on ? times.filter((x) => x !== t) : [...times, t].sort())}
                className={`px-3 py-1.5 rounded-xl border text-sm tabular-nums ${on ? "bg-brand-600 border-brand-600 text-white" : "hover:border-gray-400"}`}>{t}</button>;
            })}
          </div>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={approval} disabled={ro} onChange={(e) => setApproval(e.target.checked)} />
          Присылать текст на согласование перед сборкой
        </label>
        {!ro && <button className="btn btn-secondary" disabled={busy === "schedule" || !times.length}
          onClick={() => onSave({ schedule: { perWeek: per, times }, approval })}>{busy === "schedule" ? "Сохраняю…" : "Сохранить расписание"}</button>}
        <p className="text-[11px] text-gray-400">Куда выкладывать — соцсети проекта из блока «Аккаунты» в Контент-заводе.</p>

        <div className="border-t pt-5">
          <div className="text-sm font-medium">Пробный ролик</div>
          <p className="text-xs text-gray-500 mb-3">Полная сборка по вашим настройкам. В соцсети не выкладывается — придёт сюда.</p>
          {!ready && <p className="text-sm text-amber-800 bg-amber-50 rounded-lg px-3 py-2">Для пробы нужны фото ведущего и проверенный голос.</p>}
          {ready && !running && !ro && (
            <div className="flex flex-wrap gap-2">
              <input className="input flex-1 min-w-[16rem]" value={topic} onChange={(e) => setTopic(e.target.value)}
                placeholder="Тема или ссылка на видео — пусто: тема по анкете" />
              <button className="btn btn-primary" disabled={wait} onClick={() => act({ action: "trial", topic })}>Сделать пробный ролик</button>
            </div>
          )}
          {trial && (
            <div className="mt-4 rounded-xl border px-3 py-3 text-sm">
              <div>Проба: <b>{trial.state}</b>{trial.topic ? ` · ${trial.topic}` : ""}</div>
              {running && <p className="text-gray-500 mt-1">Собирается, обычно 10–20 минут. Страница обновится сама.</p>}
              {trial.state === "ошибка" && <p className="text-red-700 mt-1">{trial.error}</p>}
              {host?.video && (
                <div className="mt-3 grid sm:grid-cols-[14rem_minmax(0,1fr)] gap-4 items-start">
                  <video src={host.video} controls className="w-full rounded-xl bg-black aspect-[9/16]" />
                  <div className="space-y-2">
                    {host.status === "live" ? (
                      <>
                        <p className="text-green-800">✓ Утверждено — Ведущий выходит по расписанию.</p>
                        {!ro && <button className="text-xs text-gray-500 hover:text-red-700" onClick={() => act({ action: "pause" })}>Снять с расписания</button>}
                      </>
                    ) : !ro && (
                      <>
                        <button className="btn btn-primary" disabled={wait} onClick={() => act({ action: "approve" })}>✓ Утвердить и запустить</button>
                        <p className="text-xs text-gray-500">Не то? Поправьте нужный шаг слева и сделайте пробу ещё раз.</p>
                      </>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </Section>
  );
}
