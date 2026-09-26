import React, { useState } from 'react';
import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction } from '@remix-run/node';
import { json } from '@remix-run/node';
import { Form, useActionData, useLoaderData, useNavigation, useSearchParams } from '@remix-run/react';
import { requireUser, requireUserContext } from '~/lib/auth/requireAuth.server';
import { requireModule } from '~/lib/plans.server';
import { db } from '~/lib/db.server';
import { calculateRfm, SEGMENT_COLORS } from '~/lib/rfm/index';
import { formatNumber } from '~/lib/utils';
import { RefreshCw, Users, Download, Tag } from 'lucide-react';

export const meta: MetaFunction = () => [{ title: 'RFM Segments — Kimono BI' }];

export async function loader({ request }: LoaderFunctionArgs) {
  const ctx = await requireUserContext(request);
  const user = ctx.user;
  await requireModule(request, ctx.effectiveOwnerId, 'rfm');
  const url = new URL(request.url);
  const storeId = url.searchParams.get('store');

  const stores = await db.storeConnection.findMany({
    where: { userId: ctx.effectiveOwnerId },
    select: { id: true, name: true },
  });

  const selectedStoreId = storeId || stores[0]?.id;
  if (!selectedStoreId) return json({ stores, segments: [], total: 0, selectedStoreId: null });

  const segments = await db.rfmSegment.groupBy({
    by: ['segment'],
    where: { storeConnectionId: selectedStoreId },
    _count: { segment: true },
  });

  const total = segments.reduce((sum, s) => sum + s._count.segment, 0);
  const segmentData = segments
    .map((s) => ({
      name: s.segment,
      count: s._count.segment,
      percentage: total > 0 ? Math.round((s._count.segment / total) * 1000) / 10 : 0,
      color: SEGMENT_COLORS[s.segment] || '#888',
    }))
    .sort((a, b) => b.count - a.count);

  // Get customer emails per segment for export
  const segmentCustomers: Record<string, Array<{ email: string | null; firstName: string | null; lastName: string | null; totalSpent: number; ordersCount: number; emailSubscribed: boolean }>> = {};
  if (selectedStoreId) {
    const rfmRecords = await db.rfmSegment.findMany({
      where: { storeConnectionId: selectedStoreId },
      select: { segment: true, customerExternalId: true },
    });
    // Batch lookup customers
    const extIds = [...new Set(rfmRecords.map(r => r.customerExternalId))];
    const customers = await db.customer.findMany({
      where: { storeConnectionId: selectedStoreId, externalId: { in: extIds } },
      select: { externalId: true, email: true, firstName: true, lastName: true, totalSpent: true, ordersCount: true, emailSubscribed: true },
    });
    const custMap = new Map(customers.map(c => [c.externalId, c]));
    for (const r of rfmRecords) {
      if (!segmentCustomers[r.segment]) segmentCustomers[r.segment] = [];
      const c = custMap.get(r.customerExternalId);
      if (c) {
        segmentCustomers[r.segment].push({
          email: c.email, firstName: c.firstName, lastName: c.lastName,
          totalSpent: Number(c.totalSpent), ordersCount: c.ordersCount,
          emailSubscribed: c.emailSubscribed || false,
        });
      }
    }
  }

  // Split segment counts: email subscribed vs ads retargeting
  const subscribedCounts: Record<string, number> = {};
  const adsCounts: Record<string, number> = {};
  for (const [seg, custs] of Object.entries(segmentCustomers)) {
    subscribedCounts[seg] = custs.filter(c => c.emailSubscribed).length;
    adsCounts[seg] = custs.filter(c => !c.emailSubscribed).length;
  }

  const totalSubscribed = Object.values(subscribedCounts).reduce((s, v) => s + v, 0);
  const totalAds = Object.values(adsCounts).reduce((s, v) => s + v, 0);

  // Customers with 0 orders (not in RFM)
  const totalAllCustomers = selectedStoreId ? await db.customer.count({ where: { storeConnectionId: selectedStoreId } }) : 0;
  const noOrdersCount = totalAllCustomers - total;
  const noOrdersSubscribed = selectedStoreId ? await db.customer.count({ where: { storeConnectionId: selectedStoreId, ordersCount: 0, emailSubscribed: true } }) : 0;
  const noOrdersAds = noOrdersCount - noOrdersSubscribed;

  return json({ stores, segments: segmentData, total, selectedStoreId, segmentCustomers, subscribedCounts, adsCounts, totalSubscribed, totalAds, noOrdersCount, noOrdersSubscribed, noOrdersAds, totalAllCustomers });
}

export async function action({ request }: ActionFunctionArgs) {
  const ctx = await requireUserContext(request);
  const user = ctx.user;
  const form = await request.formData();
  const storeId = String(form.get('storeId'));
  const intent = String(form.get('intent') || 'recalculate');

  const store = await db.storeConnection.findFirst({ where: { id: storeId, userId: ctx.effectiveOwnerId } });
  if (!store) return json({ error: 'Store not found' }, { status: 404 });

  if (intent === 'recalculate') {
    const result = await calculateRfm(storeId);
    return json({ success: true, ...result });
  }

  if (intent === 'tag-shopify') {
    const segment = String(form.get('segment'));
    if (!segment) return json({ error: 'Segment lipsa' }, { status: 400 });
    if (!store.shopifyAccessToken) return json({ error: 'Token Shopify lipsa' }, { status: 400 });

    // Get customers in this segment - only subscribed
    const rfmRecords = await db.rfmSegment.findMany({
      where: { storeConnectionId: storeId, segment },
      select: { customerExternalId: true },
    });

    // Filter only email subscribed customers
    const subscribedExternalIds = new Set(
      (await db.customer.findMany({
        where: { storeConnectionId: storeId, emailSubscribed: true, externalId: { in: rfmRecords.map(r => r.customerExternalId) } },
        select: { externalId: true },
      })).map(c => c.externalId)
    );
    const filteredRecords = rfmRecords.filter(r => subscribedExternalIds.has(r.customerExternalId));

    if (filteredRecords.length === 0) return json({ error: 'Niciun client abonat in segment' }, { status: 400 });

    // Decrypt token
    const crypto = await import('crypto');
    const encKey = Buffer.from(process.env.APP_ENCRYPTION_KEY!, 'hex');
    const [iv, tag, ct] = store.shopifyAccessToken.split(':').map(h => Buffer.from(h, 'hex'));
    const decipher = crypto.createDecipheriv('aes-256-gcm', encKey, iv);
    decipher.setAuthTag(tag);
    const token = decipher.update(ct) + decipher.final('utf8');

    const roLabels: Record<string, string> = {
      Champions: 'Campioni', 'Loyal Customers': 'Fideli', 'Potential Loyalist': 'Potential-Fidel',
      'Recent Customers': 'Clienti-Noi', Promising: 'Promitatori',
      'Need Attention': 'Necesita-Atentie', 'At Risk': 'In-Pericol', Lost: 'Pierduti',
    };
    const tagName = "RFM-" + (roLabels[segment] || segment.replace(/ /g, "-"));
    let tagged = 0;
    let errors = 0;

    // Tag customers in batches of 10
    for (let i = 0; i < filteredRecords.length; i += 10) {
      const batch = filteredRecords.slice(i, i + 10);
      const mutations = batch.map((r, idx) => `
        t${idx}: tagsAdd(id: "${r.customerExternalId}", tags: ["${tagName}"]) {
          userErrors { message }
        }
      `).join('');

      try {
        const res = await fetch(`https://${store.domain}/admin/api/2025-04/graphql.json`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': token },
          body: JSON.stringify({ query: `mutation { ${mutations} }` }),
        });
        const j = await res.json();
        if (j.errors) { errors += batch.length; }
        else { tagged += batch.length; }
      } catch { errors += batch.length; }

      // Rate limit respect
      if (i + 10 < filteredRecords.length) await new Promise(r => setTimeout(r, 500));
    }

    // Auto-create Shopify customer segment
    let segmentMsg = '';
    try {
      const roLabelsForSeg: Record<string, string> = {
        Champions: 'Campioni', 'Loyal Customers': 'Fideli', 'Potential Loyalist': 'Potential Fidel',
        'Recent Customers': 'Clienti Noi', Promising: 'Promitatori',
        'Need Attention': 'Necesita Atentie', 'At Risk': 'In Pericol', Lost: 'Pierduti',
      };
      const segName = 'RFM: ' + (roLabelsForSeg[segment] || segment);
      const segQ = "customer_tags CONTAINS '" + tagName + "'";
      const segRes = await fetch(`https://${store.domain}/admin/api/2025-04/graphql.json`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': token },
        body: JSON.stringify({
          query: `mutation($name: String!, $query: String!) { segmentCreate(name: $name, query: $query) { segment { id name } userErrors { message } } }`,
          variables: { name: segName, query: segQ },
        }),
      });
      const segJ = await segRes.json();
      if (segJ.data?.segmentCreate?.segment?.id) {
        segmentMsg = ` Segment "${segName}" creat automat in Shopify.`;
      } else if (segJ.data?.segmentCreate?.userErrors?.[0]?.message) {
        segmentMsg = ` Segment: ${segJ.data.segmentCreate.userErrors[0].message}`;
      }
    } catch (e) {
      segmentMsg = '';
    }

    return json({ success: true, message: `${tagged} clienti tagati cu "${tagName}" in Shopify.${segmentMsg} ${errors > 0 ? errors + ' erori.' : ''}` });
  }

  if (intent === 'sync-all-shopify') {
    if (!store.shopifyAccessToken) return json({ error: 'Token Shopify lipsă' }, { status: 400 });

    const crypto = await import('crypto');
    const encKey = Buffer.from(process.env.APP_ENCRYPTION_KEY!, 'hex');
    const [sIv, sTag, sCt] = store.shopifyAccessToken.split(':').map((h: string) => Buffer.from(h, 'hex'));
    const sDecipher = crypto.createDecipheriv('aes-256-gcm', encKey, sIv);
    sDecipher.setAuthTag(sTag);
    const sToken = sDecipher.update(sCt) + sDecipher.final('utf8');

    // Get all RFM records - only for subscribed customers
    const allRfmRaw = await db.rfmSegment.findMany({
      where: { storeConnectionId: storeId },
      select: { customerExternalId: true, segment: true },
    });
    const allSubscribedIds = new Set(
      (await db.customer.findMany({
        where: { storeConnectionId: storeId, emailSubscribed: true },
        select: { externalId: true },
      })).map(c => c.externalId)
    );
    const allRfm = allRfmRaw.filter(r => allSubscribedIds.has(r.customerExternalId));

    const roLabelsAll: Record<string, string> = {
      Champions: 'Campioni', 'Loyal Customers': 'Fideli', 'Potential Loyalist': 'Potential-Fidel',
      'Recent Customers': 'Clienti-Noi', Promising: 'Promitatori',
      'Need Attention': 'Necesita-Atentie', 'At Risk': 'In-Pericol', Lost: 'Pierduti',
    };
    const allRfmTags = Object.values(roLabelsAll).map(l => 'RFM-' + l);

    let tagged = 0;
    let errors = 0;

    for (let i = 0; i < allRfm.length; i += 10) {
      const batch = allRfm.slice(i, i + 10);
      const mutations = batch.map((r, idx) => {
        const newTag = 'RFM-' + (roLabelsAll[r.segment] || r.segment.replace(/ /g, '-'));
        const removeTags = allRfmTags.filter(t => t !== newTag);
        return `remove${idx}: tagsRemove(id: "${r.customerExternalId}", tags: ${JSON.stringify(removeTags)}) { userErrors { message } } add${idx}: tagsAdd(id: "${r.customerExternalId}", tags: ["${newTag}"]) { userErrors { message } }`;
      }).join(' ');

      try {
        const res = await fetch(`https://${store.domain}/admin/api/2025-04/graphql.json`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': sToken },
          body: JSON.stringify({ query: `mutation { ${mutations} }` }),
        });
        const j = await res.json();
        if (j.errors?.some((e: any) => e.extensions?.code === 'THROTTLED')) {
          await new Promise(r => setTimeout(r, 5000));
          i -= 10; // retry batch
          continue;
        }
        tagged += batch.length;
      } catch { errors += batch.length; }

      await new Promise(r => setTimeout(r, 500));
    }

    return json({ success: true, message: `${tagged} clienți actualizați în Shopify. ${errors > 0 ? errors + ' erori.' : 'Segmentele se actualizează automat.'}` });
  }

  if (intent === 'remove-tags') {
    if (!store.shopifyAccessToken) return json({ error: 'Token Shopify lipsă' }, { status: 400 });

    const rfmCount = await db.rfmSegment.count({ where: { storeConnectionId: storeId } });

    // Run removal script in background
    const { exec } = await import('child_process');
    exec('cd /root/business-intelligence-kimono-nu-seo && set -a && . ./.env && set +a && node scripts/remove-rfm-tags.cjs >> /root/logs/kimono-bi-standalone/remove-tags.log 2>&1');

    return json({ success: true, message: `Ștergerea tag-urilor RFM a început pentru ~${rfmCount} clienți. Procesul rulează în background (~500/min).` });
  }

  if (intent === 'create-noorders-segment') {
    if (!store.shopifyAccessToken) return json({ error: 'Token Shopify lipsă' }, { status: 400 });
    const crypto2 = await import('crypto');
    const encKey2 = Buffer.from(process.env.APP_ENCRYPTION_KEY!, 'hex');
    const [nIv, nTag, nCt] = store.shopifyAccessToken.split(':').map((h: string) => Buffer.from(h, 'hex'));
    const nDecipher = crypto2.createDecipheriv('aes-256-gcm', encKey2, nIv);
    nDecipher.setAuthTag(nTag);
    const nToken = nDecipher.update(nCt) + nDecipher.final('utf8');

    try {
      const segRes = await fetch(`https://${store.domain}/admin/api/2025-04/graphql.json`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': nToken },
        body: JSON.stringify({
          query: `mutation($name: String!, $query: String!) { segmentCreate(name: $name, query: $query) { segment { id name } userErrors { message } } }`,
          variables: { name: 'Fără comenzi plasate', query: "number_of_orders = 0" },
        }),
      });
      const segJ = await segRes.json();
      const seg = segJ.data?.segmentCreate?.segment;
      const err = segJ.data?.segmentCreate?.userErrors?.[0]?.message;
      if (seg) {
        return json({ success: true, message: `Segment "Fără comenzi plasate" creat în Shopify.` });
      } else {
        return json({ success: true, message: err || 'Segmentul există deja în Shopify.' });
      }
    } catch (e: any) {
      return json({ error: e?.message || 'Eroare la crearea segmentului' }, { status: 500 });
    }
  }

  return json({ error: 'Unknown intent' }, { status: 400 });
}

const SEGMENT_META: Record<string, { label: string; desc: string; action: string; actionColor: string }> = {
  'Champions':         { label: 'Campioni',              desc: 'Cei mai buni clienți. Cumpără des, recent și cheltuiesc mult.',           action: 'Răsplătește și fă upsell',   actionColor: '#16a34a' },
  'Loyal Customers':   { label: 'Clienți fideli',   desc: 'Cumpără regulat cu valoare bună, dar nu la fel de des ca Campionii.',  action: 'Program de loialitate',       actionColor: '#22c55e' },
  'Potential Loyalist':{ label: 'Potențial fidel',   desc: 'Clienți noi care au cumpărat recent și au potențial să devină fideli.',  action: 'Email-uri de bun venit',      actionColor: '#2563eb' },
  'Recent Customers':  { label: 'Clienți noi',       desc: 'Au făcut prima comandă recent. Trebuie convinși să revină.',             action: 'Secvență de nurture',           actionColor: '#0ea5e9' },
  'Promising':         { label: 'Promitători',       desc: 'Au profil bun dar frecvența e scăzută. Cu o ofertă potrivită, revin.',    action: 'Ofertă de activare',        actionColor: '#FF5A1F' },
  'Need Attention':    { label: 'Necesită atenție', desc: 'Au fost clienți buni dar nu au mai cumpărat de ceva timp.',           action: 'Reactivare urgentă',        actionColor: '#d97706' },
  'At Risk':           { label: 'În pericol',          desc: 'Clienți valoroși care dau semne că ne părăsesc.',                      action: 'Campanie win-back',           actionColor: '#dc2626' },
  'Lost':              { label: 'Pierduți',           desc: 'Nu au mai cumpărat de mult. Ultima șansă de recuperare.',                   action: 'Campanie re-engagement',      actionColor: '#525252' },
};


const SEGMENT_DETAILS: Record<string, string[]> = {
  'Champions': [
    'Trimite email de multumire personalizat',
    'Ofera acces la produse noi inainte de lansare',
    'Creeaza un program VIP cu beneficii exclusive',
    'Recomanda produse complementare (upsell)',
    'Invita-i sa lase review-uri pe site',
  ],
  'Loyal Customers': [
    'Inscrie-i intr-un program de loialitate cu puncte',
    'Ofera discount la urmatoarea comanda',
    'Trimite oferte personalizate pe baza istoricului',
    'Recomanda produse din categorii noi',
  ],
  'Potential Loyalist': [
    'Trimite email de bun-venit cu ghid de utilizare',
    'Ofera 10% discount la a doua comanda',
    'Prezinta gama completa de produse',
    'Adauga-i in secventa de onboarding automatizat',
  ],
  'Recent Customers': [
    'Trimite secventa de nurture emails (3-5 emailuri)',
    'Ofera transport gratuit la urmatoarea comanda',
    'Prezinta produse best-seller si recenzii',
    'Reaminteste beneficiile magazinului tau',
  ],
  'Promising': [
    'Activeaza cu o oferta limitata in timp',
    'Trimite continut educational despre produse',
    'Ofera bundle-uri cu discount',
    'Personalizeaza emailurile pe baza achizitiei anterioare',
  ],
  'Need Attention': [
    'URGENT: Trimite email de reactivare cu discount 15-20%',
    'Intreaba prin sondaj de ce nu au mai cumparat',
    'Prezinta produse noi aparute de la ultima comanda',
    'Ofera transport gratuit + cadou la comanda',
  ],
  'At Risk': [
    'Campanie win-back cu discount agresiv (25-30%)',
    'Email personalizat: "Ne este dor de tine"',
    'Ofera produse complementare la ce au cumparat',
    'Remarketing ads targetat pe acest segment',
  ],
  'Lost': [
    'Campanie de re-engagement cu oferta irezistibila',
    'Email cu "Ce ai pierdut" - produse noi, review-uri',
    'Sondaj: de ce nu mai cumperi de la noi?',
    'Ads de remarketing cu produse best-seller',
    'Daca nu raspund in 30 zile, muta in lista inactiva',
  ],
};

export default function RfmPage() {
  const { stores, segments, total, selectedStoreId, segmentCustomers, subscribedCounts, adsCounts, totalSubscribed, totalAds, noOrdersCount, noOrdersSubscribed, noOrdersAds, totalAllCustomers } = useLoaderData<typeof loader>();
  const [, setSearchParams] = useSearchParams();
  const navigation = useNavigation();
  const actionData = useActionData<typeof action>();
  const isCalculating = navigation.state === 'submitting';
  const [expandedSegment, setExpandedSegment] = useState<string | null>(null);

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">RFM Segments</h1>
          <p className="page-subtitle">
            {total > 0
              ? `${formatNumber(totalAllCustomers || total)} clienți segmentați pe Recency · Frequency · Monetary`
              : 'Recency · Frequency · Monetary'}
          </p>
        </div>
        <div className="page-actions">
          {stores.length > 1 && (
            <select
              className="form-input"
              style={{ width: 180 }}
              value={selectedStoreId || ''}
              onChange={(e) => setSearchParams({ store: e.target.value })}
            >
              {stores.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          )}
          {selectedStoreId && (
            <>
            <Form method="post" style={{ display: 'inline' }}>
              <input type="hidden" name="storeId" value={selectedStoreId} />
              <input type="hidden" name="intent" value="remove-tags" />
              <input type="hidden" name="segment" value="__all__" />
              <button type="submit" className="btn btn-secondary" disabled={isCalculating} style={{ fontSize: 12, color: 'var(--danger-text)' }}>
                {isCalculating ? 'Ștergere...' : 'Șterge tag-uri'}
              </button>
            </Form>
            <Form method="post" style={{ display: 'inline' }}>
              <input type="hidden" name="storeId" value={selectedStoreId} />
              <input type="hidden" name="intent" value="sync-all-shopify" />
              <button type="submit" className="btn btn-secondary" disabled={isCalculating} style={{ fontSize: 12 }}>
                <Tag size={12} />
                {isCalculating ? 'Se sincronizează...' : 'Actualizează Shopify'}
              </button>
            </Form>
            <Form method="post" style={{ display: 'inline' }}>
              <input type="hidden" name="storeId" value={selectedStoreId} />
              <input type="hidden" name="intent" value="recalculate" />
              <button type="submit" className="btn btn-secondary" disabled={isCalculating}>
                <RefreshCw size={12} style={{ animation: isCalculating ? 'spin 1s linear infinite' : undefined }} />
                {isCalculating ? 'Se calculează...' : 'Recalculează'}
              </button>
            </Form>
            </>
          )}
        </div>
      </div>

      {actionData?.message && (
        <div className="alert alert-success" style={{ marginBottom: 16 }}>{actionData.message}</div>
      )}

      {segments.length === 0 ? (
        <div className="card" style={{ textAlign: 'center', padding: '56px 24px' }}>
          <div style={{ width: 48, height: 48, background: 'var(--bg-tertiary)', borderRadius: '50%', margin: '0 auto 16px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Users size={22} color="var(--text-secondary)" />
          </div>
          <p style={{ fontSize: 14, color: 'var(--text-secondary)', marginBottom: 20 }}>
            Nu există date RFM. Sincronizează un magazin și apasă "Recalculează".
          </p>
          {selectedStoreId && (
            <Form method="post">
              <input type="hidden" name="storeId" value={selectedStoreId} />
              <button type="submit" className="btn btn-primary" disabled={isCalculating}>
                <RefreshCw size={12} /> Calculează acum
              </button>
            </Form>
          )}
        </div>
      ) : (
        <>
          {/* Distribution bar */}
          <div className="card" style={{ padding: '16px 20px', marginBottom: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10 }}>
              <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-primary)' }}>Distribuție clienți</span>
              <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{formatNumber(totalAllCustomers || total)} total</span>
            </div>
            <div style={{ display: 'flex', height: 10, borderRadius: 5, overflow: 'hidden', gap: 1 }}>
              {segments.map((s) => {
                const subCount = (subscribedCounts as any)?.[s.name] || 0;
                const barPct = totalAllCustomers > 0 ? (subCount / totalAllCustomers) * 100 : 0;
                return (
                <div
                  key={s.name}
                  style={{ width: `${barPct}%`, background: s.color, minWidth: barPct > 0 ? 2 : 0 }}
                  title={`${SEGMENT_META[s.name]?.label || s.name}: ${barPct.toFixed(1)}%`}
                />
                );
              })}
              {(totalAds || 0) > 0 && (
                <div
                  style={{ width: `${totalAllCustomers > 0 ? ((totalAds + noOrdersAds) / totalAllCustomers) * 100 : 0}%`, background: '#7c3aed', minWidth: 3 }}
                  title={`Retargetare Ads: ${totalAllCustomers > 0 ? ((totalAds / totalAllCustomers) * 100).toFixed(1) : 0}%`}
                />
              )}
              {(noOrdersCount || 0) > 0 && (
                <div
                  style={{ width: `${totalAllCustomers > 0 ? (noOrdersSubscribed / totalAllCustomers) * 100 : 0}%`, background: '#a3a3a3', minWidth: 3 }}
                  title={`Fără comenzi (email): ${totalAllCustomers > 0 ? ((noOrdersSubscribed / totalAllCustomers) * 100).toFixed(1) : 0}%`}
                />
              )}
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px 16px', marginTop: 10 }}>
              {segments.map((s) => {
                const subCount = (subscribedCounts as any)?.[s.name] || 0;
                const pct = totalAllCustomers > 0 ? ((subCount / totalAllCustomers) * 100).toFixed(1) : '0';
                return (
                <div key={s.name} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                  <span style={{ width: 8, height: 8, borderRadius: '50%', background: s.color, flexShrink: 0 }} />
                  <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{SEGMENT_META[s.name]?.label || s.name} ({pct}%)</span>
                </div>
                );
              })}
              {(totalAds || 0) > 0 && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                  <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#7c3aed', flexShrink: 0 }} />
                  <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>Retargetare Ads ({totalAllCustomers > 0 ? (((totalAds + noOrdersAds) / totalAllCustomers) * 100).toFixed(1) : 0}%)</span>
                </div>
              )}
              {(noOrdersCount || 0) > 0 && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                  <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#a3a3a3', flexShrink: 0 }} />
                  <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>Fără comenzi ({totalAllCustomers > 0 ? ((noOrdersSubscribed / totalAllCustomers) * 100).toFixed(1) : 0}%)</span>
                </div>
              )}
            </div>
          </div>

          {/* Segment grid */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 12 }}>
            {segments.map((s) => {
              const meta = SEGMENT_META[s.name];
              const bgOpacity = '18';
              const isExpanded = expandedSegment === s.name;
              return (
                <React.Fragment key={s.name}>
                <div
                  className="card"
                  onClick={() => setExpandedSegment(isExpanded ? null : s.name)}
                  style={{ padding: '16px 18px', borderLeft: `3px solid ${s.color}`, cursor: 'pointer', transition: 'all 0.15s', border: isExpanded ? `1.5px solid ${s.color}` : '0.5px solid var(--border-default)', background: isExpanded ? 'var(--bg-page)' : 'white' }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
                    <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-primary)' }}>{meta?.label || s.name}</span>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontSize: 20, fontWeight: 500, letterSpacing: '-0.5px', color: 'var(--text-primary)' }}>
                        {formatNumber((subscribedCounts as any)?.[s.name] ?? s.count)}
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
                        {totalAllCustomers > 0 ? (((subscribedCounts as any)?.[s.name] || 0) / totalAllCustomers * 100).toFixed(1) : s.percentage}%
                      </div>
                    </div>
                  </div>

                  {/* Mini bar */}
                  <div style={{ height: 3, borderRadius: 2, background: 'var(--border-default)', marginBottom: 10, overflow: 'hidden' }}>
                    <div style={{ width: `${totalAllCustomers > 0 ? ((subscribedCounts as any)?.[s.name] || 0) / totalAllCustomers * 100 : s.percentage}%`, height: '100%', background: s.color }} />
                  </div>

                  {meta && (
                    <>
                      <p style={{ fontSize: 11, color: 'var(--text-secondary)', lineHeight: 1.4, marginBottom: 8 }}>
                        {meta.desc}
                      </p>
                      <span style={{
                        fontSize: 10,
                        fontWeight: 600,
                        padding: '3px 10px',
                        borderRadius: 99,
                        background: `${meta.actionColor || s.color}15`,
                        color: meta.actionColor || s.color,
                      }}>
                        {meta.action}
                      </span>

                    </>
                  )}
                </div>
                {isExpanded && (
                  <div style={{ gridColumn: '1 / -1', background: 'white', border: `1.5px solid ${s.color}`, borderRadius: 10, padding: '20px 24px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <div style={{ width: 4, height: 20, background: s.color, borderRadius: 2 }} />
                        <span style={{ fontSize: 15, fontWeight: 600, color: s.color }}>{SEGMENT_META[s.name]?.label || s.name}</span>

                      </div>
                      <div style={{ display: 'flex', gap: 8 }}>
                        <Form method="post" style={{ display: 'inline' }} onClick={(e) => e.stopPropagation()}>
                          <input type="hidden" name="storeId" value={selectedStoreId || ''} />
                          <input type="hidden" name="intent" value="tag-shopify" />
                          <input type="hidden" name="segment" value={s.name} />
                          <button type="submit" className="btn btn-primary" style={{ fontSize: 11, padding: '5px 12px' }} disabled={isCalculating}>
                            <Tag size={11} /> Sync Shopify
                          </button>
                        </Form>
                        <button onClick={(e) => {
                          e.stopPropagation();
                          const allCustomers = (segmentCustomers as any)?.[s.name] || [];
                          const customers = allCustomers.filter((c: any) => c.emailSubscribed);
                          const header = 'Email,Nume,Prenume,Total Cheltuit,Nr Comenzi';
                          const rows = customers.map((c: any) =>
                            `"${c.email || ''}","${c.lastName || ''}","${c.firstName || ''}",${c.totalSpent},${c.ordersCount}`
                          );
                          const blob = new Blob([header + '\n' + rows.join('\n')], { type: 'text/csv' });
                          const url = URL.createObjectURL(blob);
                          const a = document.createElement('a'); a.href = url; a.download = `rfm-${s.name.toLowerCase().replace(/\s+/g, '-')}.csv`; a.click();
                          URL.revokeObjectURL(url);
                        }} className="btn btn-secondary" style={{ fontSize: 11, padding: '5px 12px' }}>
                          <Download size={11} /> Export CSV ({formatNumber(s.count)})
                        </button>
                        <button onClick={(e) => { e.stopPropagation(); setExpandedSegment(null); }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-tertiary)', fontSize: 16, padding: '2px 6px' }}>&times;</button>
                      </div>
                    </div>
                    {SEGMENT_DETAILS[s.name] && (
                      <div>
                        <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 10 }}>Acțiuni recomandate</div>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '8px 24px' }}>
                          {SEGMENT_DETAILS[s.name].map((tip: string, idx: number) => (
                            <div key={idx} style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" style={{ flexShrink: 0, marginTop: 2 }}>
                                <circle cx="8" cy="8" r="8" fill={s.color} opacity="0.12" />
                                <path d="M5 8l2 2 4-4" stroke={s.color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                              </svg>
                              <span style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.5 }}>{tip}</span>
                            </div>
                          ))}
                        </div>


                      </div>
                    )}
                  </div>
                )}
                </React.Fragment>
              );
            })}

            {/* Fără comenzi plasate */}
            {(noOrdersSubscribed || 0) > 0 && (
              <React.Fragment>
              <div
                className="card"
                onClick={() => setExpandedSegment(expandedSegment === '__noorders__' ? null : '__noorders__')}
                style={{ padding: '16px 18px', borderLeft: '3px solid #a3a3a3', cursor: 'pointer', transition: 'all 0.15s', border: expandedSegment === '__noorders__' ? '1.5px solid #a3a3a3' : '0.5px solid var(--border-default)', background: expandedSegment === '__noorders__' ? 'var(--bg-page)' : 'white' }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
                  <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-primary)' }}>Fără comenzi plasate</span>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: 20, fontWeight: 500, letterSpacing: '-0.5px', color: '#a3a3a3' }}>{formatNumber(noOrdersSubscribed)}</div>
                    <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{totalAllCustomers > 0 ? ((noOrdersSubscribed / totalAllCustomers) * 100).toFixed(1) : 0}%</div>
                  </div>
                </div>
                <div style={{ height: 3, borderRadius: 2, background: 'var(--border-default)', marginBottom: 10, overflow: 'hidden' }}>
                  <div style={{ width: `${totalAllCustomers > 0 ? (noOrdersSubscribed / totalAllCustomers) * 100 : 0}%`, height: '100%', background: '#a3a3a3' }} />
                </div>
                <p style={{ fontSize: 11, color: 'var(--text-secondary)', lineHeight: 1.4, marginBottom: 8 }}>
                  Au cont dar nu au plasat nicio comandă. Necesită campanie de activare.
                </p>
                <span style={{ fontSize: 10, fontWeight: 600, padding: '2px 8px', borderRadius: 99, background: 'rgba(163,163,163,0.1)', color: '#a3a3a3' }}>
                  Activare prima comandă
                </span>
              </div>

              {expandedSegment === '__noorders__' && (
                <div style={{ gridColumn: '1 / -1', background: 'white', border: '1.5px solid #a3a3a3', borderRadius: 10, padding: '20px 24px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <div style={{ width: 4, height: 20, background: '#a3a3a3', borderRadius: 2 }} />
                      <span style={{ fontSize: 15, fontWeight: 600, color: '#a3a3a3' }}>Fără comenzi plasate</span>

                    </div>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <Form method="post" style={{ display: 'inline' }} onClick={(e: any) => e.stopPropagation()}>
                        <input type="hidden" name="storeId" value={selectedStoreId || ''} />
                        <input type="hidden" name="intent" value="create-noorders-segment" />
                        <button type="submit" className="btn btn-primary" style={{ fontSize: 11, padding: '5px 12px' }} disabled={isCalculating}>
                          <Tag size={11} /> Creează segment Shopify
                        </button>
                      </Form>
                      <button onClick={(e) => { e.stopPropagation(); setExpandedSegment(null); }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-tertiary)', fontSize: 16, padding: '2px 6px' }}>&times;</button>
                    </div>
                  </div>

                  <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 10 }}>Acțiuni recomandate</div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '8px 24px', marginBottom: 16 }}>
                    {[
                      'Trimite email de bun venit cu ofertă pentru prima comandă',
                      'Oferă discount 10-15% pentru prima achiziție',
                      'Prezintă produsele best-seller și recenziile clienților',
                      'Secvență automată de nurture (3-5 emailuri)',
                    ].map((tip, idx) => (
                      <div key={idx} style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" style={{ flexShrink: 0, marginTop: 2 }}>
                          <circle cx="8" cy="8" r="8" fill="#a3a3a3" opacity="0.12" />
                          <path d="M5 8l2 2 4-4" stroke="#a3a3a3" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                        <span style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.5 }}>{tip}</span>
                      </div>
                    ))}
                  </div>


                </div>
              )}
              </React.Fragment>
            )}

            {/* Retargetare cu Ads */}
            {(totalAds || 0) > 0 && (
              <div className="card" style={{ padding: '16px 18px', borderLeft: '3px solid #7c3aed' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
                  <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-primary)' }}>Retargetare cu Ads</span>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: 20, fontWeight: 500, letterSpacing: '-0.5px', color: '#7c3aed' }}>{formatNumber((totalAds || 0) + (noOrdersAds || 0))}</div>
                    <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{totalAllCustomers > 0 ? (((totalAds + noOrdersAds) / totalAllCustomers) * 100).toFixed(1) : 0}%</div>
                  </div>
                </div>
                <div style={{ height: 3, borderRadius: 2, background: 'var(--border-default)', marginBottom: 10, overflow: 'hidden' }}>
                  <div style={{ width: `${totalAllCustomers > 0 ? ((totalAds + noOrdersAds) / totalAllCustomers) * 100 : 0}%`, height: '100%', background: '#7c3aed' }} />
                </div>
                <p style={{ fontSize: 11, color: 'var(--text-secondary)', lineHeight: 1.4, marginBottom: 8 }}>
                  Nu acceptă email marketing. Contact doar prin reclame plătite.
                </p>
                <span style={{ fontSize: 10, fontWeight: 600, padding: '2px 8px', borderRadius: 99, background: 'rgba(124,58,237,0.1)', color: '#7c3aed' }}>
                  Meta & Google Ads
                </span>
              </div>
            )}


          </div>


          {/* Legenda criterii RFM */}
          <div style={{ marginTop: 16, padding: '16px 20px', background: 'var(--bg-tertiary)', borderRadius: 10 }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 10 }}>Criterii de segmentare</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '6px 24px' }}>
              {[
                { color: '#d97706', label: 'Necesită atenție', criteria: 'Recency mediu · Frequency medie · Monetary mediu' },
                { color: '#525252', label: 'Pierduți', criteria: 'Recency scăzut · Frequency scăzută · Monetary scăzut' },
                { color: '#2563eb', label: 'Potențial fidel', criteria: 'Recency ridicat · Frequency scăzută · Monetary scăzut' },
                { color: '#0ea5e9', label: 'Clienți noi', criteria: 'Recency ridicat · 1 comandă · Monetary variabil' },
                { color: '#FF5A1F', label: 'Promițători', criteria: 'Recency mediu-ridicat · Frequency scăzută · Monetary scăzut' },
                { color: '#16a34a', label: 'Campioni', criteria: 'Recency ridicat · Frequency ridicată · Monetary ridicat' },
                { color: '#dc2626', label: 'În pericol', criteria: 'Recency scăzut · Frequency ridicată · Monetary ridicat' },
                { color: '#22c55e', label: 'Clienți fideli', criteria: 'Recency mediu-ridicat · Frequency medie-ridicată · Monetary mediu-ridicat' },
                { color: '#a3a3a3', label: 'Fără comenzi', criteria: '0 comenzi plasate · Campanie activare prima comandă' },
                { color: '#7c3aed', label: 'Retargetare Ads', criteria: 'Email neabonat / fără status · Contact prin reclame plătite' },
              ].map((item) => (
                <div key={item.label} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, padding: '4px 0' }}>
                  <span style={{ width: 8, height: 8, borderRadius: '50%', background: item.color, flexShrink: 0, marginTop: 4 }} />
                  <div>
                    <span style={{ fontSize: 11, fontWeight: 600, color: item.color }}>{item.label}</span>
                    <span style={{ fontSize: 10, color: 'var(--text-tertiary)', marginLeft: 6 }}>{item.criteria}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>

        </>
      )}
    </div>
  );
}
