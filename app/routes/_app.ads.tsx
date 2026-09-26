import type { LoaderFunctionArgs, MetaFunction } from '@remix-run/node';
import { json } from '@remix-run/node';
import { Form, Link, useLoaderData, useSearchParams } from '@remix-run/react';
import type { ActionFunctionArgs } from '@remix-run/node';
import { requireUserContext } from '~/lib/auth/requireAuth.server';
import { db } from '~/lib/db.server';
import { decrypt } from '~/lib/auth/crypto.server';
import { TrendingUp, DollarSign, Users, Target, Megaphone } from 'lucide-react';
import { useState } from 'react';

export const meta: MetaFunction = () => [{ title: 'Ads & Acquisition — Kimono BI' }];

export async function action({ request }: ActionFunctionArgs) {
  const ctx = await requireUserContext(request);
  const form = await request.formData();
  const intent = String(form.get('intent'));
  const storeId = String(form.get('storeId'));

  if (intent === 'disconnectMeta') {
    await db.storeSettings.update({
      where: { storeConnectionId: storeId },
      data: { metaAccessToken: null, metaAdAccountId: null, metaTokenExpiresAt: null, metaLastSyncAt: null },
    });
    return json({ success: 'Meta Ads deconectat.' });
  }

  return json({ error: 'Unknown intent' }, { status: 400 });
}

export async function loader({ request }: LoaderFunctionArgs) {
  const ctx = await requireUserContext(request);
  const url = new URL(request.url);
  const storeId = url.searchParams.get('store');
  const metaSuccess = url.searchParams.get('meta_success');
  const metaError = url.searchParams.get('meta_error');
  const metaSelect = url.searchParams.get('meta_select');
  const accountsParam = url.searchParams.get('accounts');
  let metaAccounts: any[] = [];
  if (metaSelect && accountsParam) {
    try { metaAccounts = JSON.parse(accountsParam); } catch {}
  }

  const stores = await db.storeConnection.findMany({
    where: { userId: ctx.effectiveOwnerId },
    select: { id: true, name: true, settings: true },
  });

  const selectedStoreId = storeId || stores[0]?.id;
  if (!selectedStoreId) return json({ stores, data: null, selectedStoreId: null, metaSuccess, metaError });

  const settings = await db.storeSettings.findUnique({ where: { storeConnectionId: selectedStoreId } });
  const isMetaConnected = !!(settings?.metaAccessToken && settings?.metaAdAccountId);

  let metaData: any = null;

  if (isMetaConnected) {
    try {
      const token = decrypt(settings!.metaAccessToken!);
      const adAccountId = settings!.metaAdAccountId!;

      // Get last 30 days insights
      const today = new Date();
      const d30 = new Date(today); d30.setDate(d30.getDate() - 30);
      const d60 = new Date(today); d60.setDate(d60.getDate() - 60);
      const since30 = d30.toISOString().slice(0, 10);
      const until30 = today.toISOString().slice(0, 10);
      const since60 = d60.toISOString().slice(0, 10);
      const until60 = d30.toISOString().slice(0, 10);

      // Current 30d
      const insightsRes = await fetch(
        `https://graph.facebook.com/v21.0/${adAccountId}/insights?` +
        `fields=spend,impressions,clicks,actions,cost_per_action_type,cpc,cpm,ctr,purchase_roas` +
        `&time_range={"since":"${since30}","until":"${until30}"}` +
        `&access_token=${token}`
      );
      const insightsData = await insightsRes.json();
      const current = insightsData.data?.[0] || {};

      // Previous 30d for comparison
      const prevRes = await fetch(
        `https://graph.facebook.com/v21.0/${adAccountId}/insights?` +
        `fields=spend,impressions,clicks,actions,purchase_roas` +
        `&time_range={"since":"${since60}","until":"${until60}"}` +
        `&access_token=${token}`
      );
      const prevData = await prevRes.json();
      const previous = prevData.data?.[0] || {};

      // Campaign breakdown
      const campaignRes = await fetch(
        `https://graph.facebook.com/v21.0/${adAccountId}/insights?` +
        `fields=campaign_name,spend,impressions,clicks,actions,cost_per_action_type,purchase_roas` +
        `&time_range={"since":"${since30}","until":"${until30}"}` +
        `&level=campaign&limit=20&sort=spend_descending` +
        `&access_token=${token}`
      );
      const campaignData = await campaignRes.json();

      // Daily breakdown for chart
      const dailyRes = await fetch(
        `https://graph.facebook.com/v21.0/${adAccountId}/insights?` +
        `fields=spend,impressions,clicks,actions` +
        `&time_range={"since":"${since30}","until":"${until30}"}` +
        `&time_increment=1&limit=31` +
        `&access_token=${token}`
      );
      const dailyData = await dailyRes.json();

      // Extract purchases from actions
      const getPurchases = (data: any) => {
        const actions = data.actions || [];
        const purchase = actions.find((a: any) => a.action_type === 'purchase' || a.action_type === 'offsite_conversion.fb_pixel_purchase');
        return purchase ? parseInt(purchase.value) : 0;
      };

      const getCostPerPurchase = (data: any) => {
        const cpa = data.cost_per_action_type || [];
        const purchase = cpa.find((a: any) => a.action_type === 'purchase' || a.action_type === 'offsite_conversion.fb_pixel_purchase');
        return purchase ? parseFloat(purchase.value) : 0;
      };

      const getRoas = (data: any) => {
        const roas = data.purchase_roas || [];
        return roas.length > 0 ? parseFloat(roas[0].value) : 0;
      };

      // Get new customers from Shopify (last 30d)
      const newCustomers30d = await db.customer.count({
        where: { storeConnectionId: selectedStoreId, firstOrderAt: { gte: d30 } },
      });

      const spend30 = parseFloat(current.spend || '0');
      const spend60 = parseFloat(previous.spend || '0');
      const purchases30 = getPurchases(current);
      const cac = newCustomers30d > 0 ? spend30 / newCustomers30d : 0;

      // Get LTV for ratio
      const allCustomers = await db.customer.findMany({
        where: { storeConnectionId: selectedStoreId, totalSpent: { gt: 0 } },
        select: { totalSpent: true },
      });
      const avgLTV = allCustomers.length > 0
        ? allCustomers.reduce((s, c) => s + Number(c.totalSpent), 0) / allCustomers.length
        : 0;

      const campaigns = (campaignData.data || []).map((c: any) => ({
        name: c.campaign_name,
        spend: parseFloat(c.spend || '0'),
        impressions: parseInt(c.impressions || '0'),
        clicks: parseInt(c.clicks || '0'),
        purchases: getPurchases(c),
        costPerPurchase: getCostPerPurchase(c),
        roas: getRoas(c),
      }));

      const daily = (dailyData.data || []).map((d: any) => ({
        date: d.date_start,
        spend: parseFloat(d.spend || '0'),
        clicks: parseInt(d.clicks || '0'),
        purchases: getPurchases(d),
      }));

      metaData = {
        spend: Math.round(spend30 * 100) / 100,
        spendPrev: Math.round(spend60 * 100) / 100,
        impressions: parseInt(current.impressions || '0'),
        clicks: parseInt(current.clicks || '0'),
        cpc: parseFloat(current.cpc || '0'),
        ctr: parseFloat(current.ctr || '0'),
        purchases: purchases30,
        costPerPurchase: Math.round(getCostPerPurchase(current) * 100) / 100,
        roas: Math.round(getRoas(current) * 100) / 100,
        cac: Math.round(cac * 100) / 100,
        newCustomers: newCustomers30d,
        avgLTV: Math.round(avgLTV * 100) / 100,
        ltvCacRatio: cac > 0 ? Math.round((avgLTV / cac) * 10) / 10 : 0,
        campaigns,
        daily,
        tokenExpires: settings!.metaTokenExpiresAt?.toISOString() || null,
      };
    } catch (e: any) {
      console.error('[ads] Meta data fetch failed:', e.message);
      metaData = { error: e.message };
    }
  }

  return json({
    stores, selectedStoreId, metaSuccess, metaError, metaSelect, metaAccounts,
    data: {
      isMetaConnected,
      adAccountId: settings?.metaAdAccountId || null,
      meta: metaData,
    },
  });
}

function fmtMoney(n: number) { return n.toLocaleString('ro-RO', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function fmtNum(n: number) { return n.toLocaleString('ro-RO'); }
function pctChange(curr: number, prev: number) {
  if (prev === 0) return curr > 0 ? 100 : 0;
  return Math.round(((curr - prev) / prev) * 1000) / 10;
}

export default function AdsPage() {
  const { stores, selectedStoreId, data, metaSuccess, metaError, metaSelect, metaAccounts } = useLoaderData<typeof loader>();
  const [searchParams, setSearchParams] = useSearchParams();

  if (!data) {
    return (
      <div>
        <div className="page-header"><h1 className="page-title">Ads & Acquisition</h1></div>
        <div className="card" style={{ textAlign: 'center', padding: '56px 24px' }}>
          <p style={{ color: 'var(--color-text-muted)' }}>Conecteaza un magazin.</p>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 'var(--space-sm)' }}>
        <div>
          <h1 className="page-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Megaphone size={22} /> Ads & Acquisition
          </h1>
          <p className="page-subtitle">Cost achizitie client, ROAS si performanta campanii (ultimele 30 zile)</p>
        </div>
        {stores.length > 1 && (
          <select className="form-input" style={{ width: 220 }} value={selectedStoreId || ''} onChange={(e) => setSearchParams({ store: e.target.value })}>
            {stores.map((s: any) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        )}
      </div>

      {metaSuccess && <div className="alert alert-success" style={{ marginBottom: 16 }}>Meta Ads conectat cu succes!</div>}
      {metaError && <div className="alert alert-error" style={{ marginBottom: 16 }}>Eroare Meta: {metaError}</div>}

      {/* Connected status + disconnect */}
      {data.isMetaConnected && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 16px', background: 'rgba(24,119,242,0.05)', border: '0.5px solid rgba(24,119,242,0.15)', borderRadius: 8, marginBottom: 'var(--space-md)' }}>
          <span style={{ fontSize: 13, color: '#1877F2', fontWeight: 600 }}>
            Meta Ads conectat ({data.adAccountId})
          </span>
          <Form method="post">
            <input type="hidden" name="intent" value="disconnectMeta" />
            <input type="hidden" name="storeId" value={selectedStoreId || ''} />
            <button type="submit" style={{ fontSize: 11, color: '#dc2626', background: 'none', border: '0.5px solid #dc2626', borderRadius: 4, padding: '4px 10px', cursor: 'pointer' }}>Deconecteaza</button>
          </Form>
        </div>
      )}

      {/* Account selection */}
      {metaSelect && metaAccounts && metaAccounts.length > 0 && (
        <div className="card" style={{ padding: '28px', marginBottom: 'var(--space-xl)' }}>
          <h3 style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--text-primary)', marginBottom: 8 }}>Selecteaza contul de publicitate</h3>
          <p style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)', marginBottom: 16 }}>
            Am gasit {metaAccounts.length} conturi de publicitate. Selecteaza contul pe care vrei sa il monitorizezi:
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {metaAccounts.map((acc: any) => (
              <form key={acc.id} method="post" action="/api/auth/meta/select-account">
                <input type="hidden" name="storeId" value={selectedStoreId || ''} />
                <input type="hidden" name="adAccountId" value={acc.id} />
                <button type="submit" style={{
                  width: '100%', padding: '14px 20px', background: 'var(--bg-secondary)',
                  border: '0.5px solid var(--border-default)', borderRadius: 8, cursor: 'pointer',
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  textAlign: 'left', fontFamily: 'inherit',
                }}>
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)' }}>{acc.name}</div>
                    <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>{acc.id} · {acc.currency} · Spend total: {acc.spent}</div>
                  </div>
                  <span style={{ fontSize: 12, fontWeight: 600, color: '#1877F2' }}>Selecteaza →</span>
                </button>
              </form>
            ))}
          </div>
        </div>
      )}

      {/* Connect Meta */}
      {!data.isMetaConnected && !metaSelect && (
        <div className="card" style={{ padding: '28px', marginBottom: 'var(--space-xl)', border: '1px dashed var(--border-default)' }}>
          <h3 style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--text-primary)', marginBottom: 8 }}>Conecteaza Meta Ads</h3>
          <p style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)', lineHeight: 1.6, marginBottom: 16 }}>
            Conecteaza contul de Meta Ads (Facebook & Instagram) pentru a vedea spend-ul, ROAS-ul si costul de achizitie client (CAC) direct in platforma. Un singur click.
          </p>
          <a
            href={`/api/auth/meta/install?store=${selectedStoreId}`}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 8,
              padding: '12px 24px', background: '#1877F2', color: '#fff',
              border: 'none', borderRadius: 8, fontSize: 14, fontWeight: 700,
              textDecoration: 'none', cursor: 'pointer',
            }}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/></svg>
            Conecteaza Meta Ads
          </a>
        </div>
      )}

      {/* Meta Data */}
      {data.isMetaConnected && data.meta && !data.meta.error && (
        <>
          {/* KPI Cards */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 'var(--space-md)', marginBottom: 'var(--space-xl)' }}>
            <div className="card" style={{ borderLeft: '3px solid #1877F2' }}>
              <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginBottom: 4 }}>Ad Spend (30z)</div>
              <div style={{ fontSize: 22, fontWeight: 600, color: '#1877F2' }}>{fmtMoney(data.meta.spend)} RON</div>
              {data.meta.spendPrev > 0 && (
                <div style={{ fontSize: 11, color: pctChange(data.meta.spend, data.meta.spendPrev) > 0 ? '#dc2626' : '#22c55e', marginTop: 2 }}>
                  {pctChange(data.meta.spend, data.meta.spendPrev) > 0 ? '+' : ''}{pctChange(data.meta.spend, data.meta.spendPrev)}% vs luna anterioara
                </div>
              )}
            </div>
            <div className="card" style={{ borderLeft: '3px solid #22c55e' }}>
              <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginBottom: 4 }}>ROAS</div>
              <div style={{ fontSize: 22, fontWeight: 600, color: data.meta.roas >= 3 ? '#22c55e' : data.meta.roas >= 2 ? '#f59e0b' : '#dc2626' }}>{data.meta.roas}x</div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                {data.meta.roas >= 3 ? 'Excelent' : data.meta.roas >= 2 ? 'Bun' : 'Sub target'}
              </div>
            </div>
            <div className="card" style={{ borderLeft: '3px solid #7c3aed' }}>
              <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginBottom: 4 }}>CAC (Cost Achizitie Client)</div>
              <div style={{ fontSize: 22, fontWeight: 600, color: '#7c3aed' }}>{fmtMoney(data.meta.cac)} RON</div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>{data.meta.newCustomers} clienti noi</div>
            </div>
            <div className="card" style={{ borderLeft: '3px solid #D85A30' }}>
              <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginBottom: 4 }}>LTV / CAC Ratio</div>
              <div style={{ fontSize: 22, fontWeight: 600, color: data.meta.ltvCacRatio >= 3 ? '#22c55e' : data.meta.ltvCacRatio >= 2 ? '#f59e0b' : '#dc2626' }}>{data.meta.ltvCacRatio}x</div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                LTV: {fmtMoney(data.meta.avgLTV)} | CAC: {fmtMoney(data.meta.cac)}
              </div>
            </div>
            <div className="card">
              <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginBottom: 4 }}>Cost per Purchase</div>
              <div style={{ fontSize: 22, fontWeight: 600, color: 'var(--text-primary)' }}>{fmtMoney(data.meta.costPerPurchase)} RON</div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>{data.meta.purchases} conversii</div>
            </div>
            <div className="card">
              <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginBottom: 4 }}>Clicks / CPC</div>
              <div style={{ fontSize: 22, fontWeight: 600, color: 'var(--text-primary)' }}>{fmtNum(data.meta.clicks)}</div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>CPC: {fmtMoney(data.meta.cpc)} | CTR: {data.meta.ctr.toFixed(2)}%</div>
            </div>
          </div>

          {/* Campaigns table */}
          {data.meta.campaigns && data.meta.campaigns.length > 0 && (
            <div className="card" style={{ overflowX: 'auto', marginBottom: 'var(--space-md)' }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 12 }}>Campanii (top 20 dupa spend)</div>
              <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 700 }}>
                <thead>
                  <tr>
                    {['Campanie', 'Spend', 'Impressions', 'Clicks', 'Conversii', 'Cost/conversie', 'ROAS'].map(h => (
                      <th key={h} style={{ textAlign: h === 'Campanie' ? 'left' : 'right', padding: '8px 12px', fontSize: 11, color: 'var(--text-secondary)', fontWeight: 600, borderBottom: '0.5px solid var(--border-default)' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.meta.campaigns.map((c: any, i: number) => (
                    <tr key={i} style={{ borderBottom: '0.5px solid var(--border-default)' }}>
                      <td style={{ padding: '8px 12px', fontSize: 12, maxWidth: 250, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.name}</td>
                      <td style={{ padding: '8px 12px', fontSize: 12, textAlign: 'right', fontWeight: 600 }}>{fmtMoney(c.spend)}</td>
                      <td style={{ padding: '8px 12px', fontSize: 12, textAlign: 'right' }}>{fmtNum(c.impressions)}</td>
                      <td style={{ padding: '8px 12px', fontSize: 12, textAlign: 'right' }}>{fmtNum(c.clicks)}</td>
                      <td style={{ padding: '8px 12px', fontSize: 12, textAlign: 'right', fontWeight: 600 }}>{c.purchases}</td>
                      <td style={{ padding: '8px 12px', fontSize: 12, textAlign: 'right' }}>{c.costPerPurchase > 0 ? fmtMoney(c.costPerPurchase) : '-'}</td>
                      <td style={{ padding: '8px 12px', fontSize: 12, textAlign: 'right', fontWeight: 600, color: c.roas >= 3 ? '#22c55e' : c.roas >= 2 ? '#f59e0b' : c.roas > 0 ? '#dc2626' : 'var(--text-muted)' }}>
                        {c.roas > 0 ? `${c.roas}x` : '-'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {data.isMetaConnected && data.meta?.error && (
        <div className="alert alert-error" style={{ marginBottom: 16 }}>
          Eroare la citirea datelor Meta: {data.meta.error}
        </div>
      )}

      {/* Google Ads — coming soon */}
      <div className="card" style={{ padding: '20px', opacity: 0.6, marginTop: 'var(--space-md)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, fontWeight: 600, color: 'var(--text-primary)' }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
          Google Ads — Coming soon
        </div>
        <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>Integrarea Google Ads va fi disponibila in curand.</p>
      </div>
    </div>
  );
}
