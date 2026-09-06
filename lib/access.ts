import { cookies } from "next/headers";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { brandsOf } from "@/lib/brands";

// Кто что видит. Единственное место, где решается доступ к направлениям, —
// чтобы правило нельзя было случайно повторить по-разному в двадцати файлах.
//
// Две оси:
//   роль    — что человек делает: владелец, менеджер партнёров, СММ, партнёр;
//   доступ  — где он это делает: список направлений в ProjectAccess.
//
// ПУСТОЙ СПИСОК У ВЛАДЕЛЬЦА = ВСЕ НАПРАВЛЕНИЯ. Иначе, заводя новый проект,
// пришлось бы не забыть выдать себе доступ — а забудется обязательно.
//
// Выбранное направление живёт в куке: сервер рисует страницы, и контекст
// должен быть известен до рендера, а не после первого запроса из браузера.

export const PROJECT_COOKIE = "postos_project";
export const ALL = "all";

export type Level = "view" | "work" | "manage";

export type Access = {
  userId: string;
  name: string;
  role: string;
  isOwner: boolean;
  /** Направления, доступные человеку. У владельца — все активные. */
  projects: { id: string; name: string }[];
  /** Выбранное направление; null означает «все сразу». */
  projectId: string | null;
  /** Может ли менять данные выбранного направления. */
  canEdit: boolean;
  /** Показывать ли переключатель «Все направления». */
  canSeeAll: boolean;
  /**
   * Человеку не назначено ни одного направления. Тогда рамки не применяются
   * вовсе: система доступов с незаполненными данными не должна запирать
   * команду — так же, как новый признак не должен гасить работающий раздел.
   */
  unscoped: boolean;
};

/** Уровень человека на конкретном направлении. */
function levelOf(rows: { projectId: string; level: string }[], isOwner: boolean, projectId: string | null): Level {
  if (isOwner) return "manage";
  if (!projectId) {
    // Сводный режим: право на правку только если оно есть везде.
    return rows.every((r) => r.level !== "view") ? "work" : "view";
  }
  const row = rows.find((r) => r.projectId === projectId);
  return (row?.level as Level) || "view";
}

/**
 * Доступ текущего пользователя. Возвращает null, если не авторизован —
 * страницы сами решают, куда отправлять.
 */
export async function currentAccess(): Promise<Access | null> {
  const session = await getServerSession(authOptions);
  if (!session) return null;

  const isOwner = session.user.role === "OWNER";
  const rows = isOwner
    ? []
    : await prisma.projectAccess.findMany({
        where: { userId: session.user.id },
        select: { projectId: true, level: true },
      });

  // Никому ничего не назначено — показываем всё, как до появления доступов.
  // Партнёра это послабление не касается: роль заведена ради ограничения, и
  // забытый доступ должен оставить его без данных, а не открыть ему всё.
  const unscoped =
    !isOwner && session.user.role !== "PARTNER" && rows.length === 0;

  const projects = await prisma.project.findMany({
    where:
      isOwner || unscoped
        ? { isActive: true }
        : { isActive: true, id: { in: rows.map((r) => r.projectId) } },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });

  // «Все направления» есть у того, кому доступно больше одного.
  const canSeeAll = projects.length > 1;

  const picked = cookies().get(PROJECT_COOKIE)?.value || "";
  let projectId: string | null;
  if (picked === ALL) {
    projectId = canSeeAll ? null : projects[0]?.id ?? null;
  } else if (picked && projects.some((p) => p.id === picked)) {
    projectId = picked;
  } else {
    // Без выбора: владелец видит всё, остальные — своё единственное.
    projectId = canSeeAll ? null : projects[0]?.id ?? null;
  }

  const level = levelOf(rows, isOwner, projectId);

  return {
    userId: session.user.id,
    name: session.user.name || "",
    role: session.user.role,
    isOwner,
    projects,
    projectId,
    canEdit: level !== "view",
    canSeeAll,
    unscoped,
  };
}

/**
 * Условие Prisma по направлениям для таблиц с полем projectId.
 * Пусто — ограничений нет (владелец в сводном режиме).
 */
export function projectWhere(access: Access): { projectId?: string | { in: string[] } } {
  if (access.projectId) return { projectId: access.projectId };
  if (access.isOwner || access.unscoped) return {};
  return { projectId: { in: access.projects.map((p) => p.id) } };
}

/** Те же рамки, но для таблиц, связанных с направлением через партнёра. */
export function partnerProjectWhere(access: Access) {
  const w = projectWhere(access);
  return w.projectId ? { partner: { projectId: w.projectId } } : {};
}

/** Список направлений, которые человеку можно показывать. */
export function allowedProjectIds(access: Access): string[] {
  return access.projectId ? [access.projectId] : access.projects.map((p) => p.id);
}

/**
 * Рамки для задач. Задача принадлежит направлению через партнёра; задача без
 * партнёра — через того, на кого назначена. Иначе норма СММ по СуперФиту
 * висела бы в списке Оракла и путала бы обоих.
 */
export function taskWhere(access: Access) {
  if (!access.projectId) {
    if (access.isOwner || access.unscoped) return {};
    const ids = access.projects.map((p) => p.id);
    return {
      OR: [
        { partner: { projectId: { in: ids } } },
        { partnerId: null, assignedTo: { access: { some: { projectId: { in: ids } } } } },
      ],
    };
  }
  const projectId = access.projectId;
  return {
    OR: [
      { partner: { projectId } },
      { partnerId: null, assignedTo: { access: { some: { projectId } } } },
    ],
  };
}

/** Есть ли у человека доступ к конкретному направлению. */
export function mayTouchProject(access: Access, projectId: string): boolean {
  return access.isOwner || access.unscoped || access.projects.some((p) => p.id === projectId);
}

/**
 * Роли, которым открыт блок СММ.
 *
 * Партнёр смотрит соцсети своего направления — это его же цифры, и прятать
 * их не от кого. Запись ему закрыта не здесь, а в middleware: одно правило на
 * все ручки надёжнее, чем проверка, о которой забудут в следующей.
 */
export const SMM_ROLES = ["OWNER", "SMM", "PARTNER"];

export type SocialScope = {
  access: Access;
  /**
   * Бренды, дальше которых человеку смотреть нечего.
   * null — рамок нет: владелец в сводном режиме.
   */
  brands: string[] | null;
};

/**
 * Бренды выбранного направления, а в сводном режиме — всех доступных.
 * null — рамок нет: владелец смотрит всё сразу.
 */
export async function accessBrands(access: Access): Promise<string[] | null> {
  if (access.projectId) {
    const p = await prisma.project.findUnique({
      where: { id: access.projectId },
      select: { name: true, brandKeys: true },
    });
    // Направление без аккаунтов — пустые рамки, а не «показать всё».
    return p ? brandsOf(p) : [];
  }
  if (access.isOwner || access.unscoped) return null;
  const rows = await prisma.project.findMany({
    where: { isActive: true, id: { in: access.projects.map((p) => p.id) } },
    select: { name: true, brandKeys: true },
  });
  return [...new Set(rows.flatMap((p) => brandsOf(p)))];
}

/**
 * Рамки для ручек СММ: кто спрашивает и что ему видно.
 * null — спрашивать нечего, ручка отвечает 403.
 *
 * Рамки считает сервер, а не клиент. Раньше нейро-аналитика получала список
 * брендов параметром запроса — то есть срез направления держался на честном
 * слове браузера и снимался подменой адреса.
 */
export async function socialScope(): Promise<SocialScope | null> {
  const access = await currentAccess();
  if (!access || !SMM_ROLES.includes(access.role)) return null;
  return { access, brands: await accessBrands(access) };
}

/** Оставить из списка только то, что попадает в рамки направления. */
export function inScope<T extends { brand: string }>(rows: T[], brands: string[] | null): T[] {
  return brands ? rows.filter((r) => brands.includes(r.brand)) : rows;
}
