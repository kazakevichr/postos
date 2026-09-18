// Плановый сбор соцсетей. Кнопки «Собрать сейчас» больше нет — сервер сам
// обновляет данные: Инстаграм каждые 20 минут, Оракл (YouTube+TikTok) раз в
// час, чтобы не упереться в квоты YouTube API и rate-limit upload-post.
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  let lastOracle = 0;
  let lastMeta = 0;
  let lastRemindDay = "";

  const tick = async () => {
    try {
      const { runCollect } = await import("./lib/insta");
      const s = await runCollect();
      console.log(`[insta] сбор: аккаунтов ${s.accounts}` +
        (s.errors.length ? `, ошибки: ${s.errors.join("; ")}` : ""));
    } catch (e) {
      console.error("[insta] сбор упал:", e);
    }
    if (Date.now() - lastOracle >= 55 * 60 * 1000) {
      lastOracle = Date.now();
      try {
        // Через HTTP к самому себе, не импортом: lib/oracle читает файлы
        // токенов (node:fs), а instrumentation собирается и для edge.
        const r = await fetch(`http://127.0.0.1:${process.env.PORT || 3000}/api/oracle/collect`, {
          method: "POST",
          headers: { "x-factory-key": process.env.IG_HOST_KEY || "" },
        });
        const s = await r.json();
        console.log(`[oracle] сбор: каналов ${s.channels}` +
          (s.errors?.length ? `, ошибки: ${s.errors.join("; ")}` : ""));
      } catch (e) {
        console.error("[oracle] сбор упал:", e);
      }
    }
  };

  // Контроль задач: утром в 09:xx МСК напоминания исполнителям и сводка
  // просрочки владельцу. Через HTTP к самому себе — lib/telegram тянет
  // node:crypto и ломает edge-сборку при прямом импорте.
  const remind = async () => {
    const mskHour = Number(new Intl.DateTimeFormat("ru-RU", {
      timeZone: "Europe/Moscow", hour: "numeric", hour12: false,
    }).format(new Date()));
    const day = new Date().toISOString().slice(0, 10);
    if (mskHour !== 9 || lastRemindDay === day) return;
    lastRemindDay = day;
    try {
      const r = await fetch(`http://127.0.0.1:${process.env.PORT || 3000}/api/tasks/remind`, {
        method: "POST",
        headers: { "x-factory-key": process.env.IG_HOST_KEY || "" },
      });
      const s = await r.json();
      console.log(`[задачи] напоминаний: ${s.reminded}, просрочено: ${s.overdue}`);
    } catch (e) {
      console.error("[задачи] напоминания упали:", e);
    }
  };

  // Норма СММ: эндпоинт сам решает по красноярскому времени, что пора —
  // напомнить или закрыть день; повторы отсекает отметками в базе.
  const quota = async () => {
    try {
      await fetch(`http://127.0.0.1:${process.env.PORT || 3000}/api/factory/quota/check`, {
        method: "POST",
        headers: { "x-factory-key": process.env.IG_HOST_KEY || "" },
      });
    } catch (e) {
      console.error("[норма] проверка упала:", e);
    }
  };

  // Паспорт контента: разметка новых постов и заявки по кодовым словам.
  const meta = async () => {
    if (Date.now() - lastMeta < 55 * 60 * 1000) return;
    lastMeta = Date.now();
    try {
      const r = await fetch(`http://127.0.0.1:${process.env.PORT || 3000}/api/factory/meta/label`, {
        method: "POST",
        headers: { "x-factory-key": process.env.IG_HOST_KEY || "" },
      });
      const s = await r.json();
      console.log(`[паспорт] завод +${s.backfilled}, нейро ${s.labeled ?? 0}, заявки ${s.counted ?? 0}`);
    } catch (e) {
      console.error("[паспорт] разметка упала:", e);
    }
  };

  // Уведомления считаем ПОСЛЕ сбора: проверяльщики смотрят на свежие цифры,
  // иначе первое уведомление о молчащем заводе опоздает на цикл.
  const notices = async () => {
    try {
      // Через HTTP к самому себе по той же причине, что и Оракл: проверяльщики
      // тянут Телеграм, а тот — node:crypto, которого в edge-сборке нет.
      const r = await fetch(`http://127.0.0.1:${process.env.PORT || 3000}/api/notices/check`, {
        method: "POST",
        headers: { "x-factory-key": process.env.IG_HOST_KEY || "" },
      });
      const s = await r.json();
      if (s.pushed) console.log(`[уведомления] в Телеграм ушло: ${s.pushed}`);
    } catch (e) {
      console.error("[уведомления] проверки упали:", e);
    }
  };

  const tickAll = async () => { await tick(); await remind(); await quota(); await meta(); await notices(); };
  setInterval(tickAll, 20 * 60 * 1000);
  setTimeout(tickAll, 60 * 1000); // первый прогон через минуту после старта
}
