import { NextResponse } from "next/server";
import { DEFAULT_BRAND, factoryAuth } from "@/lib/factory";
import { publishFor } from "@/lib/publish";

export const dynamic = "force-dynamic";

// Публикация готового ролика через upload-post.
//
// Завод отдаёт ролик сюда, а Постос решает, куда он выходит: соцсети из блока
// «Аккаунты», у которых включены «Выпускаем сюда» и «Автопубликация».
// Соцсеть должна быть подключена в своём аккаунте (профиле upload-post) —
// без этого выкладывать некуда, и мы честно говорим, почему пропустили.
//
// Так переключатели в Постосе перестают быть бутафорией для заводов, которые
// сами публиковать не умеют (MoneyBall): решение принимается здесь, в одном
// месте. СуперФит публикует сам — ему эта ручка отказывает, иначе ролик
// вышел бы дважды.

export async function POST(req: Request) {
  const brand = factoryAuth(req);
  if (!brand) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  if (brand === DEFAULT_BRAND) {
    return NextResponse.json({ error: "СуперФит публикует сам — сюда ролики не шлёт" }, { status: 400 });
  }
  const form = await req.formData();
  const video = form.get("video") as File | null;
  const photos = (form.getAll("photos") as File[]).filter((x) => x && typeof x !== "string");
  const coverRaw = form.get("cover");
  const cover = coverRaw && typeof coverRaw !== "string" ? (coverRaw as File) : null;
  if (!video && !photos.length) return NextResponse.json({ error: "нет ни video, ни photos" }, { status: 400 });
  try {
    const r = await publishFor(brand, {
      video, photos, cover, caption: String(form.get("caption") || ""),
      title: String(form.get("title") || ""), kind: String(form.get("kind") || ""),
    });
    return NextResponse.json({ ok: true, ...r });
  } catch (e: any) {
    return NextResponse.json({ error: String(e?.message || e) }, { status: 502 });
  }
}
