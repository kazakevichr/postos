"use client";

// Контент-завод: план тем (месячная сетка, редактируется на месте, генерация
// тем LLM) и статистика производства из журнала событий завода.
import { useEffect, useMemo, useState } from "react";
import QuotaBoard from "@/components/QuotaBoard";
import FactoryPanel from "@/components/FactoryPanel";

const fmt = (n: any) => (n == null ? "—" : Number(n).toLocaleString("ru-RU"));

// Подсказка: своя всплывашка, а не системный title — тот появляется
// с задержкой и на части браузеров просто не показывается.
function Hint({ text }: { text: string }) {
  return (
    <span className="relative inline-flex group align-middle ml-1">
      <span className="inline-flex items-center justify-center w-4 h-4 rounded-full border border-gray-300 text-[10px] text-gray-400 cursor-help select-none">
        ?
      </span>
      <span className="hidden group-hover:block absolute left-1/2 -translate-x-1/2 bottom-full mb-1.5 w-64 z-20 bg-gray-900 text-white text-xs leading-snug rounded-lg px-3 py-2 shadow-lg font-normal normal-case text-left">
        {text}
      </span>
    </span>
  );
}

const BRAND_NAMES: Record<string, string> = {
  superfit: "СуперФит", party: "Вечеринки", oracle: "Оракл", moneyball: "MoneyBall", other: "Прочее",
};

const EVENT_BADGE: Record<string, string> = {
  "опубликован": "bg-green-100 text-green-800",
  "готов": "bg-blue-100 text-blue-800",
  "создан": "bg-gray-100 text-gray-600",
  "не принят": "bg-yellow-100 text-yellow-800",
  "брак": "bg-red-100 text-red-800",
  "ошибка": "bg-red-100 text-red-800",
};

function monthShift(month: string, delta: number) {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export default function FactoryDashboard({
  canManage = true,
  projectName,
}: {
  canManage?: boolean;
  projectName?: string;
}) {
  const [tab, setTab] = useState<"plan" | "stats">("plan");
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
  const [plan, setPlan] = useState<any>(null);
  const [jobs, setJobs] = useState<any[]>([]);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [onlyDefects, setOnlyDefects] = useState(false);
  const [manual, setManual] = useState<any>(null);
  const [mBrand, setMBrand] = useState("all");
  const [days, setDays] = useState(30);

  // Чей это завод. Матрица маршрутов и генерация тем описывают производство
  // СуперФита — площадки, гайды, рационы; у второго завода свои площадки и
  // свои темы, и показывать ему чужие настройки нечестно.
  const isDefaultFactory = !plan || plan.brand === "superfit";

  async function loadPlan(m: string) {
    const r = await fetch(`/api/factory/plan-admin?month=${m}`);
    setPlan(await r.json());
  }
  async function loadJobs(d = days) {
    const r = await fetch(`/api/factory/jobs?days=${d}`);
    const j = await r.json();
    setJobs(j.jobs || []);
  }
  // Смена направления в переключателе перерисовывает страницу на сервере, но
  // данные здесь клиентские: без projectName в зависимостях под заголовком
  // «MoneyBall» оставались план и матрица СуперФита до ручной перезагрузки.
  useEffect(() => {
    loadPlan(month);
  }, [month, projectName]);
  // Период общий для заводской и ручной статистики — как в «Соц.Сетях».
  useEffect(() => {
    loadJobs(days);
    fetch(`/api/factory/manual?days=${days}`).then((r) => r.json()).then(setManual).catch(() => {});
  }, [days, projectName]);

  const cell = (date: string, slot: string) =>
    (plan?.plan || []).find((r: any) => r.date === date && r.slot === slot);

  async function saveCell(date: string, slot: string, topic: string) {
    const prev = cell(date, slot)?.topic || "";
    if (topic.trim() === prev.trim()) return;
    await fetch("/api/factory/plan-admin", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ date, slot, topic, facts: cell(date, slot)?.facts || "" }),
    });
    await loadPlan(month);
  }

  // Брак постфактум: пост уже вышел, Роман удалил его в Instagram руками и
  // помечает здесь — комментарий уедет заводу и подмешается в следующие выпуски.
  async function markDefect(jobId: string) {
    const comment = window.prompt("Что не так с этим выпуском? Комментарий уйдёт заводу:");
    if (comment == null) return;
    await fetch("/api/factory/defect", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ job_id: jobId, comment }),
    });
    await loadJobs();
  }

  async function generate() {
    setBusy(true);
    setNote("Генерирую темы на месяц…");
    try {
      const r = await fetch("/api/factory/plan-admin", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ month }),
      });
      const j = await r.json();
      setNote(j.error ? `Не вышло: ${j.error}` : `Сгенерировано тем: ${j.generated}${j.note ? ` (${j.note})` : ""}`);
      await loadPlan(month);
    } finally {
      setBusy(false);
    }
  }

  // Статистика производства: сколько сделано и опубликовано, где брак,
  // сколько стоило — по типам контента.
  const stats = useMemo(() => {
    const byKind: Record<string, any> = {};
    for (const j of jobs) {
      const k = j.kind || j.slot || "прочее";
      const s = (byKind[k] ||= { kind: k, total: 0, published: 0, rejected: 0, failed: 0, cost: 0 });
      s.total++;
      if (j.event === "опубликован") s.published++;
      if (j.event === "не принят" || j.event === "брак") s.rejected++;
      if (j.event === "ошибка") s.failed++;
      s.cost += j.cost || 0;
      if (j.seconds) { s.secSum = (s.secSum || 0) + j.seconds; s.secN = (s.secN || 0) + 1; }
    }
    return Object.values(byKind);
  }, [jobs]);
  const totalCost = jobs.reduce((s, j) => s + (j.cost || 0), 0);

  const today = new Date().toISOString().slice(0, 10);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold mb-1">Контент-завод</h1>
          <p className="text-sm text-gray-500">
            {projectName
              ? `План тем и статистика производства · ${projectName}`
              : "План тем и статистика производства"}
          </p>
        </div>
        <div className="flex flex-wrap gap-2 items-center">
          {tab === "stats" && (
            <div className="flex gap-1 bg-white border rounded-lg p-0.5 mr-1">
              {[7, 14, 30, 90].map((d) => (
                <button
                  key={d}
                  onClick={() => setDays(d)}
                  className={`px-2.5 py-1 rounded-md text-sm ${days === d ? "bg-brand-600 text-white" : "hover:bg-gray-50"}`}
                >
                  {d} дн
                </button>
              ))}
            </div>
          )}
          <button className={`px-3 py-1.5 rounded-lg text-sm ${tab === "plan" ? "bg-brand-600 text-white" : "bg-white border hover:bg-gray-50"}`} onClick={() => setTab("plan")}>
            Контент-план
          </button>
          <button className={`px-3 py-1.5 rounded-lg text-sm ${tab === "stats" ? "bg-brand-600 text-white" : "bg-white border hover:bg-gray-50"}`} onClick={() => setTab("stats")}>
            Статистика
          </button>
        </div>
      </div>
      {note && <p className="text-sm text-gray-500">{note}</p>}

      {/* Пульт завода: день, неделя, каналы и форматы. Привычная матрица
          осталась внутри него, под переключателем «Таблица», — она нужна,
          когда надо разом пройтись по всем клеткам. */}
      {tab === "plan" && <FactoryPanel canManage={canManage} />}

      {tab === "plan" && plan && (
        <div className="card overflow-x-auto">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <button className="btn" onClick={() => setMonth(monthShift(month, -1))}>←</button>
              <span className="font-semibold">
                {new Date(month + "-01").toLocaleDateString("ru-RU", { month: "long", year: "numeric" })}
              </span>
              <button className="btn" onClick={() => setMonth(monthShift(month, 1))}>→</button>
            </div>
            {/* Генерация есть у каждого завода со своим брифом: MoneyBall
                получает темы Персонажа по рубрикам недели, СуперФит — по
                своим гайдам. Форматы, которые берут тему сами (Новости,
                Прогнозы), ручка не трогает. */}
            {canManage && (
              <button className="btn btn-primary" onClick={generate} disabled={busy}>
                {busy ? "Генерирую…" : "✨ Сгенерировать темы на месяц"}
              </button>
            )}
          </div>
          {/* key по бренду: поля тем неуправляемые (defaultValue), а столбец make
              есть у двух заводов — без пересоздания в Персонаже MoneyBall
              осталась бы тема СуперФита. */}
          <table key={plan.brand} className="w-full text-sm border-collapse min-w-[900px]">
            <thead>
              <tr className="text-left text-gray-500">
                <th className="p-2 w-20">Дата</th>
                {(plan.slots || []).map((s: any) => (
                  <th key={s.slot} className="p-2">
                    {s.label} <span className="font-normal">{s.active ? `· ${s.time} МСК` : "· ❄️"}</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(plan.dates || []).map((date: string) => (
                <tr key={date} className={`border-t ${date === today ? "bg-blue-50/50" : ""} ${date < today ? "opacity-60" : ""}`}>
                  <td className="p-2 whitespace-nowrap text-gray-500">
                    {new Date(date + "T00:00:00").toLocaleDateString("ru-RU", { day: "numeric", weekday: "short" })}
                  </td>
                  {(plan.slots || []).map((s: any) => (
                    <td key={s.slot} className="p-1 align-top">
                      {/* Формат, который берёт тему сам (Новости, Прогнозы MoneyBall),
                          вписанную тему проигнорирует — поле только показывает,
                          что вышло. */}
                      <textarea
                        rows={2}
                        readOnly={!canManage || s.fromPlan === false}
                        defaultValue={cell(date, s.slot)?.topic || ""}
                        placeholder={s.fromPlan === false ? "тему берёт сам" : s.active ? "тема…" : "заморожен"}
                        title={cell(date, s.slot)?.facts || ""}
                        onBlur={(e) => canManage && saveCell(date, s.slot, e.target.value)}
                        className={`w-full text-xs border rounded-md p-1.5 resize-none focus:outline-none focus:ring-1 focus:ring-brand-500 ${
                          s.active ? "bg-white" : "bg-gray-50"
                        }`}
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === "stats" && (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="card"><div className="text-sm text-gray-500">Заводских заказов за {days} дн<Hint text="Сколько единиц контента завод взял в работу за выбранный период. Один заказ — один ролик или карусель; считается по журналу завода, куда он пишет каждый этап производства." /></div><div className="text-2xl font-bold mt-1">{fmt(jobs.length)}</div></div>
            <div className="card"><div className="text-sm text-gray-500">Опубликовано<Hint text="Заказы, дошедшие до публикации: завод прислал событие «опубликован» со ссылкой на пост. Заказы в работе и забракованные сюда не входят." /></div><div className="text-2xl font-bold mt-1">{fmt(jobs.filter((j) => j.event === "опубликован").length)}</div></div>
            <div className="card"><div className="text-sm text-gray-500">Брак (не принят + ошибка)<Hint text="Сумма трёх исходов: «не принят» — ты забраковал до публикации, «брак» — забраковал уже вышедший пост, «ошибка» — производство упало само. Комментарий к браку уходит заводу и учитывается в следующих выпусках." /></div><div className="text-2xl font-bold mt-1">{fmt(jobs.filter((j) => ["не принят", "брак", "ошибка"].includes(j.event)).length)}</div></div>
            <div className="card"><div className="text-sm text-gray-500">Смета за {days} дн<Hint text="Сумма стоимости всех заказов за выбранный период: завод считает расход на нейросети по каждому ролику (озвучка, генерация, монтаж) и присылает вместе с событием «готов»." /></div><div className="text-2xl font-bold mt-1">{totalCost ? `$${totalCost.toFixed(2)}` : "—"}</div>
              {!totalCost && <div className="text-xs text-gray-400 mt-1">завод пока не сообщает стоимость</div>}</div>
          </div>

          {stats.length > 0 && (
            <div className="card overflow-x-auto">
              <h2 className="font-semibold mb-3">По типам контента<Hint text="Разрез заводских заказов за выбранный период по типу: make — Персонаж, carousel — Карусель, carousel_new — Карусель Новая (фотореализм), avatar — ИИ-аватар по запросу, trainer — тренерские клипы. Все эти типы производит завод; ручные публикации сюда не попадают." /></h2>
              <table className="w-full text-sm">
                <thead><tr className="text-left text-gray-500">
                  <th className="py-1 pr-4">Тип</th><th className="py-1 pr-4">Всего</th>
                  <th className="py-1 pr-4">Опубликовано</th><th className="py-1 pr-4">Не принято</th>
                  <th className="py-1 pr-4">Ошибки<Hint text="Производство упало с ошибкой — до публикации дело не дошло." /></th><th className="py-1 pr-4">Ср. время<Hint text="Среднее время производства одного ролика: от старта до готовности, по тем заказам, где завод прислал длительность." /></th><th className="py-1">Стоимость<Hint text="Суммарный расход на нейросети по этому типу за выбранный период." /></th>
                </tr></thead>
                <tbody>
                  {stats.map((s: any) => (
                    <tr key={s.kind} className="border-t">
                      <td className="py-1.5 pr-4 font-medium">{s.kind}</td>
                      <td className="py-1.5 pr-4">{s.total}</td>
                      <td className="py-1.5 pr-4 text-green-700">{s.published}</td>
                      <td className="py-1.5 pr-4 text-yellow-700">{s.rejected}</td>
                      <td className="py-1.5 pr-4 text-red-700">{s.failed}</td>
                      <td className="py-1.5 pr-4">{s.secN ? `${Math.round(s.secSum / s.secN / 60)} мин` : "—"}</td>
                      <td className="py-1.5">{s.cost ? `$${s.cost.toFixed(2)}` : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Норма СММ описана по СуперФиту: super.fit24 и Лео. Чужому заводу
              она не про него — как и кабинет, куда она ведёт. */}
          {isDefaultFactory && <QuotaBoard />}

          {manual && (
            <div className="card">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="font-semibold">✍️ Ручная публикация<Hint text="Посты, которых нет в журнале завода. Сверка идёт по ссылке на пост: завод присылает permalink каждой своей публикации, поэтому если пост в Instagram есть, а в журнале его нет — значит выложен руками. Работает даже когда ручной пост уходит в тот же аккаунт, где постит завод." /></h2>
                <span className="text-xs text-gray-400">посты без участия завода · {days} дн</span>
              </div>
              <p className="text-xs text-gray-400 mt-0.5 mb-3">
                Всё, чего нет в журнале завода: выложено из бота или прямо из Instagram.
              </p>
              <div className="flex flex-wrap gap-1 mb-4">
                {["all", ...new Set((manual.accounts || []).map((a: any) => a.brand))].map((b: any) => (
                  <button
                    key={b}
                    onClick={() => setMBrand(b)}
                    className={`px-2.5 py-1 rounded-lg text-xs ${mBrand === b ? "bg-brand-600 text-white" : "bg-white border hover:bg-gray-50"}`}
                  >
                    {b === "all" ? "Все проекты" : BRAND_NAMES[b] || b}
                  </button>
                ))}
              </div>
              {(() => {
                const rows = (manual.accounts || []).filter((a: any) => mBrand === "all" || a.brand === mBrand);
                const sum = (f: string) => rows.reduce((s: number, a: any) => s + (a[f] || 0), 0);
                return (
                  <>
                    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
                      <div><div className="text-sm text-gray-500">Постов руками<Hint text="Публикации в отслеживаемых аккаунтах за выбранный период, которых нет в журнале завода: выложены кнопкой в боте или прямо из приложения Instagram." /></div>
                        <div className="text-2xl font-bold mt-1">{fmt(sum("total"))}</div></div>
                      <div><div className="text-sm text-gray-500">Из них видео<Hint text="Сколько из ручных постов — рилсы и видео. Важно потому, что на YouTube и в TikTok зеркалируются только видео: карусели и фото туда не уходят." /></div>
                        <div className="text-2xl font-bold mt-1">{fmt(sum("video"))}</div></div>
                      <div><div className="text-sm text-gray-500">Уехало на Ютуб<Hint text="Сколько ручных видео уже перезалито на YouTube. Считается по отметкам зеркалирования — каждый уехавший ролик отмечается, чтобы не публиковать его дважды. Меньше числа видео потому, что зеркалирование берёт только свежие посты и упирается в суточный лимит загрузок YouTube." /></div>
                        <div className="text-2xl font-bold mt-1">{fmt(sum("youtube"))}</div></div>
                      <div><div className="text-sm text-gray-500">Уехало в ТикТок<Hint text="Сколько ручных видео уже отправлено в TikTok. До прохождения аудита приложения ролик приезжает во «Входящие» аккаунта и публикуется твоим нажатием — отметка ставится в момент отправки." /></div>
                        <div className="text-2xl font-bold mt-1">{fmt(sum("tiktok"))}</div></div>
                    </div>
                    {rows.length > 0 && (
                      <table className="w-full text-sm">
                        <thead><tr className="text-left text-gray-500">
                          <th className="py-1 pr-4">Аккаунт</th>
                          <th className="py-1 pr-4">Постов</th>
                          <th className="py-1 pr-4">Видео</th>
                          <th className="py-1 pr-4">На Ютубе<Hint text="Ручные видео этого аккаунта, уже уехавшие на YouTube-канал." /></th>
                          <th className="py-1">В ТикТоке<Hint text="Ручные видео этого аккаунта, отправленные в TikTok. Ноль там, где зеркалирование для аккаунта не настроено — маршруты на вкладке «Контент-план»." /></th>
                        </tr></thead>
                        <tbody>
                          {rows.map((a: any) => (
                            <tr key={a.account} className="border-t">
                              <td className="py-1.5 pr-4 font-medium">@{a.account}</td>
                              <td className="py-1.5 pr-4">{a.total}</td>
                              <td className="py-1.5 pr-4">{a.video}</td>
                              <td className="py-1.5 pr-4">{a.youtube}</td>
                              <td className="py-1.5">{a.tiktok}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </>
                );
              })()}
            </div>
          )}

          <div className="card">
            <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
              <h2 className="font-semibold">{onlyDefects ? "Журнал косяков" : "Журнал производства"}</h2>
              <button
                className={`btn text-sm ${onlyDefects ? "bg-red-600 text-white" : "border border-red-200 text-red-700 bg-red-50 hover:bg-red-100"}`}
                onClick={() => setOnlyDefects(!onlyDefects)}
              >
                {onlyDefects ? "← Все записи" : `⚠️ Журнал косяков (${jobs.filter((j) => ["не принят", "брак", "ошибка"].includes(j.event)).length})`}
              </button>
            </div>
            {!jobs.length && <p className="text-sm text-gray-500">Пока пусто — завод ещё не докладывал о заказах.</p>}
            {onlyDefects && !jobs.filter((j) => ["не принят", "брак", "ошибка"].includes(j.event)).length && jobs.length > 0 && (
              <p className="text-sm text-gray-500">Косяков нет — все заказы прошли чисто. 🎉</p>
            )}
            <div className="space-y-2">
              {(onlyDefects ? jobs.filter((j) => ["не принят", "брак", "ошибка"].includes(j.event)) : jobs).map((j) => (
                <details key={j.jobId} className="border rounded-lg p-2">
                  <summary className="flex flex-wrap items-center gap-2 cursor-pointer text-sm">
                    <span className={`px-2 py-0.5 rounded text-xs ${EVENT_BADGE[j.event] || "bg-gray-100 text-gray-600"}`}>{j.event || "?"}</span>
                    <span className="text-gray-400 text-xs" title={`у вас: ${new Date(j.at).toLocaleString("ru-RU")}`}>
                      {new Date(j.at).toLocaleString("ru-RU", { timeZone: "Europe/Moscow" })} МСК
                    </span>
                    <span className="text-gray-500 text-xs">
                      {j.kind || j.slot}{j.character ? ` · ${j.character}` : ""}{j.onDemand ? " · по запросу" : ""}
                      {j.seconds ? ` · ⏱ ${Math.round(j.seconds / 60)} мин` : ""}{j.cost ? ` · $${j.cost.toFixed(2)}` : ""}
                    </span>
                    <span className="font-medium truncate max-w-md">{j.topic || "(без темы)"}</span>
                    {(j.links || []).map((l: any, i: number) => (
                      <a key={i} href={l.link} target="_blank" className="text-brand-700 text-xs hover:underline" onClick={(e) => e.stopPropagation()}>
                        {l.account} ↗
                      </a>
                    ))}
                  </summary>
                  {j.script && <p className="text-xs text-gray-600 mt-2 whitespace-pre-wrap">{j.script}</p>}
                  {j.error && <p className="text-xs text-red-600 mt-1">{j.error}</p>}
                  {canManage && ["опубликован", "готов"].includes(j.event) && (
                    <button
                      className="mt-2 text-xs border border-red-300 text-red-700 rounded-md px-2 py-1 hover:bg-red-50"
                      onClick={(e) => { e.preventDefault(); markDefect(j.jobId); }}
                    >
                      🗑 Брак
                    </button>
                  )}
                </details>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
