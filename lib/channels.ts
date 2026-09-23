// Каналы: где бренд публикуется и кто выкладывает.
//
// Канал — это место («Instagram · основной», YouTube, TikTok), а аккаунт к
// нему привязан. Разделение нужно ради простой вещи: аккаунт блокируют. С
// маршрутами, ведущими на аккаунт, блокировка означала перенастройку всего;
// с каналом — замену одной строки, а маршруты и история остаются.
//
// Три состояния, и слова у них те же, что на экране:
//   авто    — выкладывает машина: завод (как сейчас у СуперФита) или Постос;
//   вручную — аккаунт не подключён, ролик приходит в бот, выкладывает человек;
//   пауза   — выход закрыт целиком, ни автопостинга, ни напоминаний.
import { prisma } from "@/lib/prisma";
import { DEFAULT_BRAND } from "@/lib/factory";
import { routeMap } from "@/lib/routes";

export type ChannelState = "auto" | "manual" | "pause";
export const STATE_WORD: Record<ChannelState, string> = {
  auto: "авто",
  manual: "вручную",
  pause: "пауза",
};

/**
 * Каналы СуперФита на первый раз.
 *
 * Берём их из матрицы маршрутов, которая и так описывает эти площадки, чтобы
 * не заводить второй список: разойдутся — и человек не поймёт, какой главный.
 * Сейчас публикует сам завод, поэтому mode = factory; когда публикация
 * переедет в Постос, здесь останется поменять одно слово.
 */
const SEED: Record<string, { key: string; title: string; net: string; account: string; mode: string; note: string }[]> = {
  [DEFAULT_BRAND]: [
    { key: "ig_main", title: "Instagram · основной", net: "IG", account: "super.fit24", mode: "factory", note: "публикует завод" },
    { key: "ig_woman", title: "Instagram · woman", net: "IG", account: "superfit24_woman", mode: "factory", note: "публикует завод" },
    { key: "ig_man", title: "Instagram · man", net: "IG", account: "superfit24_training", mode: "factory", note: "публикует завод" },
    { key: "youtube", title: "YouTube", net: "YT", account: "SuperFit", mode: "factory", note: "публикует завод" },
    { key: "tiktok", title: "TikTok", net: "TT", account: "superfit05", mode: "factory", note: "до аудита приложения ролик приходит во «Входящие» TikTok" },
  ],
};

/** Завести каналы бренда, если их ещё нет. Пустой список — это не ошибка:
 *  у MoneyBall площадок пока нет вовсе, и выдумывать их незачем. */
export async function ensureChannels(brand: string) {
  const seed = SEED[brand];
  if (!seed) return;
  const have = await prisma.channel.count({ where: { brand } });
  if (have) return;
  for (const c of seed) {
    await prisma.channel.create({ data: { brand, ...c } });
  }
}

export type ChannelView = {
  key: string; title: string; net: string; account: string;
  mode: string; paused: boolean; note: string; state: ChannelState; word: string;
};

/**
 * Каналы бренда с готовым состоянием.
 *
 * Пауза у СуперФита живёт в матрице маршрутов — оттуда её и берём: завод
 * спрашивает именно матрицу, и если бы пульт хранил паузу отдельно, экран
 * показывал бы одно, а завод делал другое.
 */
export async function channelsOf(brand: string): Promise<ChannelView[]> {
  await ensureChannels(brand);
  const rows = await prisma.channel.findMany({ where: { brand, archived: false }, orderBy: { key: "asc" } });
  const flags = brand === DEFAULT_BRAND ? await routeMap() : {};
  return rows.map((c) => {
    const paused = brand === DEFAULT_BRAND ? flags[`${c.key}|*`] === false : c.paused;
    const state: ChannelState = paused ? "pause" : c.mode === "manual" ? "manual" : "auto";
    return {
      key: c.key, title: c.title, net: c.net, account: c.account,
      mode: c.mode, paused, note: c.note, state, word: STATE_WORD[state],
    };
  });
}

/** Правка канала из пульта: аккаунт, кто выкладывает, заметка. */
export async function saveChannel(brand: string, key: string, patch: { account?: string; mode?: string; note?: string }) {
  if (patch.mode && !["factory", "postos", "manual"].includes(patch.mode)) {
    throw new Error("кто выкладывает: завод, Постос или вручную");
  }
  await ensureChannels(brand);
  const data: Record<string, string> = {};
  if (patch.account !== undefined) data.account = String(patch.account).trim().slice(0, 80);
  if (patch.mode !== undefined) data.mode = patch.mode;
  if (patch.note !== undefined) data.note = String(patch.note).trim().slice(0, 200);
  return prisma.channel.update({ where: { brand_key: { brand, key } }, data });
}
