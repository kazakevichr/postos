import { prisma } from "@/lib/prisma";

// Каталог форматов: что умеют заводы, как это выглядит и что нужно от проекта.
//
// Примеры — настоящие ролики и карусели СуперФита и MoneyBall (public/formats).
// Цена и время не вписаны руками, а считаются по журналу заводов: витрина с
// выдуманными цифрами хуже, чем без цифр.

export type Need = { icon: string; title: string; text: string };
export type CatalogFormat = {
  kind: string;
  name: string;
  line: string;
  media: "video" | "pics" | "none";
  video?: string;
  pics?: string[];
  runsAt: string;
  how: string[];
  need: Need[];
  warn?: string;
  steps: string[]; // шаги настройки у проекта
  blocked?: string; // почему формат нельзя добавить новому проекту
  easy?: boolean;
};

// Четыре шаблонных формата (решение Романа 14.10.2026): Ведущий — живой
// человек с фото, Персонаж — рисованный герой, Карусель — по референсам
// пользователя, Нарезки — ролики доноров. Прежние девять форматов СуперФита и
// MoneyBall ложатся в эти четыре; Тренер и Прогнозы — штучные, вне шаблонов.
export const CATALOG: CatalogFormat[] = [
  {
    kind: "host", name: "Ведущий", easy: true, media: "video", video: "/formats/avatar.mp4",
    line: "Человек с вашего фото рассказывает тему, вставки — по смыслу.", runsAt: "СуперФит и MoneyBall",
    how: [
      "Берёт тему из контент-плана или ссылку на видео и новость",
      "Пишет текст под тон проекта и угол подачи",
      "Озвучивает выбранным голосом",
      "Раскладывает ролик: где ведущий, где вставка из интернета или из видео",
      "Оживляет фото только там, где ведущий в кадре",
      "Субтитры, плашки, обложка, концовка с вашим призывом",
    ],
    need: [
      { icon: "📷", title: "Фото ведущего", text: "одно, лицо анфас, от 1080 пикселей" },
      { icon: "🎙", title: "Голос", text: "ссылка или ID голоса из библиотеки ElevenLabs" },
      { icon: "✍", title: "Анкета проекта", text: "о чём, для кого, каким тоном — общая для всех форматов" },
    ],
    steps: ["photo", "voice", "material", "video", "schedule"],
  },
  {
    kind: "carousel", name: "Карусель", media: "pics",
    pics: ["/formats/carousel_new_01.jpg", "/formats/carousel_new_02.jpg", "/formats/carousel_new_03.jpg"],
    line: "Слайды в стиле ваших референсов.", runsAt: "СуперФит и MoneyBall",
    how: ["Разбирает ваши образцы: герой, раскладка текста, цвета", "Пишет текст слайдов под тему", "Рисует карусель в этом стиле"],
    need: [{ icon: "🖼", title: "Референсы", text: "3–8 картинок, как должна выглядеть карусель" }],
    blocked: "В разработке: следующий после Ведущего.",
    steps: [],
  },
  {
    kind: "character", name: "Персонаж", media: "video", video: "/formats/make.mp4",
    line: "Рисованный герой в позах объясняет тему.", runsAt: "СуперФит и MoneyBall",
    how: ["Пишет сценарий по сценам", "Под каждую сцену подбирает позу героя", "Анимации, вставки, титры"],
    need: [{ icon: "🎨", title: "Герой", text: "эталонный рисунок — банк поз генерируем мы" }],
    blocked: "В разработке.",
    steps: [],
  },
  {
    kind: "cuts", name: "Нарезки", media: "video", video: "/formats/repost.mp4",
    line: "Ролики доноров, уникализированные под проект.", runsAt: "СуперФит",
    how: ["Следит за каналами-донорами", "Переводит и переозвучивает", "Уникализирует и выкладывает"],
    need: [{ icon: "📺", title: "Каналы-доноры", text: "3–10 каналов вашей темы" }],
    warn: "Риск страйков за авторские права: на YouTube и TikTok Нарезки не выпускаем.",
    blocked: "В разработке.",
    steps: [],
  },
];

/** Средняя цена и время заказа по журналу заводов — живые цифры для витрины. */
export async function catalogStats(): Promise<Record<string, { cost: number | null; minutes: number | null; made: number }>> {
  const rows = await prisma.factoryJob.findMany({ select: { kind: true, cost: true, seconds: true } });
  const acc: Record<string, { c: number[]; s: number[]; n: number }> = {};
  for (const r of rows) {
    const k = r.kind.split(":")[0];
    const a = (acc[k] ||= { c: [], s: [], n: 0 });
    a.n++;
    if (r.cost > 0) a.c.push(r.cost);
    if (r.seconds > 0) a.s.push(r.seconds);
  }
  const avg = (x: number[]) => (x.length ? x.reduce((a, b) => a + b, 0) / x.length : null);
  const out: Record<string, { cost: number | null; minutes: number | null; made: number }> = {};
  for (const [k, a] of Object.entries(acc)) {
    const s = avg(a.s);
    out[k] = { cost: avg(a.c), minutes: s === null ? null : Math.max(1, Math.round(s / 60)), made: a.n };
  }
  return out;
}
