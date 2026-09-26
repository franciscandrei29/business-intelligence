import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction } from '@remix-run/node';
import { json, redirect } from '@remix-run/node';
import { Form, Link, useActionData, useLoaderData, useNavigation, useSearchParams } from '@remix-run/react';
import { requireUser, requireUserContext, requireRole } from '~/lib/auth/requireAuth.server';
import { encrypt } from '~/lib/auth/crypto.server';
import { db } from '~/lib/db.server';
import { getProvider } from '~/lib/connectors/index';
import { ArrowLeft, CheckCircle } from 'lucide-react';
import React, { useState } from 'react';

export const meta: MetaFunction = () => [{ title: 'Adauga magazin — Kimono BI' }];

export async function loader({ request }: LoaderFunctionArgs) {
  // Owner + admin can add stores; viewer/analyst blocked
  const ctx = await requireRole(request, ['owner', 'admin']);
  return json({ userId: ctx.effectiveOwnerId });
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
  const ctx = await requireRole(request, ['owner', 'admin']);
  const user = ctx.user;
  const form = await request.formData();
  const platform = String(form.get('platform') || '').toUpperCase();
  const name = String(form.get('name') || '').trim();
  const domain = String(form.get('domain') || form.get('siteUrl') || '').trim().replace(/^https?:\/\//, '').replace(/\/$/, '');
  const intent = String(form.get('intent') || '');

  if (!name || !domain) {
    return json({ error: 'Numele si domeniul sunt obligatorii.' }, { status: 400 });
  }

  try {
    await checkPlanLimits(ctx.effectiveOwnerId);
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
        userId: ctx.effectiveOwnerId,
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
        return json({
          error: result.error || 'Conexiunea a eșuat.',
          errorKind: result.errorKind || 'unknown',
          missingScopes: result.missingScopes || [],
        }, { status: 400 });
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

    // Welcome email + activity (best-effort)
    try {
      const { sendStoreConnectedEmail } = await import('~/lib/auth/email.server');
      await sendStoreConnectedEmail({
        toEmail: ctx.user.email,
        customerName: ctx.user.fullName,
        storeName: name,
        platform: 'Shopify',
        storeUrl: `${process.env.APP_URL || 'https://bi.kimonogroup.ro'}/stores/${store.id}`,
      });
    } catch (err) {
      console.error('[stores.new] sendStoreConnectedEmail failed:', err);
    }

    try {
      const { logActivity } = await import('~/lib/activity.server');
      await logActivity({
        type: 'store_connected',
        description: `${ctx.user.fullName || ctx.user.email} a conectat magazinul ${name} (Shopify)`,
        actorUserId: ctx.user.id,
        targetUserId: ctx.effectiveOwnerId,
        storeId: store.id,
        metadata: { platform: 'SHOPIFY', domain },
      });
    } catch {}

    return redirect(`/stores/${store.id}`);
  }

  if (platform === 'WOOCOMMERCE') {
    // Auto auth flow — create pending store and redirect to WC auth
    if (intent === 'wc-auto-auth') {
      const store = await db.storeConnection.create({
        data: {
          userId: ctx.effectiveOwnerId,
          platform: 'WOOCOMMERCE',
          name,
          domain,
          syncStatus: 'PENDING',
        },
      });

      const cleanDomain = domain.replace(/^https?:\/\//, '').replace(/\/$/, '');
      const returnUrl = encodeURIComponent('https://bi.kimonogroup.ro/stores?wc_success=true');
      const callbackUrl = encodeURIComponent('https://bi.kimonogroup.ro/api/wc-auth-callback');
      const authUrl = `https://${cleanDomain}/wc-auth/v1/authorize?app_name=Kimono%20BI&scope=read_write&user_id=${ctx.effectiveOwnerId}&return_url=${returnUrl}&callback_url=${callbackUrl}`;

      return redirect(authUrl);
    }

    // Kimono BI Plugin flow
    if (intent === 'wc-plugin') {
      const pluginApiKey = String(form.get('pluginApiKey') || '').trim();
      const siteUrl = String(form.get('siteUrl') || '').trim().replace(/\/$/, '');

      if (!pluginApiKey || !siteUrl) {
        return json({ error: 'URL magazin si Cheie API sunt obligatorii.' }, { status: 400 });
      }

      const encryptedKey = encrypt(pluginApiKey);
      const encryptedSecret = encrypt('kimono-bi-plugin');

      const store = await db.storeConnection.create({
        data: {
          userId: ctx.effectiveOwnerId,
          platform: 'WOOCOMMERCE',
          name,
          domain: siteUrl.replace(/^https?:\/\//, ''),
          wooConsumerKey: encryptedKey,
          wooConsumerSecret: encryptedSecret,
          wooApiUrl: siteUrl,
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
          await db.storeConnection.update({ where: { id: store.id }, data: { name: result.shopName } });
        }
      } catch (err: any) {
        await db.storeConnection.delete({ where: { id: store.id } });
        return json({ error: `Eroare: ${err.message}` }, { status: 400 });
      }

      const { logActivity: _log } = await import('~/lib/activity.server');
      await _log({ type: 'store_connected', actorUserId: ctx.user.id, storeId: store.id, description: 'Magazin WooCommerce conectat via plugin: ' + name });

      // Auto-trigger first sync immediately (fire-and-forget)
      try {
        const { spawn } = await import('child_process');
        spawn('node', ['scripts/cron-sync.mjs', '--force', `--store=${store.id}`], {
          cwd: process.cwd(), detached: true, stdio: 'ignore',
        }).unref();
      } catch {}

      return redirect('/stores');
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
        userId: ctx.effectiveOwnerId,
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
        userId: ctx.effectiveOwnerId,
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

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 'var(--space-md)' }}>
          <Link to="/stores/new?platform=shopify" className="card" style={{ textDecoration: 'none', textAlign: 'center', padding: 'var(--space-2xl)' }}>
            <div style={{ marginBottom: "var(--space-md)" }}><img src="/shopify-icon.svg" alt="Shopify" style={{ width: 48, height: 48 }} /></div>
            <h3 style={{ color: '#96bf48', fontSize: '1.25rem', fontWeight: 700, marginBottom: 'var(--space-sm)' }}>Shopify</h3>
            <p style={{ color: 'var(--color-text-muted)', fontSize: '0.875rem' }}>
              Conecteaza prin Admin API access token (~5 minute)
            </p>
          </Link>

<Link to="/stores/new?platform=woocommerce" className="card" style={{ textDecoration: 'none', textAlign: 'center', padding: 'var(--space-2xl)' }}>
            <div style={{ marginBottom: "var(--space-md)" }}><img src="/woocommerce-icon.svg" alt="WooCommerce" style={{ width: 48, height: 48 }} /></div>
            <h3 style={{ color: '#7f54b3', fontSize: '1.25rem', fontWeight: 700, marginBottom: 'var(--space-sm)' }}>WooCommerce</h3>
            <p style={{ color: 'var(--color-text-muted)', fontSize: '0.875rem' }}>
              Conecteaza cu plugin-ul Kimono BI Connector
            </p>
          </Link>
          <Link to="/stores/new?platform=emag" className="card" style={{ textDecoration: 'none', textAlign: 'center', padding: 'var(--space-2xl)' }}>
            <div style={{ marginBottom: "var(--space-md)" }}><img src="/emag-icon.png" alt="eMag" style={{ height: 28, width: 'auto' }} /></div>
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

  // WooCommerce form with plugin tutorial
  if (platform === 'woocommerce') {
    return (
      <div>
        <div className="page-header">
          <Link to="/stores/new" style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-xs)', color: 'var(--color-text-muted)', fontSize: '0.875rem', marginBottom: 'var(--space-sm)' }}>
            <ArrowLeft size={16} />
            Inapoi la selectie platforma
          </Link>
          <h1 className="page-title" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <img src="/woocommerce-icon.svg" alt="" style={{ width: 32, height: 32 }} />
            Conecteaza magazin WooCommerce
          </h1>
          <p className="page-subtitle">Instalezi plugin-ul, copiezi cheia API si conectezi in 2 minute.</p>
        </div>

        {/* Tutorial */}
        <div className="card" style={{ marginBottom: 20, padding: 'clamp(20px, 3vw, 28px)', maxWidth: 800, marginLeft: 'auto', marginRight: 'auto' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
                <div style={{ width: 28, height: 28, borderRadius: 7, background: '#7f54b3', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <img src="/woocommerce-icon.svg" alt="" style={{ width: 16, height: 16 }} />
                </div>
                <span style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-primary)' }}>Tutorial - Conectare WooCommerce</span>
              </div>
              <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>3 pasi · ~2 minute</span>
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
            {/* Step 1 */}
            <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start' }}>
              <div style={{ width: 28, height: 28, borderRadius: '50%', background: '#7f54b3', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 700, flexShrink: 0 }}>1</div>
              <div>
                <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 6 }}>Descarca si instaleaza plugin-ul</div>
                <p style={{ fontSize: 13, color: 'var(--text-secondary)', margin: '0 0 10px', lineHeight: 1.6 }}>
                  Descarca plugin-ul <strong>Kimono BI Connector</strong> si instaleaza-l in WordPress:
                </p>
                <a href="/kimono-bi-woo-plugin.zip" download style={{
                  display: 'inline-flex', alignItems: 'center', gap: 8,
                  padding: '10px 20px', background: '#7f54b3', color: 'white',
                  borderRadius: 8, textDecoration: 'none', fontSize: 13, fontWeight: 600,
                  boxShadow: '0 2px 8px rgba(127,84,179,0.3)',
                }}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                  Descarca Kimono BI Connector
                </a>
                <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 8 }}>
                  WordPress Admin &rarr; Plugins &rarr; Add New &rarr; Upload Plugin &rarr; alege fisierul .zip &rarr; Install Now &rarr; Activate
                </p>
              </div>
            </div>

            {/* Step 2 */}
            <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start' }}>
              <div style={{ width: 28, height: 28, borderRadius: '50%', background: '#7f54b3', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 700, flexShrink: 0 }}>2</div>
              <div>
                <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 6 }}>Copiaza datele de conexiune</div>
                <p style={{ fontSize: 13, color: 'var(--text-secondary)', margin: 0, lineHeight: 1.6 }}>
                  In WordPress, mergi la <strong>WooCommerce</strong> &rarr; <strong>Kimono BI</strong> &rarr; tab <strong>Conexiune</strong>.
                  Copiaza <strong>URL Magazin</strong> si <strong>Cheie API</strong>.
                </p>
              </div>
            </div>

            {/* Step 3 */}
            <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start' }}>
              <div style={{ width: 28, height: 28, borderRadius: '50%', background: 'var(--kimono-orange)', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 700, flexShrink: 0 }}>3</div>
              <div>
                <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 6 }}>Conecteaza mai jos</div>
                <p style={{ fontSize: 13, color: 'var(--text-secondary)', margin: 0, lineHeight: 1.6 }}>
                  Lipeste datele in formularul de mai jos si apasa <strong>Conecteaza magazinul</strong>.
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Connection Form */}
        <div className="card" style={{ padding: 24, maxWidth: 600, marginLeft: 'auto', marginRight: 'auto' }}>
          <div style={{ marginBottom: 18, paddingBottom: 14, borderBottom: '0.5px solid var(--border-default)' }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)' }}>Conecteaza magazinul</div>
            <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 2 }}>Lipeste datele din plugin-ul Kimono BI.</div>
          </div>

          <Form method="post">
            <input type="hidden" name="platform" value="woocommerce" />
            <input type="hidden" name="intent" value="wc-plugin" />

            <ConnectError actionData={actionData} />

            <div className="form-group">
              <label className="form-label" htmlFor="wc-name">Numele magazinului</label>
              <input id="wc-name" name="name" type="text" className="form-input" placeholder="Magazinul meu" required autoFocus />
              <p style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>Cum vrei sa apara in interfata Kimono BI.</p>
            </div>

            <div className="form-group">
              <label className="form-label" htmlFor="wc-url">URL Magazin</label>
              <input id="wc-url" name="siteUrl" type="url" className="form-input" placeholder="https://magazinul-meu.ro" required />
              <p style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>Copiaza din WooCommerce &rarr; Kimono BI &rarr; tab Conexiune.</p>
            </div>

            <div className="form-group">
              <label className="form-label" htmlFor="wc-key">Cheie API</label>
              <input id="wc-key" name="pluginApiKey" type="text" className="form-input" placeholder="Cheia API din plugin" required style={{ fontFamily: 'monospace' }} />
              <p style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>Cheia afisata in WooCommerce &rarr; Kimono BI &rarr; tab Conexiune.</p>
            </div>

            <button type="submit" className="btn btn-primary" style={{ width: '100%', background: '#7f54b3', borderColor: '#7f54b3' }} disabled={isSubmitting}>
              {isSubmitting ? 'Se conecteaza...' : 'Conecteaza magazinul'}
            </button>
          </Form>

          <p style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 12, textAlign: 'center' }}>
            Conexiunea e criptata AES-256-GCM. Datele se sincronizeaza automat la fiecare 15 minute.
          </p>
        </div>
      </div>
    );
  }

  // Shopify — OAuth one-click + manual fallback
  return (
    <div>
      <div className="page-header">
        <Link to="/stores/new" style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-xs)', color: 'var(--color-text-muted)', fontSize: '0.875rem', marginBottom: 'var(--space-sm)' }}>
          <ArrowLeft size={16} />
          Inapoi la selectie platforma
        </Link>
        <h1 className="page-title">Conecteaza magazin Shopify</h1>
        <p className="page-subtitle">Conecteaza-te cu un singur click prin aplicatia Kimono BI.</p>
      </div>

      <ShopifyOAuthConnect />
      <ShopifyManualConnect actionData={actionData} isSubmitting={isSubmitting} />
    </div>
  );
}

function ShopifyOAuthConnect() {
  const [shopDomain, setShopDomain] = useState('');

  return (
    <div className="card" style={{ padding: 'clamp(20px, 3vw, 28px)', maxWidth: 720, marginLeft: 'auto', marginRight: 'auto', marginBottom: 20 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
        <div style={{ width: 32, height: 32, borderRadius: 8, background: '#96bf48', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <img src="/shopify-icon.svg" alt="" style={{ width: 18, height: 18 }} />
        </div>
        <div>
          <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-primary)' }}>Conectare rapida</div>
          <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Un singur click — fara token manual</div>
        </div>
      </div>

      <p style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.6, marginBottom: 16 }}>
        Introdu domeniul <strong>.myshopify.com</strong> al magazinului tau si apasa butonul verde.
        Vei fi redirectionat catre Shopify pentru a autoriza conexiunea automat.
      </p>

      <div className="form-group" style={{ marginBottom: 12 }}>
        <label className="form-label" htmlFor="oauth-domain">Domeniul Shopify</label>
        <input
          id="oauth-domain"
          type="text"
          className="form-input"
          placeholder="numele-magazinului.myshopify.com"
          value={shopDomain}
          onChange={(e) => setShopDomain(e.target.value)}
          style={{ width: '100%' }}
        />
        <small style={{ color: 'var(--color-text-muted)', fontSize: '0.75rem', display: 'block', marginTop: 4 }}>
          Il gasesti in Shopify Admin &rarr; Settings &rarr; Domains
        </small>
      </div>

      <button
        type="button"
        onClick={() => {
          const shop = shopDomain.trim().replace(/^https?:\/\//, '').replace(/\/$/, '');
          if (!shop) { alert('Introdu domeniul Shopify.'); return; }
          window.location.href = `/api/shopify-oauth/install?shop=${encodeURIComponent(shop)}`;
        }}
        style={{
          width: '100%',
          padding: '12px 24px',
          background: '#96bf48',
          color: '#fff',
          border: 'none',
          borderRadius: 8,
          fontSize: 14,
          fontWeight: 700,
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 8,
        }}
      >
        <CheckCircle size={16} />
        Conecteaza cu Shopify (un click)
      </button>

      <p style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 10, textAlign: 'center' }}>
        Permisiuni solicitate: read_products, read_orders, read_customers, write_customers, read_inventory, read_reports.
        Conexiunea e securizata si criptata AES-256.
      </p>
    </div>
  );
}

function ShopifyManualConnect({ actionData, isSubmitting }: { actionData: any; isSubmitting: boolean }) {
  const [showManual, setShowManual] = useState(false);

  return (
    <div style={{ maxWidth: 720, marginLeft: 'auto', marginRight: 'auto' }}>
      {/* Divider */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, margin: '8px 0 16px', padding: '0 4px' }}>
        <div style={{ flex: 1, height: 1, background: 'var(--border-default)' }} />
        <span style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>sau conectare manuala cu access token</span>
        <div style={{ flex: 1, height: 1, background: 'var(--border-default)' }} />
      </div>

      {!showManual ? (
        <button
          type="button"
          onClick={() => setShowManual(true)}
          className="card"
          style={{
            width: '100%',
            padding: '14px 20px',
            textAlign: 'center',
            cursor: 'pointer',
            border: '1px dashed var(--border-default)',
            background: 'var(--bg-secondary)',
            color: 'var(--text-secondary)',
            fontSize: 13,
            fontWeight: 500,
          }}
        >
          Conectare cu Admin API Access Token (avansat) &darr;
        </button>
      ) : (
        <>
          <ShopifyTutorial />

          <div className="card" style={{ marginTop: 20, padding: 24 }}>
            <div style={{ marginBottom: 18, paddingBottom: 14, borderBottom: '0.5px solid var(--border-default)' }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)' }}>Conecteaza magazinul (manual)</div>
              <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 2 }}>Dupa ce ai urmat pasii de mai sus, completeaza datele aici.</div>
            </div>

            <Form method="post">
              <input type="hidden" name="platform" value="shopify" />

              <ConnectError actionData={actionData} />

              <div className="form-group">
                <label className="form-label" htmlFor="name">Numele magazinului</label>
                <input id="name" name="name" type="text" className="form-input" placeholder="ex: Vivimall" required style={{ width: '100%' }} />
                <small style={{ color: 'var(--color-text-muted)', fontSize: '0.75rem', display: 'block', marginTop: 4 }}>
                  Cum vrei sa apara in interfata Kimono BI.
                </small>
              </div>

              <div className="form-group">
                <label className="form-label" htmlFor="domain">Domeniul Shopify (.myshopify.com)</label>
                <input id="domain" name="domain" type="text" className="form-input" placeholder="numele-magazinului.myshopify.com" required style={{ width: '100%' }} />
              </div>

              <div className="form-group">
                <label className="form-label" htmlFor="accessToken">Admin API Access Token</label>
                <input id="accessToken" name="accessToken" type="password" className="form-input" placeholder="shpat_..." required style={{ width: '100%' }} />
                <small style={{ color: 'var(--color-text-muted)', fontSize: '0.75rem', display: 'block', marginTop: 4 }}>
                  Incepe cu <code style={{ background: 'var(--bg-tertiary)', padding: '1px 5px', borderRadius: 3, fontSize: 11 }}>shpat_</code>. Token-ul e criptat AES-256 inainte de salvare.
                </small>
              </div>

              <ConnectButton isSubmitting={isSubmitting} />
            </Form>
          </div>
        </>
      )}
    </div>
  );
}


const REQUIRED_SCOPES = [
  { name: 'read_products', desc: 'Catalog, BCG matrix, Stockout, Inventory turnover', kind: 'read' as const },
  { name: 'read_orders', desc: 'Toate analizele de vânzări, AOV, Forecast, Compare', kind: 'read' as const },
  { name: 'read_customers', desc: 'RFM, Cohorts, LTV, Churn — citește lista de clienți', kind: 'read' as const },
  { name: 'write_customers', desc: 'Tagging clienți cu segmentul RFM (Champion, At Risk, etc.) în Shopify', kind: 'write' as const },
  { name: 'read_inventory', desc: 'Smart alerts stoc + Turnover analytics + Margin', kind: 'read' as const },
  { name: 'read_returns', desc: 'Refund analytics, retururi, money-back stats', kind: 'read' as const },
];

// ────────────────────────────────────────────────────────────────────────────
// Error display + animated submit button
// ────────────────────────────────────────────────────────────────────────────

function ConnectError({ actionData }: { actionData: any }) {
  if (!actionData?.error) return null;

  // Missing scopes → highlighted, actionable card
  if (actionData.errorKind === 'missing_scopes' && Array.isArray(actionData.missingScopes) && actionData.missingScopes.length > 0) {
    return (
      <div style={{
        marginBottom: 18,
        padding: '14px 16px',
        background: 'rgba(217,119,6,0.06)',
        border: '1px solid rgba(217,119,6,0.4)',
        borderRadius: 10,
      }}>
        <div style={{ fontSize: 12.5, fontWeight: 600, color: '#92400e', marginBottom: 6 }}>
          Lipsesc {actionData.missingScopes.length} {actionData.missingScopes.length === 1 ? 'scope' : 'scopes'} în Shopify Admin API
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' as const, marginBottom: 10 }}>
          {actionData.missingScopes.map((s: string) => (
            <code key={s} style={{
              background: '#0a0a0a', color: '#FFB590',
              padding: '3px 9px', borderRadius: 4,
              fontFamily: 'ui-monospace, monospace',
              fontSize: 11.5, fontWeight: 600,
            }}>{s}</code>
          ))}
        </div>
        <div style={{ fontSize: 12, color: '#78350f', lineHeight: 1.6 }}>
          Întoarce-te în Shopify Admin → app-ul <strong>Kimono BI</strong> → tab <strong>Configuration</strong> → <strong>Configure</strong> Admin API → bifează scope-urile de mai sus → <strong>Save</strong>. Apoi revino aici și apasă <strong>Testează și conectează</strong>.
        </div>
      </div>
    );
  }

  const kindLabel: Record<string, string> = {
    invalid_token: 'Token invalid',
    invalid_domain: 'Domeniu invalid',
    network: 'Problemă de rețea',
    unknown: 'Eroare',
  };
  const label = kindLabel[actionData.errorKind] || 'Eroare';

  return (
    <div style={{
      marginBottom: 18,
      padding: '12px 14px',
      background: 'rgba(220,38,38,0.05)',
      border: '1px solid rgba(220,38,38,0.3)',
      borderRadius: 10,
    }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: '#991b1b', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 4 }}>
        {label}
      </div>
      <div style={{ fontSize: 12.5, color: '#7f1d1d', lineHeight: 1.55 }}>{actionData.error}</div>
    </div>
  );
}

function ConnectButton({ isSubmitting }: { isSubmitting: boolean }) {
  // Visual progress steps shown while the request is in flight. The actual checks happen
  // server-side in one round-trip, but the user sees what we're doing.
  const steps = ['Verific token-ul', 'Verific scope-urile', 'Conectez magazinul'];
  const [activeStep, setActiveStep] = useState(0);

  React.useEffect(() => {
    if (!isSubmitting) {
      setActiveStep(0);
      return;
    }
    setActiveStep(0);
    const timers: ReturnType<typeof setTimeout>[] = [];
    timers.push(setTimeout(() => setActiveStep(1), 900));
    timers.push(setTimeout(() => setActiveStep(2), 2200));
    return () => timers.forEach(clearTimeout);
  }, [isSubmitting]);

  if (!isSubmitting) {
    return (
      <button type="submit" className="btn btn-primary btn-full" style={{ marginTop: 8 }}>
        Testează și conectează →
      </button>
    );
  }

  return (
    <div style={{ marginTop: 8 }}>
      <button type="submit" className="btn btn-primary btn-full" disabled style={{ opacity: 0.85 }}>
        Se conectează...
      </button>
      <div style={{ marginTop: 14, padding: '12px 14px', background: 'var(--bg-tertiary)', borderRadius: 8 }}>
        {steps.map((label, i) => {
          const done = i < activeStep;
          const active = i === activeStep;
          return (
            <div key={i} style={{
              display: 'flex', alignItems: 'center', gap: 10,
              padding: '5px 0',
              color: done ? '#15803d' : active ? 'var(--text-primary)' : 'var(--text-tertiary)',
              fontSize: 12,
              transition: 'all 0.2s',
            }}>
              <span style={{
                width: 16, height: 16, borderRadius: '50%',
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                background: done ? 'rgba(22,163,74,0.15)' : active ? 'var(--kimono-orange)' : 'var(--border-default)',
                color: done ? '#15803d' : 'white',
                fontSize: 10, fontWeight: 700, flexShrink: 0,
              }}>
                {done ? '✓' : active ? '' : ''}
              </span>
              <span style={{ fontWeight: active ? 600 : 400 }}>{label}</span>
              {active && (
                <span style={{
                  marginLeft: 'auto',
                  width: 10, height: 10, borderRadius: '50%',
                  border: '1.5px solid var(--kimono-orange)',
                  borderTopColor: 'transparent',
                  animation: 'spin 0.8s linear infinite',
                }} />
              )}
            </div>
          );
        })}
      </div>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

function ShopifyTutorial() {
  const [open, setOpen] = useState(true);
  const [copiedScope, setCopiedScope] = useState<string | null>(null);

  const copyScope = (name: string) => {
    navigator.clipboard?.writeText(name);
    setCopiedScope(name);
    setTimeout(() => setCopiedScope(null), 1500);
  };

  return (
    <div style={{
      borderRadius: 12,
      overflow: 'hidden',
      background: 'white',
      border: '0.5px solid var(--border-default)',
    }}>
      {/* Header */}
      <div style={{
        padding: '14px 20px',
        borderBottom: open ? '0.5px solid var(--border-default)' : 'none',
        display: 'flex', alignItems: 'center', gap: 12,
      }}>
        <div style={{
          width: 28, height: 28, borderRadius: 7,
          background: '#96bf48',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: '#fff', fontSize: 13, fontWeight: 700,
        }}>S</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', letterSpacing: '-0.1px' }}>
            Tutorial · Conectare Shopify Admin API
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 1 }}>
            8 pași · ~5 minute · token criptat AES-256
          </div>
        </div>
        <button
          type="button"
          onClick={() => setOpen(!open)}
          style={{
            padding: '5px 11px', borderRadius: 6,
            background: 'var(--bg-tertiary)', border: 'none',
            fontSize: 11, fontWeight: 500, color: 'var(--text-secondary)',
            cursor: 'pointer',
          }}
        >
          {open ? 'Ascunde' : 'Afișează'}
        </button>
      </div>

      {open && (
        <>
          {/* Inline 2026 notice */}
          <div style={{
            padding: '10px 20px',
            background: 'rgba(216,90,48,0.04)',
            borderBottom: '0.5px solid var(--border-default)',
            fontSize: 11.5, color: 'var(--text-secondary)', lineHeight: 1.55,
          }}>
            <strong style={{ color: '#A33D14' }}>Notă:</strong> începând cu 1 ianuarie 2026, custom apps prin <em>Settings → Apps</em> nu mai pot fi create — pentru viitor folosește <a href="https://partners.shopify.com" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--kimono-orange)', fontWeight: 500 }}>Partner Dashboard</a>. Cele existente continuă să funcționeze.
          </div>

          {/* Pre-req inline */}
          <div style={{
            padding: '10px 20px',
            borderBottom: '0.5px solid var(--border-default)',
            fontSize: 11.5, color: 'var(--text-secondary)', lineHeight: 1.55,
          }}>
            <strong style={{ color: 'var(--text-primary)' }}>Necesar:</strong> rol Owner sau Staff cu <em>Manage settings</em> · magazin activ · 6 scopes (5 read + 1 write)
          </div>

          {/* Steps */}
          <div style={{ padding: '18px 20px' }}>
            <Step n={1} title="Login în Shopify Admin">
              Deschide <code style={cd}>numele-magazinului.myshopify.com/admin</code> și autentifică-te.
            </Step>

            <Step n={2} title="Mergi la Develop apps">
              Cea mai rapidă cale — copiază URL-ul direct în browser:
              <div style={{ marginTop: 8, padding: '8px 12px', background: 'var(--bg-tertiary)', borderRadius: 6, fontFamily: 'ui-monospace, monospace', fontSize: 11.5, color: 'var(--text-primary)', wordBreak: 'break-all' as const }}>
                https://numele-magazinului.myshopify.com/admin/settings/apps/development
              </div>
              <div style={{ marginTop: 8 }}>
                Sau prin meniu: <em>Settings → Apps and sales channels → Develop apps</em>.
              </div>
            </Step>

            <Step n={3} title="Activează development access (doar prima dată)">
              Click <strong>Develop apps for your store</strong> sus-dreapta. Dacă apare prompt, click <strong>Allow custom app development</strong> de două ori pentru confirmare.
            </Step>

            <Step n={4} title="Create app">
              Click <strong>Create an app</strong>. Nume: <code style={cd}>Kimono BI</code>. App developer: emailul tău. Click <strong>Create app</strong>.
            </Step>

            <Step n={5} title="Configure Admin API scopes" highlight>
              Tab <strong>Configuration</strong> → <em>Admin API integration</em> → click <strong>Configure</strong>. Bifează exact aceste 6 scopes:
              <div style={{
                marginTop: 10,
                border: '0.5px solid var(--border-default)',
                borderRadius: 8,
                overflow: 'hidden',
              }}>
                {REQUIRED_SCOPES.map((s, i) => {
                  const isWrite = s.kind === 'write';
                  return (
                    <div key={s.name} style={{
                      display: 'flex', alignItems: 'center', gap: 10,
                      padding: '8px 12px',
                      borderBottom: i < REQUIRED_SCOPES.length - 1 ? '0.5px solid var(--border-default)' : 'none',
                      background: isWrite ? 'rgba(216,90,48,0.03)' : 'white',
                    }}>
                      <button
                        type="button"
                        onClick={() => copyScope(s.name)}
                        title="Copy"
                        style={{
                          background: '#0a0a0a',
                          color: isWrite ? '#FFB590' : '#96bf48',
                          border: 'none',
                          padding: '3px 9px', borderRadius: 4,
                          fontFamily: 'ui-monospace, monospace',
                          fontSize: 11.5, fontWeight: 600, cursor: 'pointer',
                          minWidth: 130,
                        }}
                      >
                        {copiedScope === s.name ? 'copiat' : s.name}
                      </button>
                      <span style={{
                        fontSize: 9, fontWeight: 700,
                        padding: '1px 6px', borderRadius: 3,
                        background: isWrite ? 'rgba(216,90,48,0.12)' : 'rgba(22,163,74,0.1)',
                        color: isWrite ? '#A33D14' : '#15803d',
                        letterSpacing: '0.5px', textTransform: 'uppercase' as const,
                        flexShrink: 0,
                      }}>
                        {isWrite ? 'write' : 'read'}
                      </span>
                      <span style={{ fontSize: 11.5, color: 'var(--text-secondary)', flex: 1, minWidth: 0 }}>
                        {s.desc}
                      </span>
                    </div>
                  );
                })}
              </div>
              <div style={{ marginTop: 8, fontSize: 11, color: 'var(--text-tertiary)', lineHeight: 1.5 }}>
                <strong style={{ color: 'var(--text-secondary)' }}>De ce write_customers:</strong> Kimono BI tagging-uiește clienții în Shopify cu segmentul lor RFM (<code style={cd}>RFM: Champions</code>, <code style={cd}>RFM: At Risk</code>, etc.) ca să poți filtra direct pentru campanii email/SMS.
              </div>
              <div style={{ marginTop: 8 }}>
                Click pe nume pentru copiere. Folosește <kbd style={kb}>Cmd/Ctrl + F</kbd> în Shopify pentru căutare. La final click <strong>Save</strong>.
              </div>
            </Step>

            <Step n={6} title="Install app">
              Tab <strong>API credentials</strong> → click <strong>Install app</strong> → confirmă <strong>Install</strong>.
            </Step>

            <Step n={7} title="Reveal & copiază token-ul" critical>
              În <em>Admin API access token</em> click <strong>Reveal token once</strong> → copiază valoarea (începe cu <code style={cd}>shpat_</code>).
              <div style={{
                marginTop: 8, padding: '8px 12px',
                background: 'rgba(220,38,38,0.05)',
                border: '0.5px solid rgba(220,38,38,0.25)',
                borderRadius: 6,
                fontSize: 11.5, color: '#7f1d1d', lineHeight: 1.55,
              }}>
                <strong>Token-ul se afișează o singură dată.</strong> Dacă îl pierzi, trebuie să creezi alt app — Shopify nu îl re-afișează.
              </div>
            </Step>

            <Step n={8} title="Conectează" last>
              Lipește token-ul mai jos + numele și domeniul magazinului. Click <strong>Testează și conectează</strong>. Dacă scope-urile lipsesc, primești eroare clară.
            </Step>
          </div>

          {/* Footer thin */}
          <div style={{
            padding: '10px 20px',
            background: '#FAFAFA',
            borderTop: '0.5px solid var(--border-default)',
            fontSize: 11, color: 'var(--text-tertiary)', lineHeight: 1.55,
            display: 'flex', flexWrap: 'wrap' as const, gap: 14, justifyContent: 'space-between',
          }}>
            <span>Token criptat AES-256-GCM la nivel server.</span>
            <span style={{ display: 'flex', gap: 14, flexWrap: 'wrap' as const }}>
              <a href="https://help.shopify.com/en/manual/apps/app-types/custom-apps" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--kimono-orange)', fontWeight: 500 }}>Custom apps docs</a>
              <a href="https://shopify.dev/docs/api/usage/access-scopes" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--kimono-orange)', fontWeight: 500 }}>Access scopes</a>
              <a href="mailto:office@kimonogroup.ro" style={{ color: 'var(--kimono-orange)', fontWeight: 500 }}>office@kimonogroup.ro</a>
            </span>
          </div>
        </>
      )}
    </div>
  );
}

const cd: React.CSSProperties = {
  background: 'var(--bg-tertiary)', padding: '1px 5px', borderRadius: 3,
  fontSize: 11, fontFamily: 'ui-monospace, monospace', color: 'var(--text-primary)',
};

const kb: React.CSSProperties = {
  background: 'white', border: '0.5px solid var(--border-default)',
  padding: '1px 6px', borderRadius: 4, fontSize: 10.5,
  fontFamily: 'ui-monospace, monospace', color: 'var(--text-primary)',
};

function Step({ n, title, children, critical, highlight, last }: {
  n: number;
  title: string;
  children: React.ReactNode;
  critical?: boolean;
  highlight?: boolean;
  last?: boolean;
}) {
  const accent = critical ? '#dc2626' : highlight ? 'var(--kimono-orange)' : '#96bf48';
  return (
    <div style={{
      display: 'flex',
      gap: 14,
      paddingBottom: last ? 0 : 14,
      marginBottom: last ? 0 : 14,
      borderBottom: last ? 'none' : '0.5px dashed var(--border-default)',
    }}>
      <div style={{
        width: 26, height: 26, borderRadius: '50%',
        background: critical ? 'rgba(220,38,38,0.1)' : highlight ? 'rgba(216,90,48,0.1)' : 'rgba(150,191,72,0.12)',
        color: accent,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 12, fontWeight: 700, flexShrink: 0,
      }}>
        {n}
      </div>
      <div style={{ flex: 1, paddingTop: 3, minWidth: 0 }}>
        <div style={{
          fontSize: 13, fontWeight: 600, color: 'var(--text-primary)',
          marginBottom: 4, letterSpacing: '-0.1px',
        }}>
          {title}
        </div>
        <div style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.6 }}>
          {children}
        </div>
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
          onClick={() => setMode('plugin')}
          style={{
            flex: 1,
            padding: 'var(--space-sm) var(--space-md)',
            border: 'none',
            borderRadius: 'var(--radius-sm)',
            cursor: 'pointer',
            fontSize: '0.875rem',
            fontWeight: 600,
            background: mode === 'plugin' ? 'var(--color-bg-secondary)' : 'transparent',
            color: mode === 'plugin' ? 'var(--color-primary)' : 'var(--color-text-muted)',
            transition: 'all 0.2s',
          }}
        >
          Kimono BI Plugin (Recomandat)
        </button>
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
          Conectare automata
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

      {mode === 'plugin' ? (
        <div className="card" style={{ maxWidth: 560 }}>
          <div style={{ marginBottom: 'var(--space-md)', padding: 'var(--space-sm) var(--space-md)', background: 'rgba(255, 90, 31, 0.08)', borderRadius: 'var(--radius-sm)', border: '1px solid rgba(255, 90, 31, 0.2)' }}>
            <p style={{ fontSize: '0.8125rem', color: 'var(--color-text-secondary)', margin: 0 }}>
              Instaleaza plugin-ul <strong>Kimono BI Connector</strong> in WordPress, apoi copiaza URL-ul si Cheia API din WooCommerce &gt; Kimono BI.
            </p>
          </div>
          <Form method="post">
            <input type="hidden" name="platform" value="woocommerce" />
            <input type="hidden" name="intent" value="wc-plugin" />

            {actionData?.error && (
              <div className="alert alert-error">{actionData.error}</div>
            )}

            <div className="form-group">
              <label className="form-label" htmlFor="plugin-name">Numele magazinului</label>
              <input id="plugin-name" name="name" type="text" className="form-input" placeholder="Magazinul meu" required autoFocus />
            </div>

            <div className="form-group">
              <label className="form-label" htmlFor="plugin-url">URL Magazin</label>
              <input id="plugin-url" name="siteUrl" type="url" className="form-input" placeholder="https://magazinul-meu.ro" required />
              <p style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', marginTop: 4 }}>URL-ul afisat in WooCommerce &gt; Kimono BI &gt; tab Conexiune</p>
            </div>

            <div className="form-group">
              <label className="form-label" htmlFor="plugin-key">Cheie API</label>
              <input id="plugin-key" name="pluginApiKey" type="text" className="form-input" placeholder="Cheia din plugin-ul Kimono BI" required style={{ fontFamily: 'monospace' }} />
              <p style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', marginTop: 4 }}>Cheia afisata in WooCommerce &gt; Kimono BI &gt; tab Conexiune</p>
            </div>

            <button type="submit" className="btn btn-primary" style={{ width: '100%' }} disabled={isSubmitting}>
              {isSubmitting ? 'Se conecteaza...' : 'Conecteaza magazinul'}
            </button>
          </Form>

          <div style={{ marginTop: 'var(--space-md)', padding: 'var(--space-sm) var(--space-md)', background: 'var(--color-bg-secondary)', borderRadius: 'var(--radius-sm)' }}>
            <p style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', margin: 0 }}>
              <strong>Nu ai plugin-ul instalat?</strong> Descarca-l de la <a href="https://bi.kimonogroup.ro" style={{ color: 'var(--color-primary)' }}>bi.kimonogroup.ro</a> sau contacteaza-ne.
            </p>
          </div>
        </div>
      ) : mode === 'auto' ? (
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
