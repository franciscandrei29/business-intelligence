import nodemailer from 'nodemailer';

function getTransporter() {
  const port = Number(process.env.SMTP_PORT) || 465;
  const user = process.env.SMTP_USER || '';
  const pass = process.env.SMTP_PASS || '';

  const config: any = {
    host: process.env.SMTP_HOST || '127.0.0.1',
    port,
    secure: port === 465,
  };

  // Only add auth if credentials are provided
  if (user && pass) {
    config.auth = { user, pass };
  }

  // For local exim, skip TLS verification
  if (port === 25) {
    config.tls = { rejectUnauthorized: false };
  }

  return nodemailer.createTransport(config);
}

const APP_URL = process.env.APP_URL || 'https://bi.kimonogroup.ro';
const FROM = process.env.SMTP_FROM || 'Kimono BI <noreply@kimonogroup.ro>';

export async function sendVerifyEmail(email: string, token: string) {
  const url = `${APP_URL}/verify/${token}`;
  const transporter = getTransporter();

  await transporter.sendMail({
    from: FROM,
    to: email,
    subject: 'Verificare cont - Kimono BI',
    html: `
      <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #1a1a2e;">Bine ai venit la Kimono BI!</h2>
        <p>Apasa pe butonul de mai jos pentru a-ti verifica contul:</p>
        <a href="${url}"
           style="display: inline-block; padding: 12px 24px; background: #e94560;
                  color: white; text-decoration: none; border-radius: 6px;
                  font-weight: 600;">
          Verifica contul
        </a>
        <p style="margin-top: 24px; color: #666; font-size: 14px;">
          Sau copiaza acest link: <br/>
          <a href="${url}">${url}</a>
        </p>
      </div>
    `,
  });
}

export async function sendResetEmail(email: string, token: string) {
  const url = `${APP_URL}/reset/${token}`;
  const transporter = getTransporter();

  await transporter.sendMail({
    from: FROM,
    to: email,
    subject: 'Resetare parola - Kimono BI',
    html: `
      <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #1a1a2e;">Resetare parola</h2>
        <p>Ai solicitat resetarea parolei. Apasa pe butonul de mai jos:</p>
        <a href="${url}"
           style="display: inline-block; padding: 12px 24px; background: #e94560;
                  color: white; text-decoration: none; border-radius: 6px;
                  font-weight: 600;">
          Reseteaza parola
        </a>
        <p style="margin-top: 24px; color: #666; font-size: 14px;">
          Link-ul expira in 1 ora.<br/>
          Daca nu ai solicitat resetarea, ignora acest email.
        </p>
      </div>
    `,
  });
}
