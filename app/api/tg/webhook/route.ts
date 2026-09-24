import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { decide } from "@/lib/orders";
import { approveSignup, askOwner, rejectSignup, sendTo, tgCall, ownerWithTg, webhookSecret, ROLE_NAME } from "@/lib/telegram";
import { extractTask, looksLikeTask, resolveAssignee } from "@/lib/tgtasks";
import { collabAdd, collabRemove, kratParts } from "@/lib/quota";

export const dynamic = "force-dynamic";

const HELP =
  "Я бот Dobro Inc. Через меня приходят задачи и уведомления о публикациях.\n\n" +
  "/start — заявка на доступ или привязка профиля\n/me — мой профиль";

// Апдейты от Телеграма. Регистрация только по одобрению владельца: сам факт
// написать боту доступа не даёт.
export async function POST(req: Request) {
  const secret = webhookSecret();
  if (secret && req.headers.get("x-telegram-bot-api-secret-token") !== secret) {
    return new NextResponse("forbidden", { status: 403 });
  }
  const u = await req.json().catch(() => null);
  if (!u) return NextResponse.json({ ok: true });

  try {
    if (u.callback_query) await onCallback(u.callback_query);
    else if (u.message?.text) await onMessage(u.message);
  } catch (e) {
    console.error("[tg] апдейт упал:", e);
  }
  return NextResponse.json({ ok: true });
}

// Групповые чаты: бот молча читает и выцепляет поручения. Отвечает только
// когда нашёл задачу — иначе засорял бы переписку.
async function onGroupMessage(m: any) {
  const text = String(m.text || "").trim();
  if (!looksLikeTask(text)) return;
  const fromName = [m.from?.first_name, m.from?.last_name].filter(Boolean).join(" ") ||
    m.from?.username || "кто-то";
  let found;
  try {
    found = await extractTask(text, fromName, m.chat.title || "рабочий чат");
  } catch (e) {
    console.error("[tg] разбор задачи упал:", e);
    return;
  }
  if (!found) return;

  const hint = found.assignee_hint ||
    (m.reply_to_message?.from?.username ? "@" + m.reply_to_message.from.username : "");
  const assignee = await resolveAssignee(hint);
  if (!assignee) return;

  // Адресат не из Postos: задача падает владельцу, но с пометкой, кому она
  // была адресована в чате — чтобы Роман видел, кого дожимать.
  const unknownAssignee = Boolean(hint) && assignee.role === "OWNER" &&
    !hint.toLowerCase().replace(/^@/, "").includes((assignee.tgUsername || "@@").toLowerCase()) &&
    !assignee.name.toLowerCase().includes(hint.toLowerCase().replace(/^@/, ""));

  const task = await prisma.task.create({
    data: {
      assignedToUserId: assignee.id,
      title: unknownAssignee ? `${found.title} (исполнитель в чате: ${hint})` : found.title,
      dueDate: found.due ? new Date(found.due + "T12:00:00Z") : null,
      isAuto: true,
      source: `тг: ${fromName}`,
      sourceChat: m.chat.title || String(m.chat.id),
    },
  });

  const due = task.dueDate
    ? ` · дедлайн ${task.dueDate.toLocaleDateString("ru-RU", { timeZone: "Europe/Moscow" })}`
    : "";
  await tgCall("sendMessage", {
    chat_id: m.chat.id,
    reply_to_message_id: m.message_id,
    text: `📌 Задача: ${task.title}
Исполнитель: ${assignee.name}${due}
Записал в Postos.`,
    reply_markup: { inline_keyboard: [[
      { text: "✅ Сделано", callback_data: `td:${task.id}` },
      { text: "🗑 Не задача", callback_data: `tx:${task.id}` },
    ]] },
  });
  // Личный пуш исполнителю, если привязан и это не автор сообщения
  if (assignee.tgChatId && assignee.tgChatId !== String(m.from?.id)) {
    await sendTo(assignee.tgChatId, `📌 <b>Новая задача из чата «${m.chat.title || ""}»</b>
${task.title}${due}`);
  }
}

async function onMessage(m: any) {
  if (["group", "supergroup"].includes(m.chat?.type)) return onGroupMessage(m);
  const chatId = String(m.chat.id);
  const text = String(m.text || "").trim();
  const username = m.from?.username || null;
  const name = [m.from?.first_name, m.from?.last_name].filter(Boolean).join(" ") || username;

  const me = await prisma.user.findFirst({ where: { tgChatId: chatId } });

  if (text.startsWith("/start")) {
    const code = text.split(/\s+/)[1];
    // Привязка существующего профиля по одноразовому коду из ссылки Романа.
    if (code) {
      const user = await prisma.user.findFirst({ where: { tgLinkCode: code } });
      if (!user) {
        await sendTo(chatId, "Ссылка недействительна или уже использована. Попросите Романа выслать новую.");
        return;
      }
      await prisma.user.update({
        where: { id: user.id },
        data: { tgChatId: chatId, tgUsername: username, tgLinkCode: null },
      });
      await sendTo(
        chatId,
        `✅ Профиль привязан: <b>${user.name}</b> (${ROLE_NAME[user.role] || "сотрудник"}).\n\n` +
          (user.role === "SMM"
            ? "Буду присылать уведомления о публикациях."
            : user.role === "MANAGER"
              ? "Буду присылать ваши задачи."
              : "Сюда буду присылать заявки сотрудников и сводки.")
      );
      return;
    }
    if (me) {
      await sendTo(chatId, `Профиль уже привязан: <b>${me.name}</b> (${ROLE_NAME[me.role] || "сотрудник"}).`);
      return;
    }
    // Новая заявка: сохраняем и спрашиваем владельца.
    const signup = await prisma.tgSignup.upsert({
      where: { chatId },
      create: { chatId, username, name, status: "pending" },
      update: { username, name, status: "pending" },
    });
    const who = `${name || "без имени"}${username ? ` (@${username})` : ""}\nchat id: <code>${chatId}</code>`;
    const asked = await askOwner(signup.id, who);
    await sendTo(
      chatId,
      asked
        ? "Заявка отправлена Роману. Как одобрит — пришлю логин и пароль сюда."
        : "Заявка сохранена, но владелец пока не привязал Телеграм. Напишите Роману напрямую."
    );
    return;
  }

  // Коллаб в зачёт нормы: совместные посты не видны в API нашего аккаунта,
  // поэтому СММ присылает ссылку сюда. Зачитывается видео в super.fit24.
  const igLink = text.match(/https?:\/\/(?:www\.)?instagram\.com\/(?:p|reel)\/[A-Za-z0-9_-]+\/?/);
  if (igLink && me && ["SMM", "OWNER"].includes(me.role)) {
    const url = igLink[0];
    const res = await collabAdd({ date: kratParts().date, url, rule: "main", by: me.name });
    if (res === "dup") {
      await sendTo(chatId, "Эта ссылка уже зачтена.");
    } else {
      await tgCall("sendMessage", {
        chat_id: chatId, parse_mode: "HTML",
        text: `✅ Зачтено: видео в норму super.fit24 за ${kratParts().date} (совместный пост).`,
        reply_markup: { inline_keyboard: [[{ text: "↩️ Отменить зачёт", callback_data: `qx:${url.split("/").filter(Boolean).pop()}` }]] },
      });
      const owner = await ownerWithTg();
      if (owner?.tgChatId && owner.tgChatId !== chatId) {
        await sendTo(owner.tgChatId, `ℹ️ ${me.name} зачёл(ла) совместный пост в норму:\n${url}`);
      }
    }
    return;
  }

  if (text.startsWith("/me")) {
    await sendTo(
      chatId,
      me
        ? `<b>${me.name}</b>\nРоль: ${ROLE_NAME[me.role] || "сотрудник"}\nEmail: <code>${me.email}</code>`
        : "Профиль не привязан. Отправьте /start."
    );
    return;
  }

  await sendTo(chatId, HELP);
}

// Кнопки одобрения нажимает только владелец.
async function onCallback(q: any) {
  const chatId = String(q.message?.chat?.id || "");
  const data = String(q.data || "");
  const answer = (text: string) => tgCall("answerCallbackQuery", { callback_query_id: q.id, text });
  const [action, signupId, role] = data.split(":");

  // Согласование текста ролика: «да» пускает заказ в сборку, «нет» закрывает
  // его отклонённым. Жмёт только владелец — это его деньги.
  if (action === "ok" || action === "no") {
    const presser = await prisma.user.findFirst({ where: { tgChatId: String(q.from?.id || "") } });
    if (presser?.role !== "OWNER") { await answer("Решает владелец."); return; }
    try {
      const order = await decide(signupId, action === "ok");
      await answer(action === "ok" ? "Собираем" : "Отклонил");
      await tgCall("editMessageText", {
        chat_id: chatId, message_id: q.message.message_id,
        text: action === "ok"
          ? `✅ Собираем. Готовый ролик придёт сюда же.\n\n${order.script.slice(0, 2000)}`
          : `🚫 Текст не принят, ролик не собирается.\n\n${order.script.slice(0, 2000)}`,
      });
    } catch (e: any) {
      await answer(e.message || "не вышло");
    }
    return;
  }

  if (action === "qx") {
    const presser = await prisma.user.findFirst({ where: { tgChatId: String(q.from?.id || "") } });
    if (!presser || !["SMM", "OWNER"].includes(presser.role)) {
      await answer("Отменить может СММ или владелец."); return;
    }
    await collabRemove(`https://www.instagram.com/p/${signupId}`);
    await collabRemove(`https://www.instagram.com/reel/${signupId}`);
    await answer("Зачёт отменён");
    await tgCall("editMessageText", {
      chat_id: chatId, message_id: q.message.message_id,
      text: "↩️ Зачёт совместного поста отменён.",
    });
    return;
  }

  // Кнопки задач: жать может только исполнитель или владелец — иначе любой
  // участник чата закрывал бы чужие задачи. Владелец узнаёт о каждой отметке
  // личным сообщением и может вернуть задачу в работу.
  if (action === "td" || action === "tx" || action === "tr") {
    const task = await prisma.task.findUnique({
      where: { id: signupId }, include: { assignedTo: true },
    });
    if (!task) { await answer("Задача не найдена"); return; }
    const presser = await prisma.user.findFirst({ where: { tgChatId: String(q.from?.id || "") } });
    const isOwner = presser?.role === "OWNER";
    const isAssignee = presser?.id === task.assignedToUserId;
    if (!presser || (!isOwner && !isAssignee)) {
      await answer("Отметить может только исполнитель или владелец.");
      return;
    }

    if (action === "tr") {
      if (!isOwner) { await answer("Вернуть в работу может только владелец."); return; }
      await prisma.task.update({ where: { id: task.id }, data: { isDone: false } });
      await answer("Вернул в работу");
      if (task.assignedTo.tgChatId) {
        await sendTo(task.assignedTo.tgChatId, `↩️ <b>Задача возвращена в работу</b>\n${task.title}\nВладелец не принял выполнение.`);
      }
      await tgCall("editMessageText", {
        chat_id: chatId, message_id: q.message.message_id,
        text: `↩️ ${task.title} — возвращена в работу (${task.assignedTo.name})`,
      });
      return;
    }

    if (action === "td") {
      await prisma.task.update({ where: { id: task.id }, data: { isDone: true } });
      await answer("Отмечено сделанным");
    } else {
      await prisma.task.delete({ where: { id: task.id } });
      await answer("Удалил — не задача");
    }
    await tgCall("editMessageText", {
      chat_id: chatId, message_id: q.message.message_id,
      text: action === "td"
        ? `✅ ${task.title} — сделано (${presser.name})`
        : `🗑 ${task.title} — снята (${presser.name})`,
    });
    // Отметил не владелец — владельцу личное уведомление с кнопкой возврата.
    if (!isOwner) {
      const owner = await ownerWithTg();
      if (owner?.tgChatId) {
        if (action === "td") {
          await tgCall("sendMessage", {
            chat_id: owner.tgChatId, parse_mode: "HTML",
            text: `✅ <b>${presser.name} отметил задачу сделанной</b>\n${task.title}` +
              (task.sourceChat ? `\nЧат: ${task.sourceChat}` : ""),
            reply_markup: { inline_keyboard: [[{ text: "↩️ Вернуть в работу", callback_data: `tr:${task.id}` }]] },
          });
        } else {
          await sendTo(owner.tgChatId, `🗑 <b>${presser.name} снял задачу как «не задачу»</b>\n${task.title}`);
        }
      }
    }
    return;
  }

  const owner = await ownerWithTg();
  if (!owner || chatId !== owner.tgChatId) {
    await answer("Одобрять доступ может только владелец.");
    return;
  }
  if (action === "ok" && (role === "MANAGER" || role === "SMM")) {
    const res = await approveSignup(signupId, role);
    await answer(res.error || `Одобрено: ${ROLE_NAME[role]}`);
    if (!res.error) {
      await tgCall("editMessageText", {
        chat_id: chatId,
        message_id: q.message.message_id,
        text: `${q.message.text}\n\n✅ Одобрено: ${ROLE_NAME[role]} — ${res.user?.name}`,
      });
    }
    return;
  }
  if (action === "no") {
    const res = await rejectSignup(signupId);
    await answer(res.error || "Отклонено");
    if (!res.error) {
      await tgCall("editMessageText", {
        chat_id: chatId,
        message_id: q.message.message_id,
        text: `${q.message.text}\n\n⛔ Отклонено`,
      });
    }
    return;
  }
  await answer("Не понял кнопку");
}
