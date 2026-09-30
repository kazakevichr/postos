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
  fixed: boolean; // зашит в код завода — не переключается
};

const ENGINE: Record<string, Record<string, Omit<TopicWay, "fixed">>> = {
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
  brief: "По брифу",
  donor: "Доноры",
  search: "Поиск в интернете",
  kb: "База знаний",
  manual: "Вручную",
};

/** Как формат проекта берёт темы: сперва правда завода, потом настройка. */
export async function topicWay(brand: string, kind: string): Promise<TopicWay> {
  const eng = ENGINE[brand]?.[kind];
  if (eng) return { ...eng, fixed: true };
  const row = await prisma.topicSource.findUnique({ where: { brand_kind: { brand, kind } } });
  const type = row?.type || "brief";
  return {
    type,
    title: WAY_NAMES[type] || type,
    detail: type === "manual" ? "Темы вписываете сами в контент-плане. Пустые клетки завод не тронет."
      : type === "brief" ? "Идеи придумываются по анкете проекта."
      : "Завод берёт идею из источника и пишет своими словами.",
    fixed: false,
  };
}

export async function topicWays(brand: string, kinds: string[]): Promise<Record<string, TopicWay>> {
  const out: Record<string, TopicWay> = {};
  for (const k of kinds) out[k] = await topicWay(brand, k);
  return out;
}
