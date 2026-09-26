import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction } from '@remix-run/node';
import { json } from '@remix-run/node';
import { Form, useActionData, useLoaderData, useNavigation } from '@remix-run/react';
import React from 'react';
import { redirect } from '@remix-run/node';
import { requireUserContext, requireRole } from '~/lib/auth/requireAuth.server';
import { inviteUser, getTeamMembers, removeTeamMember, leaveTeam } from '~/lib/team';
import { sendTeamInviteEmail } from '~/lib/auth/email.server';
import { getInitials } from '~/lib/utils';
import { db } from '~/lib/db.server';
import { UserPlus, Trash2, Users, Shield, Eye, BarChart2, LogOut } from 'lucide-react';

export const meta: MetaFunction = () => [{ title: 'Echipa — Kimono BI' }];

export async function loader({ request }: LoaderFunctionArgs) {
  const ctx = await requireUserContext(request);
  const members = await getTeamMembers(ctx.effectiveOwnerId);
  // Owner display = the actual owner of the team (may differ from current viewer)
  const owner = await db.user.findUnique({
    where: { id: ctx.effectiveOwnerId },
    select: { email: true, fullName: true },
  });
  return json({
    members,
    ownerEmail: owner?.email || ctx.user.email,
    ownerName: owner?.fullName || '',
    role: ctx.role,
    canManage: ctx.role === 'owner' || ctx.role === 'admin',
  });
}

export async function action({ request }: ActionFunctionArgs) {
  const form = await request.formData();
  const intent = String(form.get('intent'));

  // Members can leave on their own — separate gate
  if (intent === 'leave') {
    const ctx = await requireUserContext(request);
    if (ctx.isOwner) {
      return json({ error: 'Owner-ul nu poate părăsi propria echipă.' }, { status: 400 });
    }
    await leaveTeam(ctx.user.id);
    // After leaving they have no team data — redirect to onboarding
    return redirect('/onboarding');
  }

  // Invite/remove require owner + admin
  const ctx = await requireRole(request, ['owner', 'admin']);

  if (intent === 'invite') {
    const email = String(form.get('email') || '').trim().toLowerCase();
    const role = String(form.get('role') || 'viewer') as 'admin' | 'analyst' | 'viewer';
    if (!email) return json({ error: 'Email-ul este obligatoriu.' }, { status: 400 });
    if (!['admin', 'analyst', 'viewer'].includes(role)) return json({ error: 'Rol invalid.' }, { status: 400 });
    let createdMember;
    try {
      createdMember = await inviteUser(ctx.effectiveOwnerId, email, role);
    } catch (err: any) {
      return json({ error: err.message }, { status: 400 });
    }
    let emailSent = false;
    try {
      await sendTeamInviteEmail({
        toEmail: email,
        inviterName: ctx.user.fullName || ctx.user.email,
        inviterCompany: ctx.user.company,
        role,
        inviteToken: createdMember.inviteToken || '',
      });
      emailSent = true;
    } catch (err) {
      console.error('[team] invite email failed for', email, err);
    }
    return json({
      success: emailSent
        ? `Invitație trimisă la ${email} (rol: ${role}).`
        : `${email} a fost invitat (rol: ${role}). Nu am putut trimite email-ul — anunță-l manual.`,
    });
  }

  if (intent === 'remove') {
    const memberId = String(form.get('memberId'));
    await removeTeamMember(ctx.effectiveOwnerId, memberId);
    return json({ success: 'Membrul a fost eliminat.' });
  }

  return json({ error: 'Unknown intent' }, { status: 400 });
}

const ROLE_CONFIG: Record<string, { label: string; color: string; bg: string; Icon: any; desc: string }> = {
  owner:   { label: 'Owner',   color: '#7c3aed', bg: 'rgba(124,58,237,0.1)',  Icon: Shield,   desc: 'Acces complet' },
  admin:   { label: 'Admin',   color: '#D85A30', bg: 'rgba(216,90,48,0.1)',   Icon: Shield,   desc: 'Setări + date' },
  analyst: { label: 'Analyst', color: '#0369a1', bg: 'rgba(3,105,161,0.1)',   Icon: BarChart2, desc: 'Vizualizare date' },
  viewer:  { label: 'Viewer',  color: '#5F5E5A', bg: 'rgba(95,94,90,0.1)',    Icon: Eye,      desc: 'Doar citire' },
};

export default function TeamPage() {
  const { members, ownerEmail, ownerName, role, canManage } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const isSubmitting = navigation.state === 'submitting';

  const initials = getInitials(ownerName || ownerEmail);

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Echipa</h1>
          <p className="page-subtitle">{members.length + 1} membr{members.length === 0 ? 'u' : 'i'} în echipă</p>
        </div>
      </div>

      {actionData?.success && (
        <div className="alert alert-success" style={{ marginBottom: 16 }}>{actionData.success}</div>
      )}
      {actionData?.error && (
        <div className="alert alert-error" style={{ marginBottom: 16 }}>{actionData.error}</div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 320px', gap: 20, alignItems: 'start' }}>
        {/* Members list */}
        <div className="card" style={{ padding: 0 }}>
          <div style={{ padding: '16px 20px', borderBottom: '0.5px solid var(--border-default)' }}>
            <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-primary)' }}>Membri echipă</span>
          </div>

          {/* Owner row */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '14px 20px', borderBottom: '0.5px solid var(--border-default)' }}>
            <div style={{ width: 36, height: 36, borderRadius: '50%', background: 'rgba(216,90,48,0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--kimono-orange)' }}>{initials}</span>
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-primary)' }}>{ownerName || ownerEmail}</div>
              <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{ownerEmail}</div>
            </div>
            <RoleBadge role="owner" />
          </div>

          {members.map((m: any) => {
            const cfg = ROLE_CONFIG[m.role] || ROLE_CONFIG.viewer;
            const mi = getInitials(m.name || m.email);
            return (
              <div key={m.id} style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '14px 20px', borderBottom: '0.5px solid var(--border-default)' }}>
                <div style={{ width: 36, height: 36, borderRadius: '50%', background: cfg.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  <span style={{ fontSize: 13, fontWeight: 600, color: cfg.color }}>{mi}</span>
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, color: 'var(--text-primary)' }}>{m.email}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
                    Invitat {new Date(m.invitedAt).toLocaleDateString('ro-RO')}
                  </div>
                </div>
                <RoleBadge role={m.role} />
                {canManage && (
                  <Form method="post">
                    <input type="hidden" name="intent" value="remove" />
                    <input type="hidden" name="memberId" value={m.id} />
                    <button
                      type="submit"
                      style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 6, borderRadius: 6, color: 'var(--text-secondary)', display: 'flex', alignItems: 'center' }}
                      title="Elimină"
                      disabled={isSubmitting}
                    >
                      <Trash2 size={14} />
                    </button>
                  </Form>
                )}
              </div>
            );
          })}

          {members.length === 0 && (
            <div style={{ padding: '40px 20px', textAlign: 'center' }}>
              <Users size={32} color="var(--text-secondary)" style={{ marginBottom: 10 }} />
              <p style={{ fontSize: 13, color: 'var(--text-secondary)' }}>Niciun membru invitat încă.</p>
            </div>
          )}
        </div>

        {/* Invite form + role info */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {canManage ? (
            <div className="card">
              <p style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-primary)', marginBottom: 14 }}>Invită un membru</p>
              <Form method="post">
                <input type="hidden" name="intent" value="invite" />
                <div style={{ marginBottom: 12 }}>
                  <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: 5, textTransform: 'uppercase', letterSpacing: '0.4px' }}>Email</label>
                  <input
                    name="email"
                    type="email"
                    className="form-input"
                    placeholder="coleg@exemplu.com"
                    required
                    style={{ width: '100%' }}
                  />
                </div>
                <div style={{ marginBottom: 16 }}>
                  <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: 5, textTransform: 'uppercase', letterSpacing: '0.4px' }}>Rol</label>
                  <select name="role" className="form-input" style={{ width: '100%' }}>
                    <option value="admin">Admin — setări + date</option>
                    <option value="analyst">Analyst — vizualizare</option>
                    <option value="viewer">Viewer — citire</option>
                  </select>
                </div>
                <button type="submit" className="btn btn-primary" disabled={isSubmitting} style={{ width: '100%' }}>
                  <UserPlus size={13} />
                  {isSubmitting ? 'Se trimite...' : 'Invită'}
                </button>
              </Form>
            </div>
          ) : (
            <div className="card" style={{ padding: '14px 16px' }}>
              <p style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.55, marginBottom: 14 }}>
                Faci parte din echipa <strong style={{ color: 'var(--text-primary)' }}>{ownerName || ownerEmail}</strong> ca <strong style={{ color: 'var(--text-primary)' }}>{role}</strong>. Doar Owner-ul și Admin-ii pot invita membri noi.
              </p>
              <Form method="post" onSubmit={(e) => { if (!confirm('Ești sigur că vrei să părăsești echipa? Vei pierde accesul la toate datele acestei echipe.')) e.preventDefault(); }}>
                <input type="hidden" name="intent" value="leave" />
                <button
                  type="submit"
                  className="btn btn-secondary"
                  style={{ width: '100%', color: 'var(--danger-text)', borderColor: 'var(--danger-bg-strong)', justifyContent: 'center' }}
                  disabled={isSubmitting}
                >
                  <LogOut size={12} /> Părăsește echipa
                </button>
              </Form>
            </div>
          )}

          <div className="card" style={{ padding: '14px 16px' }}>
            <p style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.4px', marginBottom: 12 }}>Roluri pe scurt</p>
            {(['admin', 'analyst', 'viewer'] as const).map((r) => {
              const cfg = ROLE_CONFIG[r];
              const Icon = cfg.Icon;
              return (
                <div key={r} style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                  <div style={{ width: 28, height: 28, borderRadius: 6, background: cfg.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    <Icon size={13} color={cfg.color} />
                  </div>
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-primary)' }}>{cfg.label}</div>
                    <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{cfg.desc}</div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Permissions matrix — what each role can do */}
      <PermissionsMatrix />
    </div>
  );
}

const PERMISSION_GROUPS: Array<{
  category: string;
  emoji: string;
  rows: Array<{ label: string; desc?: string; perms: [boolean, boolean, boolean, boolean] }>;
}> = [
  {
    category: 'Date & Rapoarte',
    emoji: '📊',
    rows: [
      { label: 'Vede toate paginile de date', desc: 'Dashboard, RFM, Cohorts, LTV, Churn, Forecast, etc.', perms: [true, true, true, true] },
      { label: 'Descarcă PDF / CSV', desc: 'Audit PDF, Narrative PDF, exporturi date', perms: [true, true, true, true] },
      { label: 'AI Advisor (vede recomandări)', desc: 'Insights generate automat zilnic de cron', perms: [true, true, true, true] },
    ],
  },
  {
    category: 'AI Tools (consumă tokens)',
    emoji: '🤖',
    rows: [
      { label: 'Ask AI — întrebări custom', desc: 'Costă tokens OpenAI pentru fiecare întrebare', perms: [true, true, true, false] },
      { label: 'Re-rulează BI Audit', desc: 'Re-generează audit-ul cu AI fresh', perms: [true, true, true, false] },
      { label: 'Re-rulează AI Narrative', desc: 'Re-generează raportul săptămânal', perms: [true, true, true, false] },
    ],
  },
  {
    category: 'Notițe & Distribuire',
    emoji: '✏️',
    rows: [
      { label: 'Adaugă/șterge annotations', desc: 'Note cu date contextuale vizibile pe grafice (Black Friday, campanii)', perms: [true, true, true, false] },
      { label: 'Creează linkuri partajate', desc: 'Share links publice pentru rapoarte', perms: [true, true, true, false] },
    ],
  },
  {
    category: 'Operațiuni',
    emoji: '⚙️',
    rows: [
      { label: 'Sync manual magazine', desc: 'Forțează sincronizarea Shopify/Woo/eMag', perms: [true, true, true, false] },
      { label: 'Trimite Email Digest manual', desc: 'Trimite raport săptămânal pe email în numele companiei', perms: [true, true, false, false] },
      { label: 'Execută Automated Actions', desc: 'Acțiuni care MODIFICĂ Shopify (campanii winback, alerte stoc, etc.)', perms: [true, true, false, false] },
    ],
  },
  {
    category: 'Configurare',
    emoji: '🏪',
    rows: [
      { label: 'Adaugă magazin nou', desc: 'Conectare Shopify sau eMag Marketplace', perms: [true, true, false, false] },
      { label: 'Șterge magazin', desc: 'Operațiune ireversibilă — șterge toate datele', perms: [true, true, false, false] },
      { label: 'Modifică setări magazin', desc: 'Limba AI, ton, threshold stoc, RFM, email alerte', perms: [true, true, false, false] },
      { label: 'Conectare Google Analytics', desc: 'OAuth GA4 — date partajate per echipă', perms: [true, true, false, false] },
    ],
  },
  {
    category: 'Echipa & Cont',
    emoji: '👥',
    rows: [
      { label: 'Invită membri noi', desc: 'Trimite invitație email cu rol asignat', perms: [true, true, false, false] },
      { label: 'Elimină membri', desc: 'Revocă accesul unui membru la echipă', perms: [true, true, false, false] },
      { label: 'Modifică profil propriu', desc: 'Nume, parolă, preferințe personale', perms: [true, true, true, true] },
      { label: 'Billing & upgrade plan', desc: 'Doar Owner-ul plătește pentru echipă', perms: [true, false, false, false] },
    ],
  },
];

function PermissionsMatrix() {
  return (
    <div className="card" style={{ marginTop: 24, overflowX: 'auto' }}>
      <div style={{ padding: '14px 20px', borderBottom: '0.5px solid var(--border-default)' }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 4 }}>
          Ce poate face fiecare rol
        </div>
        <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
          Folosește această matrice ca să decizi ce rol să atribui fiecărui coleg.
        </div>
      </div>

      <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 720 }}>
        <thead>
          <tr style={{ borderBottom: '0.5px solid var(--border-default)' }}>
            <th style={{ textAlign: 'left', padding: '10px 20px', fontSize: 10, fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Acțiune</th>
            <th style={{ textAlign: 'center', padding: '10px 12px', fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px', width: 90, color: ROLE_CONFIG.owner.color }}>Owner</th>
            <th style={{ textAlign: 'center', padding: '10px 12px', fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px', width: 90, color: ROLE_CONFIG.admin.color }}>Admin</th>
            <th style={{ textAlign: 'center', padding: '10px 12px', fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px', width: 90, color: ROLE_CONFIG.analyst.color }}>Analyst</th>
            <th style={{ textAlign: 'center', padding: '10px 12px', fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px', width: 90, color: ROLE_CONFIG.viewer.color }}>Viewer</th>
          </tr>
        </thead>
        <tbody>
          {PERMISSION_GROUPS.map((group) => (
            <React.Fragment key={group.category}>
              <tr style={{ background: 'var(--bg-tertiary)' }}>
                <td colSpan={5} style={{ padding: '8px 20px', fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.4px' }}>
                  <span style={{ marginRight: 8 }}>{group.emoji}</span>{group.category}
                </td>
              </tr>
              {group.rows.map((row, idx) => (
                <tr key={`${group.category}-${idx}`} style={{ borderBottom: '0.5px solid var(--border-default)' }}>
                  <td style={{ padding: '12px 20px', verticalAlign: 'top' }}>
                    <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-primary)', marginBottom: row.desc ? 2 : 0 }}>{row.label}</div>
                    {row.desc && (
                      <div style={{ fontSize: 11, color: 'var(--text-secondary)', lineHeight: 1.4 }}>{row.desc}</div>
                    )}
                  </td>
                  {row.perms.map((allowed, i) => (
                    <td key={i} style={{ textAlign: 'center', padding: '12px 12px', verticalAlign: 'top' }}>
                      {allowed ? (
                        <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 22, height: 22, borderRadius: '50%', background: 'rgba(22,163,74,0.12)', color: '#16a34a', fontSize: 13, fontWeight: 700 }}>✓</span>
                      ) : (
                        <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 22, height: 22, color: 'var(--text-tertiary)', fontSize: 14 }}>—</span>
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </React.Fragment>
          ))}
        </tbody>
      </table>

      <div style={{ padding: '14px 20px', borderTop: '0.5px solid var(--border-default)', background: 'var(--bg-tertiary)' }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.4px', marginBottom: 8 }}>Recomandări rapide</div>
        <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.6 }}>
          <li><strong style={{ color: ROLE_CONFIG.admin.color }}>Admin</strong> — pentru co-fondator, manager operațional, persoană de încredere care gestionează magazinele și echipa în lipsa ta.</li>
          <li><strong style={{ color: ROLE_CONFIG.analyst.color }}>Analyst</strong> — pentru analiști de date, marketing manager, freelancer care face audit/strategy. Folosește AI și scrie note, dar nu modifică magazinul.</li>
          <li><strong style={{ color: ROLE_CONFIG.viewer.color }}>Viewer</strong> — pentru CEO/CFO/board member care vrea doar să vadă cifrele. Zero modificări, zero costuri AI.</li>
        </ul>
      </div>
    </div>
  );
}

function RoleBadge({ role }: { role: string }) {
  const cfg = ROLE_CONFIG[role] || ROLE_CONFIG.viewer;
  return (
    <span style={{
      fontSize: 10,
      fontWeight: 600,
      padding: '2px 8px',
      borderRadius: 99,
      background: cfg.bg,
      color: cfg.color,
      flexShrink: 0,
    }}>
      {cfg.label}
    </span>
  );
}
