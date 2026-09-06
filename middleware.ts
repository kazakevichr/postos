import { NextResponse } from "next/server";
import { withAuth } from "next-auth/middleware";

// Наблюдатель не пишет — и это решается здесь, а не в каждой ручке.
//
// Роль PARTNER изменяет данные только там, где ей это разрешено поимённо
// (список ниже), поэтому надёжнее перехватить любой изменяющий запрос на
// входе, чем добавлять проверку в три десятка мест и надеяться, что в
// следующей ручке о ней вспомнят. Спрятанная в интерфейсе кнопка защищает
// ровно до первого curl.
const READ_ONLY_ROLES = new Set(["PARTNER"]);

// Исключение из правила: кошельки своего направления партнёр ведёт сам.
// Сервисы, которые жжёт его проект, оплачены из его денег, и вписывать
// пополнения через владельца — не разграничение прав, а лишний посредник.
// Рамки направления проверяет сама ручка: здесь мы лишь не мешаем запросу
// до неё дойти.
const PARTNER_MAY_WRITE = ["/api/factory/wallets"];

// Заголовки, которыми представляются машины: завод, телеграм. Запрос с любым
// из них пропускается до ручки — секрет проверяет она сама.
const MACHINE_HEADERS = ["x-factory-key", "x-telegram-bot-api-secret-token", "x-host-key"];
const SAFE = new Set(["GET", "HEAD", "OPTIONS"]);

export default withAuth(
  function middleware(req) {
    const role = (req as any).nextauth?.token?.role;
    if (
      READ_ONLY_ROLES.has(role) &&
      !SAFE.has(req.method) &&
      // Вход и выход из системы — не изменение данных.
      !req.nextUrl.pathname.startsWith("/api/auth") &&
      !PARTNER_MAY_WRITE.some((p) => req.nextUrl.pathname === p)
    ) {
      return NextResponse.json(
        { error: "Доступ только на просмотр: изменения вносит владелец" },
        { status: 403 }
      );
    }
    return NextResponse.next();
  },
  {
    callbacks: {
      // Машины ходят по своим ключам, а не сессией. Без этой оговорки withAuth
      // отвечал им редиректом на страницу входа — и завод прочитал это как
      // «Постос недоступен», работая по-старому: снимал контент, выключенный
      // в матрице. Телеграм на редирект просто молчал.
      //
      // Настоящую проверку ключа делает сама ручка; здесь мы лишь не мешаем
      // запросу до неё дойти. Новая машинная ручка со своим заголовком должна
      // попасть в этот список — иначе поломка выйдет тихой.
      authorized: ({ req, token }) =>
        Boolean(token) || MACHINE_HEADERS.some((h) => req.headers.get(h)),
    },
  }
);

export const config = {
  matcher: [
    "/",
    "/projects/:path*",
    "/partners/:path*",
    "/my-partners/:path*",
    "/assistant/:path*",
    "/tasks/:path*",
    "/payroll/:path*",
    "/lost/:path*",
    "/settings/:path*",
    "/insta/:path*",
    "/social/:path*",
    "/analytics/:path*",
    "/oracle/:path*",
    "/factory/:path*",
    "/cabinet/:path*",
    "/economics/:path*",
    "/wallets/:path*",
    // Ручки тоже: запрет на запись должен работать и в обход интерфейса.
    // Завод ходит по ключу, его пути под auth не заводим.
    "/api/((?!auth|ig/host|factory/quota/check).*)",
  ],
};
