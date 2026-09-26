import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction } from '@remix-run/node';
import { json } from '@remix-run/node';
import { Form, useActionData, useLoaderData, useNavigation } from '@remix-run/react';
import { requireUser } from '~/lib/auth/requireAuth.server';
import { inviteUser, getTeamMembers, removeTeamMember } from '~/lib/team';
import { UserPlus, Trash2 } from 'lucide-react';

export const meta: MetaFunction = () => [{ title: 'Echipa — Kimono BI' }];

export async function loader({ request }: LoaderFunctionArgs) {
  const user = await requireUser(request);
  const members = getTeamMembers(user.id);
  return json({ members, userEmail: user.email });
}

export async function action({ request }: ActionFunctionArgs) {
  const user = await requireUser(request);
  const form = await request.formData();
  const intent = String(form.get('intent'));

  if (intent === 'invite') {
    const email = String(form.get('email') || '').trim();
    const role = String(form.get('role') || 'viewer') as 'admin' | 'analyst' | 'viewer';
    if (!email) return json({ error: 'Email-ul este obligatoriu.' }, { status: 400 });
    if (!['admin', 'analyst', 'viewer'].includes(role)) return json({ error: 'Rol invalid.' }, { status: 400 });

    try {
      inviteUser(user.id, email, role);
      return json({ success: email + ' a fost invitat ca ' + role + '.' });
    } catch (err: any) {
      return json({ error: err.message }, { status: 400 });
    }
  }

  if (intent === 'remove') {
    const memberId = String(form.get('memberId'));
    removeTeamMember(user.id, memberId);
    return json({ success: 'Membrul a fost eliminat.' });
  }

  return json({ error: 'Unknown intent' }, { status: 400 });
}

const ROLE_LABELS: Record<string, string> = {
  admin: 'Admin',
  analyst: 'Analyst',
  viewer: 'Viewer',
};

const ROLE_COLORS: Record<string, string> = {
  admin: '#e74c3c',
  analyst: '#f39c12',
  viewer: '#3498db',
};

export default function TeamPage() {
  const { members, userEmail } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const isSubmitting = navigation.state === 'submitting';

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">Echipa</h1>
      </div>

      <div className="info-box">
        <p>
          Invita membri in echipa ta. <strong>Admin</strong> poate modifica setarile, <strong>Analyst</strong> poate vedea si analiza toate datele, <strong>Viewer</strong> poate doar vizualiza rapoartele.
        </p>
      </div>

      {actionData?.success && <div className="alert alert-success">{actionData.success}</div>}
      {actionData?.error && <div className="alert alert-error">{actionData.error}</div>}

      <div className="card" style={{ maxWidth: 600, marginBottom: 'var(--space-md)' }}>
        <h3 style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--color-text-heading)', marginBottom: 'var(--space-md)' }}>Invita un membru</h3>
        <Form method="post">
          <input type="hidden" name="intent" value="invite" />
          <div style={{ display: 'flex', gap: 'var(--space-sm)', alignItems: 'flex-end', flexWrap: 'wrap' }}>
            <div className="form-group" style={{ flex: 2, minWidth: 200, marginBottom: 0 }}>
              <label className="form-label">Email</label>
              <input name="email" type="email" className="form-input" placeholder="coleg@exemplu.com" required />
            </div>
            <div className="form-group" style={{ flex: 1, minWidth: 130, marginBottom: 0 }}>
              <label className="form-label">Rol</label>
              <select name="role" className="form-input">
                <option value="admin">Admin</option>
                <option value="analyst">Analyst</option>
                <option value="viewer">Viewer</option>
              </select>
            </div>
            <button type="submit" className="btn btn-primary" disabled={isSubmitting} style={{ height: 40 }}>
              <UserPlus size={16} /> Invita
            </button>
          </div>
        </Form>
      </div>

      <div className="card">
        <h3 style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--color-text-heading)', marginBottom: 'var(--space-md)' }}>Membri echipa</h3>

        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)', padding: '10px 0', borderBottom: '1px solid var(--color-border)' }}>
          <div style={{ flex: 2, fontWeight: 600, fontSize: '0.8125rem', color: 'var(--color-text-muted)' }}>EMAIL</div>
          <div style={{ flex: 1, fontWeight: 600, fontSize: '0.8125rem', color: 'var(--color-text-muted)' }}>ROL</div>
          <div style={{ width: 80, fontWeight: 600, fontSize: '0.8125rem', color: 'var(--color-text-muted)', textAlign: 'right' }}>ACTIUNI</div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)', padding: '12px 0', borderBottom: '1px solid var(--color-border)' }}>
          <div style={{ flex: 2, fontSize: '0.875rem', color: 'var(--color-text)' }}>{userEmail}</div>
          <div style={{ flex: 1 }}>
            <span style={{ fontSize: '0.75rem', fontWeight: 600, padding: '2px 10px', borderRadius: 12, background: 'rgba(108, 92, 231, 0.15)', color: '#a29bfe' }}>Owner</span>
          </div>
          <div style={{ width: 80 }} />
        </div>

        {members.map((m: any) => (
          <div key={m.id} style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)', padding: '12px 0', borderBottom: '1px solid var(--color-border)' }}>
            <div style={{ flex: 2, fontSize: '0.875rem', color: 'var(--color-text)' }}>{m.email}</div>
            <div style={{ flex: 1 }}>
              <span style={{
                fontSize: '0.75rem', fontWeight: 600, padding: '2px 10px', borderRadius: 12,
                background: ROLE_COLORS[m.role] + '22', color: ROLE_COLORS[m.role],
              }}>
                {ROLE_LABELS[m.role]}
              </span>
            </div>
            <div style={{ width: 80, textAlign: 'right' }}>
              <Form method="post" style={{ display: 'inline' }}>
                <input type="hidden" name="intent" value="remove" />
                <input type="hidden" name="memberId" value={m.id} />
                <button type="submit" className="btn btn-secondary" style={{ padding: '4px 8px', fontSize: '0.75rem' }} title="Elimina">
                  <Trash2 size={14} />
                </button>
              </Form>
            </div>
          </div>
        ))}

        {members.length === 0 && (
          <div style={{ padding: '24px 0', textAlign: 'center', color: 'var(--color-text-muted)', fontSize: '0.875rem' }}>
            Niciun membru invitat inca.
          </div>
        )}
      </div>
    </div>
  );
}
