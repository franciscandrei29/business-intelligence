import nodemailer from 'nodemailer';

// Best-effort email logging into EmailLog table. Imported lazily to avoid
// circular deps when this file is used outside of the Remix server context.
async function logEmail(opts: { to: string; subject: string; category: string; success: boolean; error?: string; metadata?: any }) {
  try {
    const { db } = await import('~/lib/db.server');
    await db.emailLog.create({
      data: {
        to: opts.to,
        subject: opts.subject,
        category: opts.category,
        success: opts.success,
        error: opts.error || null,
        metadata: opts.metadata as any,
      },
    });
  } catch (err) {
    console.error('[email-log] failed:', (err as Error).message);
  }
}

// Heuristic — deduce email category from subject so all sendMail calls get logged automatically
// without modifying every individual call site.
function deduceCategory(subject: string): string {
  const s = (subject || '').toLowerCase();
  if (s.includes('factur') || s.includes('invoice')) return 'stripe_invoice';
  if (s.includes('abonament') && s.includes('expir')) return 'subscription_expired';
  if (s.includes('e gata') || s.includes('sync') || s.includes('importate')) return 'first_sync';
  if (s.includes('conectat')) return 'store_connected';
  if (s.includes('confirm') || s.includes('verif')) return 'verify';
  if (s.includes('resetare') || s.includes('reset parolă') || s.includes('reset parola')) return 'reset_password';
  if (s.includes('invit') || s.includes('echip')) return 'team_invite';
  if (s.includes('action items')) return 'actions_digest';
  if (s.includes('săpt') || s.includes('digest')) return 'digest';
  if (s.includes('mesaj nou') || s.includes('contact')) return 'contact';
  return 'unknown';
}

function _getTransporterRaw() {
  const port = Number(process.env.SMTP_PORT) || 587;
  const user = process.env.SMTP_USER || '';
  const pass = process.env.SMTP_PASS || '';
  const host = process.env.SMTP_HOST || 'smtp.gmail.com';

  const config: any = {
    host,
    port,
    secure: port === 465,
    tls: { rejectUnauthorized: false },
  };

  if (user && pass) {
    config.auth = { user, pass };
  }

  return nodemailer.createTransport(config);
}

function getTransporter() {
  const transporter = _getTransporterRaw();
  const origSendMail = transporter.sendMail.bind(transporter);
  // Override sendMail to log every attempt
  (transporter as any).sendMail = async (mail: any) => {
    const category = deduceCategory(String(mail?.subject || ''));
    try {
      const info = await origSendMail(mail);
      logEmail({ to: String(mail.to), subject: String(mail.subject || ''), category, success: true, metadata: { messageId: info.messageId } }).catch(() => {});
      return info;
    } catch (err: any) {
      logEmail({ to: String(mail.to), subject: String(mail.subject || ''), category, success: false, error: err.message }).catch(() => {});
      throw err;
    }
  };
  return transporter;
}

const APP_URL = process.env.APP_URL || 'https://bi.kimonogroup.ro';
const FROM = process.env.SMTP_FROM || 'Kimono BI <noreply@kimonogroup.ro>';

function brandedLayout(title: string, body: string, opts?: { eyebrow?: string }) {
  const eyebrow = opts?.eyebrow || '';
  return `<!DOCTYPE html>
<html lang="ro">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="x-apple-disable-message-reformatting">
  <meta name="format-detection" content="telephone=no">
  <title>${title} — Kimono BI</title>
  <style>
    @media only screen and (max-width:520px) {
      .kbi-wrap { padding: 12px 8px !important; }
      .kbi-shell { width: 100% !important; max-width: 100% !important; }
      .kbi-pad { padding: 22px 20px !important; }
      .kbi-pad-h { padding: 18px 20px !important; }
      .kbi-h1 { font-size: 20px !important; line-height: 1.25 !important; }
      .kbi-cta { display: block !important; width: 100% !important; box-sizing: border-box !important; padding: 14px 16px !important; }
    }
  </style>
  <!--[if mso]><style type="text/css">body, table, td, a { font-family: Arial, Helvetica, sans-serif !important; }</style><![endif]-->
</head>
<body style="margin:0;padding:0;background:#FAFAF9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#0A0A0A;-webkit-font-smoothing:antialiased;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#FAFAF9;">
    <tr><td align="center" class="kbi-wrap" style="padding:32px 16px;">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" class="kbi-shell" style="max-width:600px;width:100%;background:#FFFFFF;border:1px solid #EAEAEA;">

        <!-- Header dark -->
        <tr><td class="kbi-pad-h" style="background:#0A0A0A;padding:24px 28px;border-bottom:4px solid #D85A30;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
            <tr>
              <td style="vertical-align:middle;">
                <div style="display:inline-block;vertical-align:middle;width:34px;height:34px;background:#D85A30;border-radius:8px;text-align:center;line-height:34px;color:#FFFFFF;font-size:16px;font-weight:800;letter-spacing:-0.5px;">K</div>
                <div style="display:inline-block;vertical-align:middle;margin-left:10px;">
                  <div style="color:#FFFFFF;font-size:18px;font-weight:700;letter-spacing:-0.4px;line-height:1.1;">Kimono <span style="color:#D85A30;">BI</span></div>
                  <div style="color:#888780;font-size:10px;letter-spacing:1.5px;text-transform:uppercase;margin-top:2px;font-weight:500;">${eyebrow || 'Business Intelligence'}</div>
                </div>
              </td>
            </tr>
          </table>
        </td></tr>

        <!-- Body -->
        <tr><td class="kbi-pad" style="padding:32px 28px;">
          <h1 class="kbi-h1" style="margin:0 0 18px;font-size:22px;font-weight:600;letter-spacing:-0.5px;color:#0A0A0A;line-height:1.25;">${title}</h1>
          ${body}
        </td></tr>

        <!-- Footer -->
        <tr><td style="background:#FAFAF9;padding:18px 28px;border-top:1px solid #EAEAEA;font-size:11px;color:#888780;line-height:1.6;text-align:center;">
          <strong style="color:#0A0A0A;">Kimono BI</strong> · Operat de GLOBAL DISTRIBUTION CENTER SRL<br>
          Sectorul 4, București · CUI 50169414 · J2024010966408<br>
          <a href="${APP_URL}" style="color:#888780;text-decoration:underline;">bi.kimonogroup.ro</a>
        </td></tr>

      </table>
      <div style="font-size:10.5px;color:#B4B2A9;margin-top:18px;letter-spacing:0.3px;">
        © ${new Date().getFullYear()} GLOBAL DISTRIBUTION CENTER SRL. Toate drepturile rezervate.
      </div>
    </td></tr>
  </table>
</body>
</html>`;
}

function button(url: string, label: string) {
  return `<div style="margin:28px 0;">
    <a href="${url}" class="kbi-cta" style="display:inline-block;padding:14px 28px;background:#FF5A1F;color:#FFFFFF;text-decoration:none;font-weight:700;font-size:14px;border:2px solid #0a0a0a;letter-spacing:0.3px;box-sizing:border-box;">
      ${label}
    </a>
  </div>`;
}

export async function sendVerifyEmail(email: string, token: string) {
  const url = `${APP_URL}/verify/${token}`;
  const transporter = getTransporter();

  const body = `
    <p style="font-size:15px;line-height:1.6;color:#262626;margin:0 0 8px;">
      Bine ai venit la <strong>Kimono BI</strong>.
    </p>
    <p style="font-size:15px;line-height:1.6;color:#262626;margin:0 0 8px;">
      Apasă pe butonul de mai jos pentru a-ți confirma adresa de email și a activa contul:
    </p>
    ${button(url, 'Confirmă adresa de email')}
    <p style="font-size:13px;line-height:1.6;color:#525252;margin:20px 0 0;">
      Dacă butonul nu funcționează, copiază acest link în browser:<br>
      <a href="${url}" style="color:#FF5A1F;word-break:break-all;">${url}</a>
    </p>
    <p style="font-size:12px;color:#737373;margin:28px 0 0;padding-top:16px;border-top:1px solid #e5e5e5;">
      Dacă nu tu ai creat acest cont, ignoră acest mesaj.
    </p>
  `;

  await transporter.sendMail({
    from: FROM,
    to: email,
    subject: 'Confirmă adresa de email — Kimono BI',
    html: brandedLayout('Confirmă-ți adresa de email', body, { eyebrow: 'Activare cont' }),
    text: `Bine ai venit la Kimono BI!\n\nDeschide acest link pentru a-ți confirma contul:\n${url}\n\nDacă nu tu ai creat contul, ignoră acest mesaj.`,
  });
}

export async function sendResetEmail(email: string, token: string) {
  const url = `${APP_URL}/reset/${token}`;
  const transporter = getTransporter();

  const body = `
    <p style="font-size:15px;line-height:1.6;color:#262626;margin:0 0 8px;">
      Ai solicitat resetarea parolei pentru contul tău Kimono BI.
    </p>
    <p style="font-size:15px;line-height:1.6;color:#262626;margin:0 0 8px;">
      Apasă pe butonul de mai jos pentru a seta o parolă nouă:
    </p>
    ${button(url, 'Resetează parola')}
    <p style="font-size:13px;line-height:1.6;color:#525252;margin:20px 0 0;">
      Sau copiază acest link: <a href="${url}" style="color:#FF5A1F;word-break:break-all;">${url}</a>
    </p>
    <p style="font-size:12px;color:#737373;margin:28px 0 0;padding-top:16px;border-top:1px solid #e5e5e5;">
      Link-ul expiră în 1 oră. Dacă nu ai solicitat resetarea, ignoră acest mesaj.
    </p>
  `;

  await transporter.sendMail({
    from: FROM,
    to: email,
    subject: 'Resetare parolă — Kimono BI',
    html: brandedLayout('Resetare parolă', body, { eyebrow: 'Securitate cont' }),
    text: `Ai solicitat resetarea parolei pentru Kimono BI.\n\nDeschide acest link (valid 1 ora):\n${url}\n\nDacă nu ai solicitat resetarea, ignoră acest mesaj.`,
  });
}

const NOTIFY_EMAIL = process.env.NOTIFY_EMAIL || 'office@kimonogroup.ro';

export async function sendContactMessage(opts: { name: string; email: string; phone: string; subject: string; message: string }) {
  const { name, email, phone, subject, message } = opts;
  const transporter = getTransporter();
  const subjectLabel = subject || 'fără subiect';

  const adminBody = `
    <p style="font-size:15px;line-height:1.6;color:#262626;margin:0 0 16px;">
      Mesaj nou primit prin formularul de contact <strong>bi.kimonogroup.ro/contact</strong>:
    </p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:0.5px solid #E5E5E5;border-collapse:collapse;margin:0 0 18px;">
      <tr><td style="padding:10px 14px;font-size:11px;color:#737373;text-transform:uppercase;letter-spacing:0.5px;font-weight:600;background:#FAFAFA;width:110px;">Nume</td><td style="padding:10px 14px;font-size:13.5px;color:#0a0a0a;border-left:0.5px solid #E5E5E5;">${escapeHtml(name)}</td></tr>
      <tr><td style="padding:10px 14px;font-size:11px;color:#737373;text-transform:uppercase;letter-spacing:0.5px;font-weight:600;background:#FAFAFA;border-top:0.5px solid #E5E5E5;">Email</td><td style="padding:10px 14px;font-size:13.5px;color:#0a0a0a;border-left:0.5px solid #E5E5E5;border-top:0.5px solid #E5E5E5;"><a href="mailto:${escapeHtml(email)}" style="color:#FF5A1F;text-decoration:none;">${escapeHtml(email)}</a></td></tr>
      <tr><td style="padding:10px 14px;font-size:11px;color:#737373;text-transform:uppercase;letter-spacing:0.5px;font-weight:600;background:#FAFAFA;border-top:0.5px solid #E5E5E5;">Telefon</td><td style="padding:10px 14px;font-size:13.5px;color:#0a0a0a;border-left:0.5px solid #E5E5E5;border-top:0.5px solid #E5E5E5;"><a href="tel:${escapeHtml(phone)}" style="color:#FF5A1F;text-decoration:none;">${escapeHtml(phone)}</a></td></tr>
      <tr><td style="padding:10px 14px;font-size:11px;color:#737373;text-transform:uppercase;letter-spacing:0.5px;font-weight:600;background:#FAFAFA;border-top:0.5px solid #E5E5E5;">Subiect</td><td style="padding:10px 14px;font-size:13.5px;color:#0a0a0a;border-left:0.5px solid #E5E5E5;border-top:0.5px solid #E5E5E5;">${escapeHtml(subjectLabel)}</td></tr>
    </table>
    <div style="font-size:11px;color:#737373;text-transform:uppercase;letter-spacing:0.5px;font-weight:600;margin-bottom:8px;">Mesaj</div>
    <div style="background:#FAFAFA;border-left:3px solid #FF5A1F;padding:14px 18px;font-size:14px;color:#0a0a0a;line-height:1.65;white-space:pre-wrap;">${escapeHtml(message)}</div>
    <p style="font-size:12px;color:#737373;margin:24px 0 0;padding-top:16px;border-top:1px solid #e5e5e5;">
      Răspunde direct la acest email — destinatarul va primi mesajul tău la ${escapeHtml(email)}.
    </p>
  `;

  await transporter.sendMail({
    from: FROM,
    to: NOTIFY_EMAIL,
    replyTo: `${name} <${email}>`,
    subject: `[Contact] ${subjectLabel} — ${name}`,
    html: brandedLayout('Mesaj nou prin contact', adminBody, { eyebrow: 'Notificare internă' }),
    text: `Mesaj nou prin formularul de contact bi.kimonogroup.ro/contact

Nume: ${name}
Email: ${email}
Telefon: ${phone}
Subiect: ${subjectLabel}

Mesaj:
${message}

—
Răspunde direct la acest email pentru a contacta expeditorul.`,
  });

  // Confirmation to user
  const userBody = `
    <p style="font-size:15px;line-height:1.6;color:#262626;margin:0 0 12px;">Salut ${escapeHtml(name)},</p>
    <p style="font-size:15px;line-height:1.6;color:#262626;margin:0 0 16px;">
      Am primit mesajul tău despre <strong>${escapeHtml(subjectLabel)}</strong>. O să-ți răspundem în maxim 24 de ore lucrătoare.
    </p>
    <div style="background:#FAFAFA;border-left:3px solid #FF5A1F;padding:14px 18px;font-size:13.5px;color:#525252;line-height:1.65;white-space:pre-wrap;margin:0 0 18px;">${escapeHtml(message.slice(0, 600))}${message.length > 600 ? '…' : ''}</div>
    <p style="font-size:13px;line-height:1.6;color:#525252;margin:0;">
      Pentru urgențe scrie-ne direct la <a href="mailto:office@kimonogroup.ro" style="color:#FF5A1F;">office@kimonogroup.ro</a>.
    </p>
  `;
  try {
    await transporter.sendMail({
      from: FROM,
      to: email,
      subject: 'Am primit mesajul tău — Kimono BI',
      html: brandedLayout('Am primit mesajul tău', userBody, { eyebrow: 'Confirmare contact' }),
      text: `Salut ${name},\n\nAm primit mesajul tău despre "${subjectLabel}". Îți răspundem în maxim 24h lucrătoare.\n\nPentru urgențe: office@kimonogroup.ro\n\n— Echipa Kimono BI`,
    });
  } catch (e) {
    console.error('[contact] confirmation email failed:', e);
  }
}

export async function sendTeamInviteEmail(opts: {
  toEmail: string;
  inviterName: string;
  inviterCompany?: string | null;
  role: string;
  inviteToken: string;
}) {
  const { toEmail, inviterName, inviterCompany, role, inviteToken } = opts;
  const transporter = getTransporter();
  const url = `${APP_URL}/accept-invite/${inviteToken}`;
  const roleLabels: Record<string, string> = { admin: 'Admin', analyst: 'Analyst', viewer: 'Viewer' };
  const roleLabel = roleLabels[role] || role;
  const roleDescriptions: Record<string, string> = {
    admin: 'Acces complet la setări și date',
    analyst: 'Vizualizare completă a datelor și rapoarte',
    viewer: 'Acces de citire la dashboard și rapoarte',
  };
  const roleColors: Record<string, { bg: string; text: string; border: string }> = {
    admin: { bg: '#FFF5F0', text: '#A33D14', border: '#FBC9B0' },
    analyst: { bg: '#EFF6FB', text: '#0A4F76', border: '#B5D7EC' },
    viewer: { bg: '#F4F4F2', text: '#525252', border: '#E5E5E5' },
  };
  const rc = roleColors[role] || roleColors.viewer;
  const initials = inviterName
    .split(/\s+/)
    .map((n) => n[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase() || 'K';

  const benefits = [
    { icon: '📊', text: 'Dashboard live cu vânzări, clienți și produse' },
    { icon: '🤖', text: 'Recomandări AI săptămânale pentru creșterea magazinului' },
    { icon: '📦', text: 'Alerte stoc, slow-movers și trenduri de cumpărare' },
    { icon: '🔔', text: 'Digest în inbox cu KPI-urile cheie' },
  ];
  const benefitsHtml = benefits
    .map(
      (b) => `
      <tr><td style="padding:6px 0;font-size:13px;color:#262626;line-height:1.5;">
        <span style="display:inline-block;width:22px;font-size:14px;vertical-align:middle;">${b.icon}</span>
        <span style="vertical-align:middle;">${b.text}</span>
      </td></tr>`
    )
    .join('');

  const body = `
    <!-- Invite hero card -->
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 24px;background:linear-gradient(135deg,#FFF8F4 0%,#FFFFFF 100%);border:1px solid #FBC9B0;border-radius:10px;">
      <tr><td style="padding:22px 22px 18px;">
        <div style="font-size:10.5px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:#D85A30;margin-bottom:14px;">
          ✉ Invitație nouă
        </div>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
          <tr>
            <td style="width:48px;vertical-align:middle;">
              <div style="width:42px;height:42px;border-radius:50%;background:#D85A30;color:#FFFFFF;text-align:center;line-height:42px;font-size:14px;font-weight:700;letter-spacing:-0.3px;">${escapeHtml(initials)}</div>
            </td>
            <td style="vertical-align:middle;padding-left:12px;">
              <div style="font-size:15px;font-weight:600;color:#0A0A0A;line-height:1.3;">${escapeHtml(inviterName)}</div>
              ${inviterCompany ? `<div style="font-size:12px;color:#737373;margin-top:2px;">${escapeHtml(inviterCompany)}</div>` : ''}
            </td>
            <td style="vertical-align:middle;text-align:right;">
              <span style="display:inline-block;padding:5px 12px;background:${rc.bg};color:${rc.text};border:1px solid ${rc.border};border-radius:99px;font-size:11px;font-weight:700;letter-spacing:0.4px;text-transform:uppercase;">${escapeHtml(roleLabel)}</span>
            </td>
          </tr>
        </table>
        <div style="margin-top:16px;padding-top:14px;border-top:1px dashed #FBC9B0;font-size:12.5px;color:#525252;line-height:1.55;">
          ${escapeHtml(roleDescriptions[role] || 'Acces conform rolului asignat')}.
        </div>
      </td></tr>
    </table>

    <p style="font-size:15px;line-height:1.6;color:#0A0A0A;margin:0 0 8px;font-weight:600;">Salut,</p>
    <p style="font-size:14px;line-height:1.65;color:#262626;margin:0 0 18px;">
      Ai fost invitat în echipa <strong>${inviterCompany ? escapeHtml(inviterCompany) : escapeHtml(inviterName)}</strong> pe Kimono BI. Acceptarea durează un minut — nu trebuie să introduci datele magazinului, te conectezi direct la datele echipei.
    </p>

    <!-- Benefits list -->
    <div style="margin:0 0 22px;padding:16px 18px;background:#FAFAF9;border-radius:8px;border:0.5px solid #EAEAEA;">
      <div style="font-size:11px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:#888780;margin-bottom:10px;">Ce vei avea acces</div>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
        ${benefitsHtml}
      </table>
    </div>

    <!-- CTA -->
    <div style="margin:24px 0 18px;text-align:center;">
      <a href="${url}" class="kbi-cta" style="display:inline-block;padding:14px 36px;background:#D85A30;color:#FFFFFF;text-decoration:none;font-weight:700;font-size:14px;border:2px solid #0A0A0A;letter-spacing:0.3px;box-sizing:border-box;border-radius:6px;">
        Acceptă invitația →
      </a>
    </div>

    <p style="font-size:11.5px;line-height:1.5;color:#888780;margin:0 0 6px;text-align:center;">
      Sau copiază link-ul în browser:
    </p>
    <p style="font-size:11.5px;line-height:1.5;margin:0 0 18px;text-align:center;word-break:break-all;">
      <a href="${url}" style="color:#D85A30;text-decoration:underline;">${url}</a>
    </p>

    <div style="margin:18px 0 0;padding:12px 14px;background:#FFFAF5;border-left:3px solid #D85A30;border-radius:0 6px 6px 0;font-size:12px;color:#525252;line-height:1.55;">
      <strong style="color:#0A0A0A;">Important:</strong> Acest link e personal pentru <strong>${escapeHtml(toEmail)}</strong> și poate fi folosit o singură dată. Dacă nu ai cerut această invitație, ignoră emailul.
    </div>
  `;

  await transporter.sendMail({
    from: FROM,
    to: toEmail,
    subject: `${inviterName} te-a invitat în echipa Kimono BI (${roleLabel})`,
    html: brandedLayout(`Ai fost invitat în echipă`, body, { eyebrow: `Invitație · ${roleLabel}` }),
    text: `${inviterName}${inviterCompany ? ' de la ' + inviterCompany : ''} te-a invitat să te alături echipei lor în Kimono BI cu rolul "${roleLabel}".\n\nAcceptă invitația: ${url}\n\nNu trebuie să introduci datele magazinului — te conectezi direct la datele echipei.\n\nLink-ul e personal pentru ${toEmail} și poate fi folosit o singură dată.`,
  });
}

function escapeHtml(s: string) {
  if (s == null) return '';
  return String(s).replace(/[<>&"']/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;' }[c] as string));
}

export async function sendActionsDigestEmail(opts: {
  toEmail: string;
  storeName: string;
  results: { rule: string; affectedCount: number; details: string[] }[];
}) {
  const { toEmail, storeName, results } = opts;
  const transporter = getTransporter();
  const totalCount = results.reduce((s, r) => s + r.affectedCount, 0);

  const sectionRows = results.map((r) => {
    const top = r.details.slice(0, 5);
    const rowsHtml = top.length === 0
      ? `<div style="font-size:12.5px;color:#888780;padding:14px 16px;font-style:italic;">Niciun rezultat — totul în regulă pentru această regulă.</div>`
      : top.map((d, i) => `<div style="padding:10px 16px;font-size:12.5px;color:#262626;line-height:1.55;${i > 0 ? 'border-top:0.5px solid #EAEAEA;' : ''}">${escapeHtml(d)}</div>`).join('');
    const moreRow = r.details.length > 5
      ? `<div style="padding:10px 16px;font-size:11.5px;color:#888780;border-top:0.5px solid #EAEAEA;font-style:italic;">+ încă ${r.details.length - 5} rezultate (vezi în platformă)</div>`
      : '';
    const countColor = r.affectedCount === 0 ? '#0F6E56' : r.affectedCount > 20 ? '#A32D2D' : '#854F0B';
    return `
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 16px;border:0.5px solid #EAEAEA;border-collapse:collapse;">
        <tr><td style="background:#FAFAFA;padding:12px 16px;border-bottom:0.5px solid #EAEAEA;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
            <td style="font-size:13.5px;font-weight:600;color:#0a0a0a;">${escapeHtml(r.rule)}</td>
            <td style="text-align:right;"><span style="display:inline-block;padding:3px 10px;background:${countColor}22;color:${countColor};border-radius:99px;font-size:11px;font-weight:700;">${r.affectedCount} ${r.affectedCount === 1 ? 'rezultat' : 'rezultate'}</span></td>
          </tr></table>
        </td></tr>
        <tr><td>${rowsHtml}${moreRow}</td></tr>
      </table>
    `;
  }).join('');

  const body = `
    <p style="font-size:15px;line-height:1.6;color:#262626;margin:0 0 8px;">
      Raport rulat acum pe magazinul <strong>${escapeHtml(storeName)}</strong>.
    </p>
    <p style="font-size:14px;line-height:1.6;color:#525252;margin:0 0 22px;">
      <strong style="color:#FF5A1F;">${totalCount}</strong> ${totalCount === 1 ? 'item' : 'items'} de acțiune găsite în total. Vezi detaliile pe categorii mai jos.
    </p>
    ${sectionRows}
    <div style="margin:24px 0 8px;text-align:center;">
      <a href="${APP_URL}/actions" class="kbi-cta" style="display:inline-block;padding:12px 28px;background:#FF5A1F;color:#FFFFFF;text-decoration:none;font-weight:700;font-size:14px;border:2px solid #0a0a0a;letter-spacing:0.3px;box-sizing:border-box;">
        Deschide Automated Actions
      </a>
    </div>
    <p style="font-size:11.5px;color:#888780;margin:18px 0 0;text-align:center;">
      Vezi listele complete, marchează rezultate ca rezolvate sau exportă pentru campanii.
    </p>
  `;

  const textParts = [`Kimono BI — Raport Automated Actions`, `Magazin: ${storeName}`, `Total: ${totalCount} items de acțiune`, ''];
  for (const r of results) {
    textParts.push(`▸ ${r.rule}: ${r.affectedCount} rezultate`);
    for (const d of r.details.slice(0, 5)) textParts.push(`  • ${d}`);
    if (r.details.length > 5) textParts.push(`  + încă ${r.details.length - 5} rezultate`);
    textParts.push('');
  }
  textParts.push(`Vezi tot: ${APP_URL}/actions`);

  await transporter.sendMail({
    from: FROM,
    to: toEmail,
    subject: `Action Items — ${storeName}: ${totalCount} ${totalCount === 1 ? 'item' : 'items'} | Kimono BI`,
    html: brandedLayout('Raport Automated Actions', body, { eyebrow: 'Action items' }),
    text: textParts.join('\n'),
  });
}

// ============================================================================
// Stripe billing emails
// ============================================================================

function fmtMoney(amountInCents: number, currency: string) {
  const value = (amountInCents / 100).toFixed(2);
  const cur = (currency || 'eur').toUpperCase();
  return `${value} ${cur}`;
}

function fmtDate(timestamp: number | Date | null | undefined): string {
  if (!timestamp) return '—';
  const d = typeof timestamp === 'number' ? new Date(timestamp * 1000) : new Date(timestamp);
  return d.toLocaleDateString('ro-RO', { day: '2-digit', month: 'long', year: 'numeric' });
}

export async function sendInvoicePaidEmail(opts: {
  toEmail: string;
  customerName?: string | null;
  invoiceNumber: string;
  invoiceUrl: string;       // hosted_invoice_url
  invoicePdfUrl?: string;   // invoice_pdf
  amountTotal: number;       // in cents
  currency: string;
  planLabel: string;         // ex: "Growth (Anual)"
  periodStart?: number | null;
  periodEnd?: number | null;
}) {
  const { toEmail, customerName, invoiceNumber, invoiceUrl, invoicePdfUrl, amountTotal, currency, planLabel, periodStart, periodEnd } = opts;
  const amount = fmtMoney(amountTotal, currency);

  const periodLine = periodStart && periodEnd
    ? `<tr><td style="padding:8px 0;color:#5F5E5A;">Perioadă acoperită</td><td style="padding:8px 0;color:#0A0A0A;font-weight:500;text-align:right;">${fmtDate(periodStart)} → ${fmtDate(periodEnd)}</td></tr>`
    : '';

  const body = `
    <p style="font-size:14px;line-height:1.6;color:#0A0A0A;margin:0 0 16px;">
      Salut${customerName ? ' ' + escapeHtml(customerName.split(' ')[0]) : ''},
    </p>
    <p style="font-size:14px;line-height:1.6;color:#0A0A0A;margin:0 0 20px;">
      Plata pentru abonamentul tău Kimono BI a fost procesată cu succes. Factura e atașată mai jos și poate fi descărcată oricând din Stripe.
    </p>

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 20px;border:1px solid #EAEAEA;border-collapse:collapse;background:#FAFAF9;">
      <tr><td style="padding:16px 18px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:13px;">
          <tr><td style="padding:8px 0;color:#5F5E5A;">Plan</td><td style="padding:8px 0;color:#0A0A0A;font-weight:500;text-align:right;">${escapeHtml(planLabel)}</td></tr>
          <tr><td style="padding:8px 0;color:#5F5E5A;">Factură</td><td style="padding:8px 0;color:#0A0A0A;font-weight:500;text-align:right;">${escapeHtml(invoiceNumber)}</td></tr>
          ${periodLine}
          <tr><td style="padding:8px 0;color:#5F5E5A;border-top:1px solid #EAEAEA;">Total</td><td style="padding:8px 0;color:#D85A30;font-weight:700;text-align:right;font-size:15px;border-top:1px solid #EAEAEA;">${amount}</td></tr>
        </table>
      </td></tr>
    </table>

    ${button(invoiceUrl, 'Vezi factura online')}

    ${invoicePdfUrl ? `<p style="font-size:12.5px;line-height:1.5;color:#5F5E5A;margin:0 0 18px;">Sau descarcă PDF-ul direct: <a href="${invoicePdfUrl}" style="color:#D85A30;font-weight:600;">factura ${escapeHtml(invoiceNumber)}.pdf</a>.</p>` : ''}

    <p style="font-size:12.5px;line-height:1.55;color:#5F5E5A;margin:18px 0 0;border-top:1px solid #EAEAEA;padding-top:18px;">
      Toate plățile sunt procesate prin Stripe. Pentru întrebări despre factură sau abonament: <a href="mailto:office@kimonogroup.ro" style="color:#D85A30;">office@kimonogroup.ro</a>.
    </p>
  `;

  await getTransporter().sendMail({
    from: FROM,
    to: toEmail,
    subject: `Factură Kimono BI ${invoiceNumber} — ${amount}`,
    html: brandedLayout('Plată confirmată', body, { eyebrow: `Factură · ${planLabel}` }),
    text: `Plata pentru ${planLabel} a fost confirmată.\n\nFactura ${invoiceNumber}: ${amount}\nVezi online: ${invoiceUrl}${invoicePdfUrl ? '\nDescarcă PDF: ' + invoicePdfUrl : ''}\n\nKimono BI`,
  });
}

export async function sendStoreConnectedEmail(opts: {
  toEmail: string;
  customerName?: string | null;
  storeName: string;
  platform: string;
  storeUrl: string;
}) {
  const { toEmail, customerName, storeName, platform, storeUrl } = opts;

  const body = `
    <p style="font-size:14px;line-height:1.6;color:#0A0A0A;margin:0 0 16px;">
      Salut${customerName ? ' ' + customerName.split(' ')[0] : ''},
    </p>
    <p style="font-size:14px;line-height:1.6;color:#0A0A0A;margin:0 0 18px;">
      Felicitări — magazinul <strong>${storeName}</strong> (${platform}) a fost conectat cu succes la Kimono BI.
    </p>

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 22px;border:1px solid #EAEAEA;background:#FAFAF9;">
      <tr><td style="padding:16px 18px;">
        <div style="font-size:11px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:#5a8a00;margin-bottom:8px;">Ce se întâmplă acum</div>
        <ul style="margin:0;padding-left:18px;font-size:13px;line-height:1.7;color:#0A0A0A;">
          <li>Sincronizăm produse, comenzi și clienți (~5–15 minute pentru primul import).</li>
          <li>Calculăm RFM, Cohorts, LTV și restul rapoartelor automat.</li>
          <li>Primești AI Advisor zilnic și Smart Alerts când datele sunt gata.</li>
        </ul>
      </td></tr>
    </table>

    ${button(storeUrl, 'Vezi statusul magazinului')}

    <p style="font-size:12.5px;line-height:1.55;color:#5F5E5A;margin:18px 0 0;border-top:1px solid #EAEAEA;padding-top:18px;">
      Pe măsură ce datele se importă, dashboard-ul se umple progresiv. Dacă ceva nu pare corect, scrie-ne la <a href="mailto:office@kimonogroup.ro" style="color:#D85A30;font-weight:600;">office@kimonogroup.ro</a>.
    </p>
  `;

  await getTransporter().sendMail({
    from: FROM,
    to: toEmail,
    subject: `${storeName} (${platform}) e conectat la Kimono BI`,
    html: brandedLayout('Magazinul e conectat', body, { eyebrow: `Sincronizare · ${platform}` }),
    text: `Magazinul ${storeName} (${platform}) a fost conectat cu succes.\n\nPrimul sync durează ~5–15 minute. Vezi status: ${storeUrl}\n\nKimono BI`,
  });
}

export async function sendSubscriptionExpiredEmail(opts: {
  toEmail: string;
  customerName?: string | null;
  planLabel: string;
  endedAt: number | null;
  lastInvoiceUrl?: string | null;
  lastInvoicePdfUrl?: string | null;
  resubscribeUrl: string;
}) {
  const { toEmail, customerName, planLabel, endedAt, lastInvoiceUrl, lastInvoicePdfUrl, resubscribeUrl } = opts;

  const lastInvoiceBlock = lastInvoiceUrl
    ? `<p style="font-size:13px;line-height:1.6;color:#0A0A0A;margin:0 0 16px;">
        Ultima ta factură: <a href="${lastInvoiceUrl}" style="color:#D85A30;font-weight:600;">vezi online</a>${lastInvoicePdfUrl ? ` · <a href="${lastInvoicePdfUrl}" style="color:#D85A30;font-weight:600;">PDF</a>` : ''}.
       </p>`
    : '';

  const body = `
    <p style="font-size:14px;line-height:1.6;color:#0A0A0A;margin:0 0 16px;">
      Salut${customerName ? ' ' + escapeHtml(customerName.split(' ')[0]) : ''},
    </p>
    <p style="font-size:14px;line-height:1.6;color:#0A0A0A;margin:0 0 20px;">
      Abonamentul tău <strong>${escapeHtml(planLabel)}</strong> Kimono BI ${endedAt ? `s-a încheiat pe ${fmtDate(endedAt)}` : 'a expirat'}. Contul tău rămâne activ pe planul gratuit, dar funcționalitățile premium au fost suspendate.
    </p>

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 20px;border:1px solid #FBC9B0;border-collapse:collapse;background:linear-gradient(135deg,#FFF8F4 0%,#FFFFFF 100%);">
      <tr><td style="padding:16px 18px;">
        <div style="font-size:11px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:#D85A30;margin-bottom:6px;">Ce poți face</div>
        <ul style="margin:0;padding-left:18px;font-size:13px;line-height:1.7;color:#0A0A0A;">
          <li>Reactivezi abonamentul cu un click — datele tale sunt păstrate intacte.</li>
          <li>Continui pe planul Free (1 magazin, 3 mesaje AI / lună).</li>
          <li>Discuți cu noi despre plan custom: <a href="mailto:office@kimonogroup.ro" style="color:#D85A30;font-weight:600;">office@kimonogroup.ro</a>.</li>
        </ul>
      </td></tr>
    </table>

    ${lastInvoiceBlock}

    ${button(resubscribeUrl, 'Reactivează abonamentul')}

    <p style="font-size:12.5px;line-height:1.55;color:#5F5E5A;margin:18px 0 0;border-top:1px solid #EAEAEA;padding-top:18px;">
      Mulțumim că ai folosit Kimono BI. Datele tale rămân disponibile dacă revii.
    </p>
  `;

  await getTransporter().sendMail({
    from: FROM,
    to: toEmail,
    subject: `Abonamentul Kimono BI ${planLabel} a expirat`,
    html: brandedLayout('Abonamentul a expirat', body, { eyebrow: 'Abonament · Status' }),
    text: `Abonamentul tău ${planLabel} Kimono BI ${endedAt ? 'a expirat pe ' + fmtDate(endedAt) : 'a expirat'}.\n\nReactivează: ${resubscribeUrl}\n${lastInvoiceUrl ? 'Ultima factură: ' + lastInvoiceUrl : ''}\n\nKimono BI`,
  });
}
