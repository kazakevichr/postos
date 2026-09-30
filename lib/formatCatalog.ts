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

export const CATALOG: CatalogFormat[] = [
  {
    kind: "avatar", name: "ИИ-аватар", easy: true, media: "video", video: "/formats/avatar.mp4",
    line: "Говорящее лицо рассказывает тему дня.", runsAt: "СуперФит",
    how: ["Берёт тему из контент-плана или источника", "Пишет текст под тон проекта", "Озвучивает выбранным голосом", "Оживляет фото лица — губы в такт", "Накладывает плашки, титры и врезки"],
    need: [
      { icon: "📷", title: "Фото лица", text: "два кадра: средний и крупный план. Своё лицо или готовый персонаж" },
      { icon: "🎙", title: "Голос", text: "из библиотеки или клон по записи" },
      { icon: "✍", title: "Анкета проекта", text: "о чём, для кого, каким тоном — общая для всех форматов" },
    ],
    steps: ["brief", "source", "face", "voice", "schedule"],
  },
  {
    kind: "make", name: "Персонаж", media: "video", video: "/formats/make.mp4",
    line: "Нарисованный герой в позах объясняет тему.", runsAt: "СуперФит и MoneyBall",
    how: ["Пишет сценарий по сценам", "Под каждую сцену выбирает позу героя", "Озвучивает и собирает ролик с титрами"],
    need: [
      { icon: "🎨", title: "Банк поз героя", text: "около 30 картинок одного персонажа — готовится вместе с нами" },
      { icon: "🎙", title: "Голос", text: "из библиотеки или свой" },
      { icon: "✍", title: "Анкета проекта", text: "общая для всех форматов" },
    ],
    warn: "Самая долгая подготовка: банк поз рисуется и отбирается руками. Зато ролик в четыре раза дешевле аватара.",
    steps: ["brief", "source", "voice", "schedule"],
  },
  {
    kind: "carousel", name: "Карусель", easy: true, media: "pics",
    pics: ["/formats/carousel_01.jpg", "/formats/carousel_02.jpg", "/formats/carousel_03.jpg"],
    line: "6–9 слайдов: советы, списки, разборы.", runsAt: "СуперФит",
    how: ["Раскладывает тему по слайдам", "Верстает в цветах проекта", "Последний слайд — призыв или «сохрани»"],
    need: [
      { icon: "🎨", title: "Логотип и два цвета", text: "всё остальное собирается само" },
      { icon: "✍", title: "Анкета проекта", text: "общая для всех форматов" },
    ],
    steps: ["brief", "source", "schedule"],
  },
  {
    kind: "carousel_new", name: "Карусель Новая", media: "pics",
    pics: ["/formats/carousel_new_01.jpg", "/formats/carousel_new_02.jpg", "/formats/carousel_new_03.jpg"],
    line: "Фотореалистичная героиня и крупный текст.", runsAt: "СуперФит",
    how: ["Пишет заголовки и пункты под тему", "Генерирует героиню в одном образе на всех слайдах", "Накладывает крупную типографику"],
    need: [
      { icon: "👤", title: "Образ героини", text: "описание или фото-референс, чтобы лицо было одним и тем же" },
      { icon: "✍", title: "Анкета проекта", text: "общая для всех форматов" },
    ],
    steps: ["brief", "source", "schedule"],
  },
  {
    kind: "news", name: "Новости", media: "video", video: "/formats/news.mp4",
    line: "Аватар комментирует свежий ролик из ленты.", runsAt: "MoneyBall",
    how: ["Находит свежий ролик у каналов-доноров", "Берёт событие, стирает чужие субтитры", "Аватар комментирует своими словами", "Свои титры и обложка"],
    need: [
      { icon: "📺", title: "Каналы-доноры", text: "откуда брать новости: 3–10 каналов вашей темы" },
      { icon: "📷", title: "Фото лица", text: "как у ИИ-аватара" },
      { icon: "🎙", title: "Голос", text: "из библиотеки или свой" },
    ],
    steps: ["brief", "source", "face", "voice", "schedule"],
  },
  {
    kind: "forecast", name: "Прогнозы", media: "video", video: "/formats/forecast.mp4",
    line: "Аватар разбирает события дня с цифрами.", runsAt: "MoneyBall",
    how: ["Забирает события дня и вероятности из источника данных", "Выбирает самые интересные", "Аватар разбирает каждое, на плашке — цифра"],
    need: [{ icon: "📊", title: "Источник цифр", text: "у MoneyBall это Оракл. Без своего источника формат не работает" }],
    warn: "Формат держится на источнике цифр. Для нового проекта подойдёт, только если у него есть свои данные.",
    blocked: "Нужен свой источник цифр, как Оракл у MoneyBall. Напишите, какие данные есть у проекта, — подключим.",
    steps: [],
  },
  {
    kind: "recap", name: "Итоги", media: "pics",
    pics: ["/formats/recap_01_1.jpg", "/formats/recap_02_2.jpg", "/formats/recap_07_3.jpg"],
    line: "Карусель: что из обещанного сбылось.", runsAt: "MoneyBall",
    how: ["Сверяет вчерашние Прогнозы с результатом", "Честно показывает и попадания, и промахи"],
    need: [{ icon: "🔗", title: "Прогнозы", text: "Итоги собираются только из них" }],
    blocked: "Работает только вместе с Прогнозами.",
    steps: [],
  },
  {
    kind: "trainer", name: "Тренер", media: "none",
    line: "Манекен показывает упражнения по плану.", runsAt: "СуперФит",
    how: ["Берёт план тренировки", "Манекен показывает каждое упражнение", "Подписи техники и повторов"],
    need: [{ icon: "🏋", title: "Каталог упражнений", text: "формат заточен под фитнес" }],
    warn: "Под фитнес. Примера сейчас нет: готовые ролики Тренера убираются после выдачи.",
    blocked: "Заточен под фитнес — для другой ниши нужен свой каталог упражнений.",
    steps: [],
  },
  {
    kind: "repost", name: "Нарезки", media: "video", video: "/formats/repost.mp4",
    line: "Ролики чужих каналов с переводом и озвучкой.", runsAt: "СуперФит",
    how: ["Следит за каналами-донорами", "Переводит и переозвучивает", "Уникализирует и выкладывает"],
    need: [{ icon: "📺", title: "Каналы-доноры", text: "чьи ролики переделывать" }],
    warn: "Риск страйков за авторские права: на Ютуб-канале СуперФита уже висит предупреждение. На Ютуб и ТикТок Нарезки не пускаем.",
    steps: ["source", "schedule"],
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
