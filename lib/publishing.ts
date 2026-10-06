import { prisma } from "@/lib/prisma";
import { SUSPICIOUS_AFTER } from "@/lib/insta";
import { platformFor, routeMap } from "@/lib/routes";

// Почему аккаунт сейчас не публикуется.
//
// Вопрос выглядит простым, но ответ собирается из четырёх разных мест:
// архив, ответ площадки при последнем сборе, рубильник площадки целиком и
// рубильники по типам. Раньше на него не отвечал никто — в карточке просто
// не было значка, а человек шёл искать причину по разделам. Поэтому здесь
// же указываем ИСТОЧНИК: куда идти чинить.
export type Reason = { title: string; body: string; source: string } | null;

export type PublishState = {
  publishes: boolean;
  reason: Reason;
  suspicious: boolean;
};

export async function publishStates(
  accounts: { username: string; archivedAt?: Date | null; archiveNote?: string; note?: string; lastError?: string; failCount?: number; lastErrorAt?: Date | null }[]
): Promise<Record<string, PublishState>> {
  const flags = await routeMap();
  const flagRows = await prisma.routeFlag.findMany();
  const when = (platform: string, kind: string) => {
    const r = flagRows.find((x) => x.platform === platform && x.kind === kind);
    return r ? new Date(r.at).toLocaleDateString("ru-RU", { day: "numeric", month: "long" }) : "";
  };

  // Соцсети из блока «Аккаунты» (каналы пульта). Матрица маршрутов знает
  // только площадки СуперФита, и всё остальное — Instagram MoneyBall,
  // подключённый в upload-post и включённый на автопубликацию, — называлось
  // «не заводским». Канал отвечает на тот же вопрос сам: открыт ли выход и кто
  // выкладывает.
  const norm = (x: string) => String(x || "").toLowerCase().replace(/^@/, "").replace(/\s+/g, "");
  const channels = await prisma.channel.findMany({ where: { archived: false } });
  const channelOf = (u: string) => channels.find((c) => c.account && norm(c.account) === norm(u));

  const out: Record<string, PublishState> = {};
  for (const a of accounts) {
    const platform = platformFor(a.username);
    const fails = a.failCount || 0;
    const suspicious = !a.archivedAt && fails >= SUSPICIOUS_AFTER;

    if (a.archivedAt) {
      out[a.username] = {
        publishes: false,
        suspicious: false,
        reason: {
          title: "Аккаунт в архиве",
          body: `${a.archiveNote || "убран вручную"}. Цифры сохранены, публикация и сбор выключены.`,
          source: "Постос · архив",
        },
      };
      continue;
    }

    const ch = !platform ? channelOf(a.username) : undefined;
    if (ch && !suspicious) {
      out[a.username] = ch.paused
        ? { publishes: false, suspicious: false, reason: {
            title: "Выход закрыт",
            body: "В блоке «Аккаунты» выключено «Выпускаем сюда»: ролики в эту соцсеть не идут.",
            source: "Постос · Контент-завод → Аккаунты" } }
        : ch.mode === "manual"
          ? { publishes: false, suspicious: false, reason: {
              title: "Выкладываете вы",
              body: "Автопубликация выключена: готовый ролик приходит в бот, в соцсеть его выкладывает человек.",
              source: "Постос · Контент-завод → Аккаунты" } }
          : { publishes: true, suspicious: false, reason: null };
      continue;
    }

    if (!platform) {
      out[a.username] = {
        publishes: false,
        suspicious,
        reason: {
          title: "Аккаунт не заводской",
          body: "Он не привязан к площадке завода, сюда публикуют руками. Статистика собирается, публикация не предполагается.",
          source: "Постос · lib/routes.ts",
        },
      };
      continue;
    }

    if (suspicious) {
      out[a.username] = {
        publishes: false,
        suspicious: true,
        reason: {
          title: a.note
            ? `Под вопросом: ${a.note}`
            : `Площадка не отвечает ${fails} сбора подряд`,
          body: a.lastError
            ? `Не читается ${fails} сбора подряд. Последний ответ: ${a.lastError.slice(0, 160)}`
            : `Не читается ${fails} сбора подряд, ответ площадки не записан.`,
          source: a.note ? "Заметка · поставлена вручную" : "Мета · Graph API",
        },
      };
      continue;
    }

    if (!flags[`${platform}|*`]) {
      const d = when(platform, "*");
      out[a.username] = {
        publishes: false,
        suspicious: false,
        reason: {
          title: "Площадка выключена целиком",
          body: `Рубильник «${platform} → всё» снят${d ? ` ${d}` : ""}. Завод сюда не постит, пока его не вернут.`,
          source: "Постос · Маршруты публикации",
        },
      };
      continue;
    }

    const kinds = Object.entries(flags).filter(([k]) => k.startsWith(`${platform}|`) && !k.endsWith("|*"));
    const on = kinds.filter(([, v]) => v);
    if (!on.length) {
      out[a.username] = {
        publishes: false,
        suspicious: false,
        reason: {
          title: "Ни один тип не включён",
          body: "Площадка разрешена, но все типы контента на ней выключены — выпускать нечего.",
          source: "Постос · Маршруты публикации",
        },
      };
      continue;
    }

    out[a.username] = { publishes: true, suspicious: false, reason: null };
  }
  return out;
}
