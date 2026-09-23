// Каналы: где бренд публикуется и кто выкладывает.
//
// Канал — это место («Instagram · основной», YouTube, TikTok), а аккаунт к
// нему привязан. Разделение нужно ради простой вещи: аккаунт блокируют. С
// маршрутами, ведущими на аккаунт, блокировка означала перенастройку всего;
// с каналом — замену одной строки, а маршруты и история остаются.
//
// Три состояния, и слова у них те же, что на экране:
//   авто    — аккаунт подключён, выкладывает машина;
//   вручную — аккаунт не подключён, ролик приходит в бот, выкладывает человек;
//   пауза   — выход закрыт целиком, ни автопостинга, ни напоминаний.
//
// Выбирать состояние руками нельзя: «вручную» — это не решение, а следствие
// того, что аккаунт не подключён. Поэтому в пульте стоит один переключатель
// «аккаунт подключён», а слово состояния из него выводится.
//
// Канал уходит В АРХИВ, а не удаляется: аккаунт блокируют, на его место
// встаёт новый, а история и маршруты остаются на канале.
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
 * Аккаунты заведены подключёнными: сегодня завод в них действительно
 * публикует. Заблокировали — меняете аккаунт, и подключение спрашивается
 * заново.
 */
const SEED: Record<string, { key: string; title: string; net: string; account: string; mode: string; note: string }[]> = {
  [DEFAULT_BRAND]: [
    { key: "ig_main", title: "Instagram · основной", net: "IG", account: "super.fit24", mode: "factory", note: "" },
    { key: "ig_woman", title: "Instagram · woman", net: "IG", account: "superfit24_woman", mode: "factory", note: "" },
    { key: "ig_man", title: "Instagram · man", net: "IG", account: "superfit24_training", mode: "factory", note: "" },
    { key: "youtube", title: "YouTube", net: "YT", account: "SuperFit", mode: "factory", note: "" },
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

/** Правка канала: имя аккаунта, признак подключения, пауза, архив. */
export async function saveChannel(
  brand: string, key: string,
  patch: { account?: string; connected?: boolean; paused?: boolean; archived?: boolean },
) {
  await ensureChannels(brand);
  const data: Record<string, unknown> = {};
  if (patch.account !== undefined) {
    data.account = String(patch.account).trim().slice(0, 80);
    // Новый аккаунт — это всегда неподключённый аккаунт: пока его не завели
    // в Meta Business Suite или не выдали доступ, машина в него не выложит.
    // Честнее спросить подключение заново, чем оставить зелёную отметку от
    // прежнего, заблокированного.
    if (patch.connected === undefined) data.mode = "manual";
  }
  if (patch.connected !== undefined) data.mode = patch.connected ? "factory" : "manual";
  // Пауза СуперФита сюда не попадает: у него её хранит матрица маршрутов, и
  // пульт правит именно её.
  if (patch.paused !== undefined && brand !== DEFAULT_BRAND) data.paused = Boolean(patch.paused);
  if (patch.archived !== undefined) data.archived = Boolean(patch.archived);
  return prisma.channel.update({ where: { brand_key: { brand, key } }, data });
}

/** Новый канал: место публикации, которого у бренда ещё не было. */
export async function createChannel(brand: string, body: { title?: string; net?: string; account?: string }) {
  const title = String(body.title || "").trim().slice(0, 60);
  const net = String(body.net || "").trim().toUpperCase();
  if (!title) throw new Error("нужно название канала");
  if (!["IG", "YT", "TT", "TG"].includes(net)) throw new Error("площадка: IG, YT, TT или TG");
  // Ключ выводим из названия: он нужен только внутри, и пусть будет читаемым.
  const base = title.toLowerCase().replace(/[^a-zа-яё0-9]+/gi, "_").replace(/^_|_$/g, "") || net.toLowerCase();
  let key = base;
  for (let i = 2; await prisma.channel.findUnique({ where: { brand_key: { brand, key } } }); i++) key = `${base}_${i}`;
  return prisma.channel.create({
    data: { brand, key, title, net, account: String(body.account || "").trim().slice(0, 80), mode: "manual" },
  });
}

/** Архив: каналы, которыми больше не публикуем, но историю храним. */
export async function archivedOf(brand: string): Promise<ChannelView[]> {
  const rows = await prisma.channel.findMany({ where: { brand, archived: true }, orderBy: { key: "asc" } });
  return rows.map((c) => ({
    key: c.key, title: c.title, net: c.net, account: c.account,
    mode: c.mode, paused: true, note: c.note, state: "pause" as ChannelState, word: "в архиве",
  }));
}
