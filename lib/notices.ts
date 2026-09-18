import { prisma } from "@/lib/prisma";

// ── Уведомления: журнал того, что требует внимания ─────────────────────────
//
// Зачем отдельный слой. Постос уже умеет писать людям в Телеграм
// (lib/telegram.ts), но пуш живёт секунду: улетел — и всё. Разбираться же
// приходится через неделю, когда выясняется, что завод молчит десятый день, а
// кошелёк кончился ещё раньше. Телеграм остаётся доставкой; память — здесь.
//
// Два правила, без которых журнал превращается в мусорку и его перестают
// открывать:
//
//   ДЕДУПЛИКАЦИЯ. Одна беда — одна строка, опознаётся ключом. Заказ падал
//   четыре дня подряд — это «4 раза» в одной строке, а не четыре записи.
//
//   ГАШЕНИЕ. Уведомление закрывает проверяльщик, а не человек: кошелёк
//   пополнили — строка ушла сама. Руками закрывают только разовые события,
//   которые сами себя проверить не могут (отказ площадки в публикации).

export type Level = "crit" | "warn" | "info";

/**
 * Число со склонением: 1 задача, 3 задачи, 15 задач.
 *
 * Мелочь, но уведомление читают на бегу, и «3 просроченных задач» спотыкает
 * глаз ровно там, где нужно понять смысл за секунду.
 */
export function plural(n: number, one: string, few: string, many: string) {
  const m100 = n % 100;
  const m10 = n % 10;
  if (m100 >= 11 && m100 <= 14) return `${n} ${many}`;
  if (m10 === 1) return `${n} ${one}`;
  if (m10 >= 2 && m10 <= 4) return `${n} ${few}`;
  return `${n} ${many}`;
}

export type RaiseInput = {
  key: string;
  kind: string;
  level?: Level;
  title: string;
  body?: string;
  href?: string;
  actionText?: string;
  brand?: string;
  roles?: string[];
  /**
   * Сколько РАЗ беда случилась. Не задан — счётчик не трогаем.
   *
   * Разница принципиальная. Проверки крутятся раз в двадцать минут, и если
   * считать их заходы, висящий сутки кошелёк покажет «72 раза» — это счёт
   * проверок, а не бед, и число начинает врать. Поэтому состояния (кошелёк
   * пуст, завод молчит) остаются с times=1, а счётчик ставят только события,
   * которые умеют себя пересчитать: падения заказов берут его из журнала.
   */
  times?: number;
};

/** Поднять уведомление или подтвердить уже поднятое. */
export async function raise(n: RaiseInput) {
  const open = await prisma.notice.findUnique({ where: { key: n.key } });
  const data = {
    kind: n.kind,
    level: n.level || "warn",
    title: n.title,
    body: n.body || "",
    href: n.href || "",
    actionText: n.actionText || "",
    brand: n.brand || "",
    roles: (n.roles || []).join(","),
    lastAt: new Date(),
  };

  // Повтор открытой беды не плодит строк — сдвигает время, а счётчик берёт
  // только у того, кто его посчитал.
  if (open && !open.resolvedAt) {
    return prisma.notice.update({
      where: { key: n.key },
      data: { ...data, ...(n.times != null ? { times: n.times } : {}) },
    });
  }

  // Беда вернулась после гашения — это новый случай, счётчик начинается
  // заново, но история первого появления не теряется.
  return prisma.notice.upsert({
    where: { key: n.key },
    create: { key: n.key, ...data, times: n.times ?? 1 },
    update: { ...data, times: n.times ?? 1, resolvedAt: null, pushedAt: null, snoozedUntil: null, firstAt: new Date() },
  });
}

/** Погасить: причина исчезла. */
export async function resolve(key: string) {
  await prisma.notice.updateMany({
    where: { key, resolvedAt: null },
    data: { resolvedAt: new Date() },
  });
}

/**
 * Погасить всё семейство, кроме перечисленных.
 *
 * Нужно там, где проверка знает полный список бед своего вида: кошельки на
 * исходе, аккаунты, которые не читаются. Кончился повод — строка уходит без
 * отдельной проверки на каждую.
 */
export async function resolveOthers(prefix: string, keepKeys: string[]) {
  await prisma.notice.updateMany({
    where: { key: { startsWith: prefix }, resolvedAt: null, NOT: { key: { in: keepKeys } } },
    data: { resolvedAt: new Date() },
  });
}

/** Открытые уведомления для человека: его роль и его направления. */
export async function listOpen(opts: { role: string; brands: string[] | null; userId: string }) {
  const rows = await prisma.notice.findMany({
    where: { resolvedAt: null, OR: [{ snoozedUntil: null }, { snoozedUntil: { lt: new Date() } }] },
    orderBy: [{ lastAt: "desc" }],
    include: { reads: { where: { userId: opts.userId } } },
  });

  const rank: Record<string, number> = { crit: 0, warn: 1, info: 2 };
  return rows
    .filter((r) => !r.roles || r.roles.split(",").filter(Boolean).includes(opts.role) || r.roles === "")
    .filter((r) => !r.brand || !opts.brands || opts.brands.includes(r.brand))
    .map((r) => ({
      key: r.key,
      kind: r.kind,
      level: r.level,
      title: r.title,
      body: r.body,
      href: r.href,
      actionText: r.actionText,
      times: r.times,
      firstAt: r.firstAt.toISOString(),
      lastAt: r.lastAt.toISOString(),
      read: r.reads.length > 0 && r.reads[0].at >= r.lastAt,
    }))
    .sort((a, b) => (rank[a.level] ?? 3) - (rank[b.level] ?? 3) || b.lastAt.localeCompare(a.lastAt));
}

/**
 * Отложить: беда настоящая, но ею занимаются.
 *
 * Не «прочитано» и не «погашено». Прочитанное остаётся на виду, погашенное
 * значит «причина исчезла» — а тут причина на месте, просто напоминать о ней
 * каждый день незачем. Вернётся сама, когда срок выйдет.
 */
export async function snooze(key: string, days: number) {
  const until = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
  await prisma.notice.updateMany({ where: { key }, data: { snoozedUntil: until } });
  return until;
}

/** Отметить прочитанным. Прочтение у каждого своё. */
export async function markRead(userId: string, keys: string[]) {
  for (const noticeKey of keys) {
    await prisma.noticeRead.upsert({
      where: { noticeKey_userId: { noticeKey, userId } },
      create: { noticeKey, userId, at: new Date() },
      update: { at: new Date() },
    }).catch(() => {
      // Уведомление могли погасить и удалить между чтением и отметкой —
      // это не повод ронять запрос.
    });
  }
}
