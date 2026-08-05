import nodemailer from 'nodemailer';

let transporter = null;

const getTransporter = () => {
  if (transporter) return transporter;

  const host = process.env.SMTP_HOST;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if (!host || !user || !pass) {
    return null;
  }

  transporter = nodemailer.createTransport({
    host,
    port: Number(process.env.SMTP_PORT || 587),
    secure: String(process.env.SMTP_SECURE || 'false') === 'true',
    auth: { user, pass },
  });

  return transporter;
};

const appBaseUrl = () =>
  (process.env.FRONTEND_URL || process.env.APP_URL || 'http://localhost:5173').replace(/\/$/, '');

/** Branded HTML email that mirrors an in-app notification. */
export function buildNotificationEmail({ title, body, link = '' }) {
  const href = link ? `${appBaseUrl()}${link.startsWith('/') ? link : `/${link}`}` : appBaseUrl();
  const cta = link
    ? `<a href="${href}" style="display:inline-block;margin-top:20px;padding:12px 22px;background:#111111;color:#ffffff;text-decoration:none;border-radius:999px;font-size:13px;font-weight:600;letter-spacing:0.02em;">View details</a>`
    : '';

  return `<!DOCTYPE html>
<html>
  <body style="margin:0;padding:0;background:#f9f9f9;font-family:Inter,Segoe UI,Arial,sans-serif;color:#111111;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f9f9f9;padding:32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" style="max-width:520px;background:#ffffff;border:1px solid #ece8e3;border-radius:16px;overflow:hidden;">
            <tr>
              <td style="padding:22px 28px;border-bottom:1px solid #f0ece6;">
                <div style="font-size:13px;font-weight:700;letter-spacing:0.28em;">FABRICA</div>
              </td>
            </tr>
            <tr>
              <td style="padding:28px;">
                <div style="font-size:11px;font-weight:600;letter-spacing:0.08em;text-transform:uppercase;color:#8a847a;margin-bottom:10px;">Notification</div>
                <h1 style="margin:0 0 10px;font-size:22px;line-height:1.3;font-family:Georgia,'Times New Roman',serif;font-weight:600;">${escapeHtml(title)}</h1>
                <p style="margin:0;font-size:14px;line-height:1.6;color:#4b5563;">${escapeHtml(body)}</p>
                ${cta}
              </td>
            </tr>
            <tr>
              <td style="padding:16px 28px;background:#fafafa;border-top:1px solid #f0ece6;">
                <p style="margin:0;font-size:11px;color:#9ca3af;">You’re receiving this because you have a Fabrica account.</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

function escapeHtml(value = '') {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export async function sendEmail({ to, subject, html, text }) {
  if (!to) return { sent: false, reason: 'NO_RECIPIENT' };

  const transport = getTransporter();
  const from = process.env.EMAIL_FROM || process.env.SMTP_USER || 'Fabrica <noreply@fabrica.local>';

  if (!transport) {
    console.log('[email:dev]', { to, subject, text: text || html });
    return { sent: false, reason: 'SMTP_NOT_CONFIGURED', logged: true };
  }

  await transport.sendMail({
    from,
    to,
    subject,
    html,
    text: text || html?.replace(/<[^>]+>/g, ' '),
  });

  return { sent: true };
}
