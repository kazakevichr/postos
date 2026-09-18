import { NextResponse } from "next/server";
import { runChecks } from "@/lib/noticeChecks";
import { pushCritical } from "@/lib/noticePush";

export const dynamic = "force-dynamic";

// Обход проверяльщиков. Зовётся расписанием из instrumentation через HTTP, а
// не импортом: тот собирается и для edge, а сюда тянутся node-модули
// (Телеграм подписывает пароли через node:crypto).
export async function POST(req: Request) {
  const need = process.env.IG_HOST_KEY;
  if (need && req.headers.get("x-factory-key") !== need) {
    return new NextResponse("forbidden", { status: 403 });
  }
  await runChecks();
  const pushed = await pushCritical();
  return NextResponse.json({ ok: true, pushed });
}
