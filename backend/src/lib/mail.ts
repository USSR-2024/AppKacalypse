/**
 * Отправка почты через Resend. Домен appka.space верифицирован (DKIM+SPF+DMARC).
 * Единственная внешняя зависимость кроме Telegram — писем без сервиса не отправить,
 * свой SMTP с RU-адреса всё равно попадёт в спам.
 */
import { env } from './env.js';

const API = 'https://api.resend.com/emails';

async function send(to: string, subject: string, html: string, text: string) {
  if (!env.RESEND_API_KEY) {
    console.error('[mail] RESEND_API_KEY не задан — письмо не отправлено');
    return false;
  }
  const r = await fetch(API, {
    method: 'POST',
    headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify({ from: env.MAIL_FROM, to, subject, html, text }),
  });
  if (!r.ok) {
    // Тело ответа Resend может содержать адрес — логируем только статус.
    console.error(`[mail] отправка не удалась: HTTP ${r.status}`);
    return false;
  }
  return true;
}

const wrap = (body: string) => `<!doctype html><html><body style="margin:0;padding:24px;background:#f6f7f9;font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#0b0d12">
<div style="max-width:440px;margin:0 auto;background:#fff;border-radius:16px;padding:28px">
<div style="font-size:18px;font-weight:600;margin-bottom:16px">appka.space</div>
${body}
<div style="margin-top:24px;padding-top:16px;border-top:1px solid #e8eaee;font-size:12px;color:#8a919e">
Если вы не запрашивали это письмо — просто удалите его.
</div></div></body></html>`;

/** Код для входа/регистрации/привязки почты. */
export function sendLoginCode(to: string, code: string, minutes: number) {
  const html = wrap(`
<p style="margin:0 0 8px">Ваш код для входа:</p>
<div style="font-size:32px;font-weight:700;letter-spacing:6px;padding:14px 0">${code}</div>
<p style="margin:0;color:#5b6270;font-size:14px">Код действует ${minutes} минут. Никому его не сообщайте.</p>`);
  return send(to, `${code} — код для входа в appka.space`, html, `Код для входа: ${code}\nДействует ${minutes} минут.`);
}

/**
 * Ответ на запрос кода с адреса, у которого нет ни аккаунта, ни приглашения.
 * Нужен, чтобы форма отвечала одинаково всем: иначе по ответу API можно
 * перебором узнать, кто зарегистрирован. Человек получает внятное объяснение,
 * посторонний — ничего, потому что письмо уходит не ему.
 */
export function sendNoAccess(to: string) {
  const html = wrap(`
<p style="margin:0 0 8px">Кто-то запросил код для входа на этот адрес.</p>
<p style="margin:0;color:#5b6270;font-size:14px">Аккаунта с такой почтой нет, и приглашения тоже.
Регистрация в appka.space — только по приглашению: попросите ссылку у администратора вашего пространства.</p>`);
  return send(to, 'Запрос входа в appka.space', html, 'Аккаунта с этой почтой нет. Регистрация — только по приглашению от администратора.');
}
