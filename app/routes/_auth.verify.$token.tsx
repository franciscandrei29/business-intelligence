import type { LoaderFunctionArgs, MetaFunction } from '@remix-run/node';
import { json } from '@remix-run/node';
import { Link, useLoaderData } from '@remix-run/react';
import { db } from '~/lib/db.server';

export const meta: MetaFunction = () => [{ title: 'Verificare cont — Kimono BI' }];

export async function loader({ params }: LoaderFunctionArgs) {
  const { token } = params;
  if (!token) {
    return json({ error: 'Token lipsa.', success: false });
  }

  const user = await db.user.findFirst({ where: { verifyToken: token } });
  if (!user) {
    return json({ error: 'Token invalid sau expirat.', success: false });
  }

  if (user.emailVerified) {
    return json({ error: null, success: true, alreadyVerified: true });
  }

  await db.user.update({
    where: { id: user.id },
    data: {
      emailVerified: true,
      verifyToken: null,
    },
  });

  return json({ error: null, success: true, alreadyVerified: false });
}

export default function VerifyPage() {
  const data = useLoaderData<typeof loader>();

  return (
    <div className="auth-page">
      <div className="auth-card">
        <div className="auth-logo">
          <h1><img src="/logo-kimono-bi.svg" alt="Kimono BI" style={{ height: 32, width: 'auto' }} /></h1>
        </div>

        <div className="card" style={{ textAlign: 'center' }}>
          {data.error ? (
            <>
              <div className="alert alert-error">{data.error}</div>
              <p style={{ color: 'var(--color-text-muted)', marginTop: 'var(--space-md)' }}>
                <Link to="/register">Incearca din nou</Link>
              </p>
            </>
          ) : (
            <>
              <div className="alert alert-success">
                {data.alreadyVerified
                  ? 'Contul tau este deja verificat.'
                  : 'Contul a fost verificat cu succes!'}
              </div>
              <Link to="/login" className="btn btn-primary" style={{ marginTop: 'var(--space-md)' }}>
                Conecteaza-te
              </Link>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
