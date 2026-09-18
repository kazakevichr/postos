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
  accounts: { username: string; archivedAt?: Date | null; archiveNote?: string; lastError?: string; failCount?: number; lastErrorAt?: Date | null }[]
): Promise<Record<string, PublishState>> {
  const flags = await routeMap();
  const flagRows = await prisma.routeFlag.findMany();
  const when = (platform: string, kind: string) => {
    const r = flagRows.find((x) => x.platform === platform && x.kind === kind);
    return r ? new Date(r.at).toLocaleDateString("ru-RU", { day: "numeric", month: "long" }) : "";
  };

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
          title: `Площадка не отвечает ${fails} сбора подряд`,
          body: a.lastError
            ? `Последний ответ: ${a.lastError.slice(0, 180)}`
            : "Ответ площадки не записан.",
          source: "Мета · Graph API",
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
