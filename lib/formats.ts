// Настройки формата, которыми владеет Постос: выдача в бот, согласование
// текста и выключенные доноры нарезок.
//
// Раньше это жило на стороне заводов и было невидимо: «сам или вручную»
// определял brand.json завода, согласование — тот же файл, а выключить донора
// можно было только выключив все его маршруты. Пульт должен показывать и
// менять это сам, иначе он показывает не то, что происходит.
//
// Хранится одной строкой на бренд, чтобы не заводить таблицу под три поля:
// Setting `factory:formats:<бренд>` = {kind: {bot, approval, off}}.
import { prisma } from "@/lib/prisma";
import { DEFAULT_BRAND } from "@/lib/factory";
import { MONEYBALL } from "@/lib/moneyball";

export type FormatSetting = { bot: boolean; approval: boolean; off: boolean };

/**
 * Значения по умолчанию — это то, как заводы работают сегодня.
 *
 * У СуперФита согласование стоит там, где нет автопубликации: Персонаж,
 * Карусель и Карусель Новая выходят сами, ИИ-аватар и Тренеры ждут кнопки.
 * У MoneyBall согласования нет вовсе: ролик сразу уходит в бот.
 */
const APPROVAL: Record<string, string[]> = {
  [DEFAULT_BRAND]: ["avatar", "trainer:female", "trainer:male"],
  [MONEYBALL]: [],
};

const KEY = (brand: string) => `factory:formats:${brand}`;

export function defaultsOf(brand: string, kind: string): FormatSetting {
  return { bot: true, approval: (APPROVAL[brand] || []).includes(kind), off: false };
}

export async function formatsOf(brand: string): Promise<Record<string, Partial<FormatSetting>>> {
  const row = await prisma.setting.findUnique({ where: { key: KEY(brand) } });
  try {
    return row ? JSON.parse(row.value) : {};
  } catch {
    return {}; // битая запись не должна ломать пульт
  }
}

export async function formatOf(brand: string, kind: string): Promise<FormatSetting> {
  const saved = (await formatsOf(brand))[kind] || {};
  return { ...defaultsOf(brand, kind), ...saved };
}

export async function setFormat(brand: string, kind: string, patch: Partial<FormatSetting>) {
  const all = await formatsOf(brand);
  const next = { ...defaultsOf(brand, kind), ...(all[kind] || {}), ...patch };
  all[kind] = next;
  const value = JSON.stringify(all);
  await prisma.setting.upsert({
    where: { key: KEY(brand) },
    create: { key: KEY(brand), value },
    update: { value },
  });
  return next;
}

/** Выдача в бот у всего завода: общий рубильник над тумблерами форматов. */
export async function brandBot(brand: string) {
  const row = await prisma.setting.findUnique({ where: { key: `factory:bot:${brand}` } });
  return row?.value !== "off";
}

export async function setBrandBot(brand: string, on: boolean) {
  const value = on ? "on" : "off";
  await prisma.setting.upsert({
    where: { key: `factory:bot:${brand}` },
    create: { key: `factory:bot:${brand}`, value },
    update: { value },
  });
}
