import { prisma } from "@/lib/prisma";
import { DEFAULT_BRAND } from "@/lib/factory";
import { MONEYBALL } from "@/lib/moneyball";

// Откуда формат берёт темы — ПРАВДА, а не настройка.
//
// У работающих заводов источник тем зашит в их код: Персонаж СуперФита берёт
// гайды из «Базы знаний», Карусель — свои рубрики питания, Новости MoneyBall —
// ролики доноров. Показывать там переключатель «откуда брать» было бы враньём:
// щёлкнешь «поиск», а завод продолжит брать гайды. Поэтому для них источник
// описан как есть и не переключается.
//
// Переключатель есть только у форматов нового завода: там источник и правда
// выбирается настройкой (TopicSource).
//
// Общее правило для всех, кто читает план: тема, вписанная в контент-план,
// важнее источника — завод берёт её и источник не трогает.

export type TopicWay = {
  type: string; // kb | rubrics | list | muscles | order | donor | oracle | forecast | search | brief | manual
  title: string;
  detail: string;
  fixed: boolean; // сейчас работает источник, зашитый в код завода
  engine: { title: string; detail: string } | null; // что умеет сам завод — вариант «как у завода»
  config: any;
  editable?: boolean; // можно ли сменить источник: формат берёт тему из плана
};

const ENGINE: Record<string, Record<string, { type: string; title: string; detail: string }>> = {
  [DEFAULT_BRAND]: {
    make: {
      type: "kb", title: "База знаний",
      detail: "Кусок из четырёх гайдов в папке завода — БАДы, тренировки новичка, гормоны, анализы. Модель превращает его в тему, факты берутся оттуда же.",
    },
    carousel: {
      type: "rubrics", title: "Рубрики питания",
      detail: "По кругу: меню на день, один рецепт, было → стало, подборка и другие. Блюдо не повторяется месяц.",
    },
    carousel_new: {
      type: "list", title: "Список тем бренда",
      detail: "Готовый женский список тем из настроек бренда: практики и привычки, без рационов.",
    },
    "trainer:female": {
      type: "muscles", title: "Группы мышц",
      detail: "Одна группа мышц за выпуск, четыре разных упражнения из справочника. У женского — свой список групп.",
    },
    "trainer:male": {
      type: "muscles", title: "Группы мышц",
      detail: "Одна группа мышц за выпуск, четыре разных упражнения из справочника.",
    },
    avatar: {
      type: "order", title: "По запросу",
      detail: "Тему задают, когда заказывают ролик в боте.",
    },
  },
  [MONEYBALL]: {
    news: {
      type: "donor", title: "Доноры",
      detail: "Свежий ролик с каналов-доноров: берём событие, аватар комментирует своими словами.",
    },
    forecast: {
      type: "oracle", title: "Матчи дня из Оракла",
      detail: "События дня и вероятности по модели — из Оракла. Без Оракла формат не работает.",
    },
    recap: {
      type: "forecast", title: "Вчерашние Прогнозы",
      detail: "Сверяет вчерашние прогнозы с результатами — и попадания, и промахи.",
    },
    make: {
      type: "search", title: "Рубрика дня и поиск",
      detail: "Рубрика задана днём недели, факты ищутся в интернете.",
    },
  },
};

export const WAY_NAMES: Record<string, string> = {
  brief: "По анкете",
  donor: "Доноры",
  search: "Поиск в интернете",
  kb: "База знаний",
  manual: "Вручную",
};

/**
 * Как формат проекта берёт темы.
 *
 * Настройка в Постосе важнее завода: если человек выбрал источник, Постос
 * сам заранее вписывает темы в план, а завод берёт тему из плана. Не выбрал
 * — у работающих заводов действует их собственный источник.
 */
export async function topicWay(brand: string, kind: string): Promise<TopicWay> {
  const eng = ENGINE[brand]?.[kind];
  const engine = eng ? { title: eng.title, detail: eng.detail } : null;
  const row = await prisma.topicSource.findUnique({ where: { brand_kind: { brand, kind } } });
  if (!row && eng) return { ...eng, fixed: true, engine, config: {} };
  const type = row?.type || "brief";
  let config: any = {};
  try { config = JSON.parse(row?.config || "{}"); } catch {}
  const DETAIL: Record<string, string> = {
    brief: "Постос придумывает идеи по анкете проекта и вписывает их в план заранее.",
    search: `Постос ищет свежие новости и факты${config.query ? ` по запросу «${config.query}»` : ""} и пишет тему своими словами.`,
    donor: `Постос смотрит свежие ролики ${(config.donors || []).length || ""} каналов-доноров, берёт идею и пишет своими словами.`.replace("  ", " "),
    kb: "Постос берёт кусок из файлов базы знаний проекта и делает из него тему.",
    manual: eng
      ? "Темы вписываете сами. Пустой день завод заполнит своим источником."
      : "Темы вписываете сами в контент-плане. Пустые дни завод не трогает.",
  };
  return { type, title: WAY_NAMES[type] || type, detail: DETAIL[type] || "", fixed: false, engine, config };
}

export async function topicWays(brand: string, kinds: string[]): Promise<Record<string, TopicWay>> {
  const out: Record<string, TopicWay> = {};
  for (const k of kinds) out[k] = await topicWay(brand, k);
  return out;
}
