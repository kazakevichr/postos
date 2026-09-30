import { NextResponse } from "next/server";
import { socialScope } from "@/lib/access";
import { accounts, addProfile, connectLink, upBrands } from "@/lib/uploadpost";

export const dynamic = "force-dynamic";

// Аккаунты публикации проектов: что подключено, завести новый, получить
// ссылку на подключение соцсетей. Видят и меняют только проекты в рамках
// направления человека — чужие аккаунты не отдаём и не заводим.

function allowed(brands: string[] | null) {
  const configured = upBrands();
  return brands ? configured.filter((b) => brands.includes(b)) : configured;
}

export async function GET() {
  const scope = await socialScope();
  if (!scope) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const out = [];
  for (const brand of allowed(scope.brands)) {
    try {
      out.push({ brand, ...(await accounts(brand)) });
    } catch (e: any) {
      // Один проект с битым ключом не должен прятать остальные.
      out.push({ brand, error: String(e?.message || e) });
    }
  }
  return NextResponse.json({ projects: out, canEdit: scope.access.canEdit });
}

export async function POST(req: Request) {
  const scope = await socialScope();
  if (!scope) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  if (!scope.access.canEdit) {
    return NextResponse.json({ error: "Только с правом изменения" }, { status: 403 });
  }
  const b = await req.json().catch(() => ({}));
  const brand = String(b.brand || "");
  if (!allowed(scope.brands).includes(brand)) {
    return NextResponse.json({ error: "проект вне ваших рамок или без ключа" }, { status: 403 });
  }
  try {
    if (b.action === "add") {
      return NextResponse.json({ ok: true, profile: await addProfile(brand, String(b.title || "")) });
    }
    if (b.action === "link") {
      const origin = new URL(req.url).origin;
      const url = await connectLink(brand, String(b.username || ""), `${origin}/social`);
      return NextResponse.json({ ok: true, url });
    }
    return NextResponse.json({ error: "action: add | link" }, { status: 400 });
  } catch (e: any) {
    return NextResponse.json({ error: String(e?.message || e) }, { status: 400 });
  }
}
