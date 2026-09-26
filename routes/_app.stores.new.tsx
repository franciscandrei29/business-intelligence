import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction } from '@remix-run/node';
import { json, redirect } from '@remix-run/node';
import { Form, Link, useActionData, useLoaderData, useNavigation, useSearchParams } from '@remix-run/react';
import { requireUser } from '~/lib/auth/requireAuth.server';
import { encrypt } from '~/lib/auth/crypto.server';
import { db } from '~/lib/db.server';
import { getProvider } from '~/lib/connectors/index';
import { ArrowLeft, CheckCircle } from 'lucide-react';
import { useState } from 'react';

export const meta: MetaFunction = () => [{ title: 'Adauga magazin — Kimono BI' }];

export async function loader({ request }: LoaderFunctionArgs) {
  const user = await requireUser(request);
  return json({ userId: user.id });
}

async function checkPlanLimits(userId: string) {
  const sub = await db.subscription.findUnique({ where: { userId } });
  const storeCount = await db.storeConnection.count({ where: { userId } });
  const planLimits: Record<string, number> = { FREE: 1, STARTER: 1, GROWTH: 3, SCALE: 10 };
  const maxStores = planLimits[sub?.plan || 'FREE'] || 1;
  if (storeCount >= maxStores) {
    throw new Error(`Planul tau permite maxim ${maxStores} magazin(e). Fa upgrade pentru a adauga mai multe.`);
  }
}

export async function action({ request }: ActionFunctionArgs) {
  const user = await requireUser(request);
  const form = await request.formData();
  const platform = String(form.get('platform') || '').toUpperCase();
  const name = String(form.get('name') || '').trim();
  const domain = String(form.get('domain') || '').trim().replace(/^https?:\/\//, '').replace(/\/$/, '');
  const intent = String(form.get('intent') || '');

  if (!name || !domain) {
    return json({ error: 'Numele si domeniul sunt obligatorii.' }, { status: 400 });
  }

  try {
    await checkPlanLimits(user.id);
  } catch (err: any) {
    return json({ error: err.message }, { status: 400 });
  }

  if (platform === 'SHOPIFY') {
    const accessToken = String(form.get('accessToken') || '').trim();
    if (!accessToken) {
      return json({ error: 'Access Token-ul Shopify este obligatoriu.' }, { status: 400 });
    }

    const encryptedToken = encrypt(accessToken);

    const store = await db.storeConnection.create({
      data: {
        userId: user.id,
        platform: 'SHOPIFY',
        name,
        domain,
        shopifyAccessToken: encryptedToken,
        syncStatus: 'PENDING',
      },
    });

    try {
      const provider = await getProvider(store);
      const result = await provider.testConnection();

      if (!result.success) {
        await db.storeConnection.delete({ where: { id: store.id } });
        return json({ error: `Conexiunea a esuat: ${result.error}` }, { status: 400 });
      }

      if (result.shopName) {
        await db.storeConnection.update({
          where: { id: store.id },
          data: { name: result.shopName },
        });
      }
    } catch (err: any) {
      await db.storeConnection.delete({ where: { id: store.id } });
      return json({ error: `Eroare la testarea conexiunii: ${err.message}` }, { status: 400 });
    }

    return redirect(`/stores/${store.id}`);
  }

  if (platform === 'WOOCOMMERCE') {
    // Auto auth flow — create pending store and redirect to WC auth
    if (intent === 'wc-auto-auth') {
      const store = await db.storeConnection.create({
        data: {
          userId: user.id,
          platform: 'WOOCOMMERCE',
          name,
          domain,
          syncStatus: 'PENDING',
        },
      });

      const cleanDomain = domain.replace(/^https?:\/\//, '').replace(/\/$/, '');
      const returnUrl = encodeURIComponent('https://bi.kimonogroup.ro/stores?wc_success=true');
      const callbackUrl = encodeURIComponent('https://bi.kimonogroup.ro/api/wc-auth-callback');
      const authUrl = `https://${cleanDomain}/wc-auth/v1/authorize?app_name=Kimono%20BI&scope=read_write&user_id=${user.id}&return_url=${returnUrl}&callback_url=${callbackUrl}`;

      return redirect(authUrl);
    }

    // Manual flow
    const consumerKey = String(form.get('consumerKey') || '').trim();
    const consumerSecret = String(form.get('consumerSecret') || '').trim();
    const apiUrl = String(form.get('apiUrl') || '').trim().replace(/\/$/, '') || `https://${domain}`;

    if (!consumerKey || !consumerSecret) {
      return json({ error: 'Consumer Key si Consumer Secret sunt obligatorii.' }, { status: 400 });
    }

    const encryptedKey = encrypt(consumerKey);
    const encryptedSecret = encrypt(consumerSecret);

    const store = await db.storeConnection.create({
      data: {
        userId: user.id,
        platform: 'WOOCOMMERCE',
        name,
        domain,
        wooConsumerKey: encryptedKey,
        wooConsumerSecret: encryptedSecret,
        wooApiUrl: apiUrl,
        syncStatus: 'PENDING',
      },
    });

    try {
      const provider = await getProvider(store);
      const result = await provider.testConnection();

      if (!result.success) {
        await db.storeConnection.delete({ where: { id: store.id } });
        return json({ error: `Conexiunea a esuat: ${result.error}` }, { status: 400 });
      }

      if (result.shopName && result.shopName !== 'WooCommerce Store') {
        await db.storeConnection.update({
          where: { id: store.id },
          data: { name: result.shopName },
        });
      }
    } catch (err: any) {
      await db.storeConnection.delete({ where: { id: store.id } });
      return json({ error: `Eroare la testarea conexiunii: ${err.message}` }, { status: 400 });
    }

    return redirect(`/stores/${store.id}`);
  }

  if (platform === 'EMAG') {
    const apiKey = String(form.get('apiKey') || '').trim();
    const apiSecret = String(form.get('apiSecret') || '').trim();

    if (!apiKey || !apiSecret) {
      return json({ error: 'API Key si API Secret sunt obligatorii.' }, { status: 400 });
    }

    const encryptedKey = encrypt(apiKey);
    const encryptedSecret = encrypt(apiSecret);

    const store = await db.storeConnection.create({
      data: {
        userId: user.id,
        platform: 'EMAG',
        name,
        domain: 'marketplace.emag.ro',
        wooConsumerKey: encryptedKey,
        wooConsumerSecret: encryptedSecret,
        wooApiUrl: 'https://marketplace-api.emag.ro/api-3',
        syncStatus: 'PENDING',
      },
    });

    try {
      const provider = await getProvider(store);
      const result = await provider.testConnection();

      if (!result.success) {
        await db.storeConnection.delete({ where: { id: store.id } });
        return json({ error: `Conexiunea a esuat: ${result.error}` }, { status: 400 });
      }

      if (result.shopName) {
        await db.storeConnection.update({
          where: { id: store.id },
          data: { name: result.shopName },
        });
      }
    } catch (err: any) {
      await db.storeConnection.delete({ where: { id: store.id } });
      return json({ error: `Eroare la testarea conexiunii: ${err.message}` }, { status: 400 });
    }

    return redirect(`/stores/${store.id}`);
  }

  return json({ error: 'Platforma invalida.' }, { status: 400 });
}

export default function NewStorePage() {
  const { userId } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const isSubmitting = navigation.state === 'submitting';
  const [searchParams] = useSearchParams();
  const platform = searchParams.get('platform') || '';
  const wcSuccess = searchParams.get('wc_success');

  if (!platform) {
    return (
      <div>
        <div className="page-header">
          <Link to="/stores" style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-xs)', color: 'var(--color-text-muted)', fontSize: '0.875rem', marginBottom: 'var(--space-sm)' }}>
            <ArrowLeft size={16} />
            Inapoi la magazine
          </Link>
          <h1 className="page-title">Adauga magazin</h1>
          <p className="page-subtitle">Alege platforma pe care o folosesti</p>
        </div>

        {wcSuccess && (
          <div className="alert alert-success" style={{ marginBottom: 'var(--space-md)', display: 'flex', alignItems: 'center', gap: 'var(--space-sm)' }}>
            <CheckCircle size={18} />
            Magazinul WooCommerce a fost conectat cu succes!
          </div>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 'var(--space-md)' }}>
          <Link to="/stores/new?platform=shopify" className="card" style={{ textDecoration: 'none', textAlign: 'center', padding: 'var(--space-2xl)' }}>
            <div style={{ fontSize: '2.5rem', marginBottom: 'var(--space-md)' }}>🛍️</div>
            <h3 style={{ color: '#96bf48', fontSize: '1.25rem', fontWeight: 700, marginBottom: 'var(--space-sm)' }}>Shopify</h3>
            <p style={{ color: 'var(--color-text-muted)', fontSize: '0.875rem' }}>
              Conecteaza prin Admin API access token
            </p>
          </Link>

          <Link to="/stores/new?platform=woocommerce" className="card" style={{ textDecoration: 'none', textAlign: 'center', padding: 'var(--space-2xl)' }}>
            <div style={{ fontSize: '2.5rem', marginBottom: 'var(--space-md)' }}>🔌</div>
            <h3 style={{ color: '#7e64b5', fontSize: '1.25rem', fontWeight: 700, marginBottom: 'var(--space-sm)' }}>WooCommerce</h3>
            <p style={{ color: 'var(--color-text-muted)', fontSize: '0.875rem' }}>
              Conectare automata cu un click sau manual prin API Key
            </p>
          </Link>

          <Link to="/stores/new?platform=emag" className="card" style={{ textDecoration: 'none', textAlign: 'center', padding: 'var(--space-2xl)' }}>
            <div style={{ fontSize: '2.5rem', marginBottom: 'var(--space-md)' }}>🏪</div>
            <h3 style={{ color: '#f0a030', fontSize: '1.25rem', fontWeight: 700, marginBottom: 'var(--space-sm)' }}>eMag Marketplace</h3>
            <p style={{ color: 'var(--color-text-muted)', fontSize: '0.875rem' }}>
              Conecteaza cu contul tau eMag Marketplace
            </p>
          </Link>
        </div>
      </div>
    );
  }

  if (platform === 'emag') {
    return <EmagForm actionData={actionData} isSubmitting={isSubmitting} />;
  }

  if (platform === 'woocommerce') {
    return <WooCommerceForm actionData={actionData} isSubmitting={isSubmitting} userId={userId} />;
  }

  // Shopify form
  return (
    <div>
      <div className="page-header">
        <Link to="/stores/new" style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-xs)', color: 'var(--color-text-muted)', fontSize: '0.875rem', marginBottom: 'var(--space-sm)' }}>
          <ArrowLeft size={16} />
          Inapoi la selectie platforma
        </Link>
        <h1 className="page-title">Conecteaza magazin Shopify</h1>
        <p className="page-subtitle">Introdu datele magazinului tau Shopify</p>
      </div>

      <div className="card" style={{ maxWidth: 560 }}>
        <Form method="post">
          <input type="hidden" name="platform" value="shopify" />

          {actionData?.error && (
            <div className="alert alert-error">{actionData.error}</div>
          )}

          <div className="form-group">
            <label className="form-label" htmlFor="name">Numele magazinului</label>
            <input
              id="name"
              name="name"
              type="text"
              className="form-input"
              placeholder="Magazinul meu"
              required
              autoFocus
            />
          </div>

          <div className="form-group">
            <label className="form-label" htmlFor="domain">Domeniul Shopify</label>
            <input
              id="domain"
              name="domain"
              type="text"
              className="form-input"
              placeholder="magazinul-meu.myshopify.com"
              required
            />
            <small style={{ color: 'var(--color-text-muted)', fontSize: '0.75rem' }}>
              Formatul: numele-magazinului.myshopify.com
            </small>
          </div>

          <div className="form-group">
            <label className="form-label" htmlFor="accessToken">Admin API Access Token</label>
            <input
              id="accessToken"
              name="accessToken"
              type="password"
              className="form-input"
              placeholder="shpat_..."
              required
            />
            <small style={{ color: 'var(--color-text-muted)', fontSize: '0.75rem' }}>
              Shopify Admin {'>'} Settings {'>'} Apps {'>'} Develop apps {'>'} Create app {'>'} Admin API access token.
              Scopes necesare: read_products, write_products, read_orders, read_customers, read_inventory.
            </small>
          </div>

          <button type="submit" className="btn btn-primary btn-full" disabled={isSubmitting}>
            {isSubmitting ? 'Se testeaza conexiunea...' : 'Testeaza si conecteaza'}
          </button>
        </Form>
      </div>
    </div>
  );
}

/* ─── WooCommerce form with auto/manual tabs ─── */
function WooCommerceForm({ actionData, isSubmitting, userId }: { actionData: any; isSubmitting: boolean; userId: string }) {
  const [mode, setMode] = useState<'auto' | 'manual'>('auto');

  return (
    <div>
      <div className="page-header">
        <Link to="/stores/new" style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-xs)', color: 'var(--color-text-muted)', fontSize: '0.875rem', marginBottom: 'var(--space-sm)' }}>
          <ArrowLeft size={16} />
          Inapoi la selectie platforma
        </Link>
        <h1 className="page-title">Conecteaza magazin WooCommerce</h1>
        <p className="page-subtitle">Alege metoda de conectare</p>
      </div>

      {/* Tab switcher */}
      <div style={{ display: 'flex', gap: '2px', marginBottom: 'var(--space-md)', maxWidth: 560, background: 'var(--color-bg-tertiary)', borderRadius: 'var(--radius-md)', padding: '3px' }}>
        <button
          type="button"
          onClick={() => setMode('auto')}
          style={{
            flex: 1,
            padding: 'var(--space-sm) var(--space-md)',
            border: 'none',
            borderRadius: 'var(--radius-sm)',
            cursor: 'pointer',
            fontSize: '0.875rem',
            fontWeight: 600,
            background: mode === 'auto' ? 'var(--color-bg-secondary)' : 'transparent',
            color: mode === 'auto' ? 'var(--color-primary)' : 'var(--color-text-muted)',
            transition: 'all 0.2s',
          }}
        >
          Conectare automata (Recomandat)
        </button>
        <button
          type="button"
          onClick={() => setMode('manual')}
          style={{
            flex: 1,
            padding: 'var(--space-sm) var(--space-md)',
            border: 'none',
            borderRadius: 'var(--radius-sm)',
            cursor: 'pointer',
            fontSize: '0.875rem',
            fontWeight: 600,
            background: mode === 'manual' ? 'var(--color-bg-secondary)' : 'transparent',
            color: mode === 'manual' ? 'var(--color-primary)' : 'var(--color-text-muted)',
            transition: 'all 0.2s',
          }}
        >
          Conectare manuala
        </button>
      </div>

      {mode === 'auto' ? (
        <div className="card" style={{ maxWidth: 560 }}>
          <div style={{ marginBottom: 'var(--space-md)', padding: 'var(--space-sm) var(--space-md)', background: 'rgba(126, 100, 181, 0.1)', borderRadius: 'var(--radius-sm)', border: '1px solid rgba(126, 100, 181, 0.2)' }}>
            <p style={{ fontSize: '0.8125rem', color: 'var(--color-text-secondary)', margin: 0 }}>
              WooCommerce va genera automat cheile API. Vei fi redirectionat catre magazinul tau pentru aprobare.
            </p>
          </div>
          <Form method="post">
            <input type="hidden" name="platform" value="woocommerce" />
            <input type="hidden" name="intent" value="wc-auto-auth" />

            {actionData?.error && (
              <div className="alert alert-error">{actionData.error}</div>
            )}

            <div className="form-group">
              <label className="form-label" htmlFor="auto-name">Numele magazinului</label>
              <input
                id="auto-name"
                name="name"
                type="text"
                className="form-input"
                placeholder="Magazinul meu"
                required
                autoFocus
              />
            </div>

            <div className="form-group">
              <label className="form-label" htmlFor="auto-domain">Domeniul site-ului</label>
              <input
                id="auto-domain"
                name="domain"
                type="text"
                className="form-input"
                placeholder="magazinul-meu.ro"
                required
              />
              <small style={{ color: 'var(--color-text-muted)', fontSize: '0.75rem' }}>
                Introdu doar domeniul (ex: magazinul-meu.ro), fara https://
              </small>
            </div>

            <button type="submit" className="btn btn-primary btn-full" disabled={isSubmitting}>
              {isSubmitting ? 'Se pregateste...' : 'Conecteaza'}
            </button>
          </Form>

          <div style={{ marginTop: 'var(--space-md)', paddingTop: 'var(--space-md)', borderTop: '1px solid var(--color-border)' }}>
            <h4 style={{ fontSize: '0.8125rem', fontWeight: 600, color: 'var(--color-text-heading)', marginBottom: 'var(--space-sm)' }}>Cum functioneaza:</h4>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-xs)' }}>
              {[
                'Introdu domeniul si click pe "Conecteaza"',
                'Vei fi redirectionat in WP Admin-ul magazinului tau',
                'WooCommerce iti va arata ecranul de aprobare',
                'Click "Approve" — cheile API se genereaza automat',
                'Esti redirectionat inapoi in Kimono BI',
              ].map((step, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 'var(--space-sm)' }}>
                  <span style={{
                    width: 22, height: 22, borderRadius: '50%',
                    background: 'rgba(126, 100, 181, 0.15)',
                    color: '#7e64b5',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: '0.6875rem', fontWeight: 700, flexShrink: 0,
                    marginTop: 1,
                  }}>
                    {i + 1}
                  </span>
                  <span style={{ fontSize: '0.8125rem', color: 'var(--color-text-muted)' }}>{step}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : (
        <>
          <div className="card" style={{ maxWidth: 560 }}>
            <Form method="post">
              <input type="hidden" name="platform" value="woocommerce" />

              {actionData?.error && (
                <div className="alert alert-error">{actionData.error}</div>
              )}

              <div className="form-group">
                <label className="form-label" htmlFor="name">Numele magazinului</label>
                <input
                  id="name"
                  name="name"
                  type="text"
                  className="form-input"
                  placeholder="Magazinul meu"
                  required
                  autoFocus
                />
              </div>

              <div className="form-group">
                <label className="form-label" htmlFor="domain">Domeniul site-ului</label>
                <input
                  id="domain"
                  name="domain"
                  type="text"
                  className="form-input"
                  placeholder="magazinul-meu.ro"
                  required
                />
              </div>

              <div className="form-group">
                <label className="form-label" htmlFor="apiUrl">URL API (optional)</label>
                <input
                  id="apiUrl"
                  name="apiUrl"
                  type="text"
                  className="form-input"
                  placeholder="https://magazinul-meu.ro"
                />
                <small style={{ color: 'var(--color-text-muted)', fontSize: '0.75rem' }}>
                  Lasa gol pentru a folosi https://domeniu. Modifica doar daca API-ul este pe alt URL.
                </small>
              </div>

              <div className="form-group">
                <label className="form-label" htmlFor="consumerKey">Consumer Key</label>
                <input
                  id="consumerKey"
                  name="consumerKey"
                  type="password"
                  className="form-input"
                  placeholder="ck_..."
                  required
                />
              </div>

              <div className="form-group">
                <label className="form-label" htmlFor="consumerSecret">Consumer Secret</label>
                <input
                  id="consumerSecret"
                  name="consumerSecret"
                  type="password"
                  className="form-input"
                  placeholder="cs_..."
                  required
                />
                <small style={{ color: 'var(--color-text-muted)', fontSize: '0.75rem' }}>
                  WP Admin {'>'} WooCommerce {'>'} Settings {'>'} Advanced {'>'} REST API {'>'} Add key.
                  Permisiuni necesare: Read/Write.
                </small>
              </div>

              <button type="submit" className="btn btn-primary btn-full" disabled={isSubmitting}>
                {isSubmitting ? 'Se testeaza conexiunea...' : 'Testeaza si conecteaza'}
              </button>
            </Form>
          </div>

          <div className="card" style={{ maxWidth: 560, marginTop: 'var(--space-md)' }}>
            <h3 style={{ fontSize: '0.9375rem', fontWeight: 600, color: 'var(--color-text-heading)', marginBottom: 'var(--space-sm)' }}>
              Cum generez Consumer Key?
            </h3>
            <ol style={{ color: 'var(--color-text-muted)', fontSize: '0.875rem', paddingLeft: 'var(--space-lg)', display: 'flex', flexDirection: 'column', gap: 'var(--space-xs)' }}>
              <li>Intra in WP Admin al magazinului tau</li>
              <li>Navigheaza la <strong>WooCommerce {'>'} Settings {'>'} Advanced {'>'} REST API</strong></li>
              <li>Click pe <strong>Add key</strong></li>
              <li>Descriere: &quot;Kimono BI&quot;, User: admin-ul tau, Permissions: <strong>Read/Write</strong></li>
              <li>Click <strong>Generate API key</strong></li>
              <li>Copiaza Consumer Key (ck_...) si Consumer Secret (cs_...)</li>
            </ol>
          </div>
        </>
      )}
    </div>
  );
}

/* ─── eMag Marketplace form ─── */
function EmagForm({ actionData, isSubmitting }: { actionData: any; isSubmitting: boolean }) {
  return (
    <div>
      <div className="page-header">
        <Link to="/stores/new" style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-xs)', color: 'var(--color-text-muted)', fontSize: '0.875rem', marginBottom: 'var(--space-sm)' }}>
          <ArrowLeft size={16} />
          Inapoi la selectie platforma
        </Link>
        <h1 className="page-title">Conecteaza eMag Marketplace</h1>
        <p className="page-subtitle">Foloseste contul tau de pe marketplace.emag.ro</p>
      </div>

      <div className="info-box" style={{ maxWidth: 560 }}>
        <p>Introdu aceleasi credentiale cu care te loghezi pe <strong>marketplace.emag.ro</strong>. Datele sunt criptate si stocate in siguranta. Asigura-te ca ai adaugat IP-ul <strong>91.200.121.88</strong> in lista de IP-uri din panoul eMag (Detalii tehnice {'>'} Adrese IP).</p>
      </div>

      <div className="card" style={{ maxWidth: 560 }}>
        <Form method="post">
          <input type="hidden" name="platform" value="emag" />
          <input type="hidden" name="domain" value="marketplace.emag.ro" />

          {actionData?.error && (
            <div className="alert alert-error">{actionData.error}</div>
          )}

          <div className="form-group">
            <label className="form-label" htmlFor="emag-name">Numele magazinului</label>
            <input
              id="emag-name"
              name="name"
              type="text"
              className="form-input"
              placeholder="Magazinul meu pe eMag"
              required
              autoFocus
            />
          </div>

          <div className="form-group">
            <label className="form-label" htmlFor="apiKey">Email cont eMag Marketplace</label>
            <input
              id="apiKey"
              name="apiKey"
              type="email"
              className="form-input"
              placeholder="email@exemplu.com"
              required
            />
            <small style={{ color: 'var(--color-text-muted)', fontSize: '0.75rem' }}>
              Email-ul cu care te loghezi pe marketplace.emag.ro
            </small>
          </div>

          <div className="form-group">
            <label className="form-label" htmlFor="apiSecret">Parola cont eMag Marketplace</label>
            <input
              id="apiSecret"
              name="apiSecret"
              type="password"
              className="form-input"
              placeholder="Parola contului eMag"
              required
            />
          </div>

          <button type="submit" className="btn btn-primary btn-full" disabled={isSubmitting}>
            {isSubmitting ? 'Se testeaza conexiunea...' : 'Conecteaza eMag'}
          </button>
        </Form>
      </div>
    </div>
  );
}
