import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { currentAccess } from "@/lib/access";
import ProjectPicker from "@/components/ProjectPicker";
import SignOutButton from "@/components/SignOutButton";
import ProjectsNavDropdown from "@/components/ProjectsNavDropdown";
import SidebarShell from "@/components/SidebarShell";
import { listOpen } from "@/lib/notices";
import { accessBrands } from "@/lib/access";

const ROLE_LABEL: Record<string, string> = {
  OWNER: "владелец",
  MANAGER: "менеджер партнёров",
  SMM: "СММ",
  PARTNER: "партнёр",
};

export default async function Navbar() {
  const access = await currentAccess();
  if (!access) return null;
  const role = access.role;
  const isOwner = access.isOwner;

  // Канбан ходит по проектам, доступным человеку: у владельца это все
  // активные, у остальных — их направления.
  const projects =
    isOwner || ["MANAGER", "PARTNER"].includes(role)
      ? await prisma.project.findMany({
          where: {
            isActive: true,
            ...(access.projectId
              ? { id: access.projectId }
              : isOwner
                ? {}
                : { id: { in: access.projects.map((p) => p.id) } }),
          },
          orderBy: { name: "asc" },
          select: { id: true, name: true },
        })
      : [];

  const linkClass = "px-3 py-2 rounded-lg hover:bg-gray-50 hover:text-brand-700";

  // Уведомления — над всеми разделами и у всех ролей: их смысл в том, чтобы
  // попасться на глаза из любого места, а не лежать в своём углу.
  const open = await listOpen({
    role,
    brands: await accessBrands(access),
    userId: access.userId,
  }).catch(() => []);
  const unread = open.filter((n) => !n.read).length;
  const worst = open.some((n) => n.level === "crit");

  const noticesLink = (
    <Link key="/notices" href="/notices"
      className={`${linkClass} flex items-center justify-between gap-2 ${unread ? "text-gray-900 font-medium" : ""}`}>
      <span>🔔 Уведомления</span>
      {unread > 0 && (
        <span className={`text-[11px] font-semibold px-1.5 py-px rounded-full text-white ${worst ? "bg-red-600" : "bg-gray-400"}`}>
          {unread}
        </span>
      )}
    </Link>
  );

  const navLink = (href: string, label: string) => (
    <Link key={href} href={href} className={linkClass}>
      {label}
    </Link>
  );

  const groupTitle = (title: string) => (
    <div key={`g-${title}`} className="px-3 pt-4 pb-1 text-[11px] font-semibold uppercase tracking-wider text-gray-400 first:pt-0">
      {title}
    </div>
  );

  const kanbanDropdown = <ProjectsNavDropdown key="kanban" projects={projects} />;

  const partnerGroup = [
    groupTitle("Партнёрский менеджмент"),
    navLink("/tasks", "Задачи"),
    isOwner ? navLink("/partners", "Партнёры") : navLink("/my-partners", "Мои партнёры"),
    kanbanDropdown,
    // Раньше называлась "ИИ-помощник" — раздел "Проекты" нужен только менеджеру:
    // владельцу помощник уже встроен в страницу проекта.
    ...(isOwner ? [] : [navLink("/assistant", "🤖 Проекты")]),
    navLink("/lost", "Упущенные"),
  ];

  const smmGroup = [
    groupTitle("СММ"),
    navLink("/social", "Соц.Сети"),
    navLink("/analytics", "Нейро-аналитика"),
    navLink("/factory", "Контент-завод"),
    navLink("/cabinet", "Кабинет СММ"),
  ];

  const teamGroup = [
    groupTitle("Управление командой"),
    navLink("/", "Дашборд"),
    navLink("/settings/users", "Сотрудники"),
    navLink("/payroll", "Зарплата"),
    navLink("/economics", "Бухгалтерия"),
    navLink("/wallets", "Кошельки"),
    navLink("/settings/projects", "Настройка проекта"),
  ];

  // Партнёр видит своё направление целиком, но ничего в нём не меняет —
  // управление командой и настройки остаются у владельца.
  const partnerViewGroup = [
    groupTitle("Направление"),
    navLink("/", "Дашборд"),
    navLink("/economics", "Бухгалтерия"),
    navLink("/wallets", "Кошельки"),
    navLink("/payroll", "Зарплата"),
  ];

  // Владелец видит всё; партнёр — своё направление; менеджер партнёров —
  // партнёрский блок и свою зарплату; СММ — блок СММ.
  const items = isOwner
    ? [noticesLink, ...partnerGroup, ...smmGroup, ...teamGroup]
    : role === "PARTNER"
      ? [
          noticesLink,
          ...partnerViewGroup,
          groupTitle("Партнёрский менеджмент"),
          navLink("/partners", "Партнёры"),
          kanbanDropdown,
          navLink("/tasks", "Задачи"),
          // Блок СММ целиком: партнёр платит за производство контента по
          // своему направлению, значит и статистика, и разбор, и норма —
          // его цифры. Показывать одну витрину, а выводы прятать, значит
          // отдавать раздел, который выглядит сделанным и не работает.
          ...smmGroup,
        ]
      : role === "SMM"
        ? [noticesLink, ...smmGroup]
        : [noticesLink, ...partnerGroup, navLink("/payroll", "Зарплата")];

  return (
    <SidebarShell
      picker={
        access.projects.length > 0 ? (
          <ProjectPicker
            projects={access.projects}
            projectId={access.projectId}
            canSeeAll={access.canSeeAll}
          />
        ) : null
      }
      footer={
        <>
          <div>
            {access.name} ({ROLE_LABEL[role] || "сотрудник"})
          </div>
          {!access.canEdit && <div className="text-gray-400">режим просмотра</div>}
          <SignOutButton />
        </>
      }
    >
      {items}
    </SidebarShell>
  );
}
