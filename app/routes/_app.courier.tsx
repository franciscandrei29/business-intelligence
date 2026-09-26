import type { LoaderFunctionArgs, MetaFunction } from '@remix-run/node';
import { json } from '@remix-run/node';
import type { ActionFunctionArgs } from '@remix-run/node';
import { Form, Link, useActionData, useLoaderData, useNavigation, useSearchParams } from '@remix-run/react';

import { requireUserContext } from '~/lib/auth/requireAuth.server';
import { db } from '~/lib/db.server';

import { Truck, Package, CheckCircle, XCircle, Clock, ArrowUpDown, Download, Globe, FileText } from 'lucide-react';
import { useState } from 'react';

export const meta: MetaFunction = () => [{ title: 'Courier Tracking — Kimono BI' }];

function Flag({ code, size = 16 }: { code: string; size?: number }) {
  const h = size;
  const w = Math.round(h * 1.5);
  const r = 2;
  const flags: Record<string, React.ReactNode> = {
    RO: (
      <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} style={{ display: 'inline-block', verticalAlign: 'middle', borderRadius: r, overflow: 'hidden', boxShadow: '0 0 0 0.5px rgba(0,0,0,0.1)' }}>
        <rect x={0} y={0} width={w/3} height={h} fill="#002B7F" />
        <rect x={w/3} y={0} width={w/3} height={h} fill="#FCD116" />
        <rect x={w*2/3} y={0} width={w/3} height={h} fill="#CE1126" />
      </svg>
    ),
    HU: (
      <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} style={{ display: 'inline-block', verticalAlign: 'middle', borderRadius: r, overflow: 'hidden', boxShadow: '0 0 0 0.5px rgba(0,0,0,0.1)' }}>
        <rect x={0} y={0} width={w} height={h/3} fill="#CE2939" />
        <rect x={0} y={h/3} width={w} height={h/3} fill="#FFFFFF" />
        <rect x={0} y={h*2/3} width={w} height={h/3} fill="#477050" />
      </svg>
    ),
    EU: (
      <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} style={{ display: 'inline-block', verticalAlign: 'middle', borderRadius: r, overflow: 'hidden', boxShadow: '0 0 0 0.5px rgba(0,0,0,0.1)' }}>
        <rect x={0} y={0} width={w} height={h} fill="#003399" />
        <text x={w/2} y={h/2+1} textAnchor="middle" dominantBaseline="central" fill="#FFCC00" fontSize={h*0.5} fontWeight="bold">★</text>
      </svg>
    ),
  };
  return <>{flags[code] || <span style={{ fontSize: size * 0.75 }}>{code}</span>}</>;
}

const COUNTRY_MAP: Record<string, { code: string; name: string }> = {
  RON: { code: 'RO', name: 'Romania' },
  HUF: { code: 'HU', name: 'Ungaria' },
  EUR: { code: 'EU', name: 'Europa' },
};

export async function action({ request }: ActionFunctionArgs) {
  const ctx = await requireUserContext(request);
  const form = await request.formData();
  const intent = String(form.get('intent'));
  const storeId = String(form.get('storeId'));

  const store = await db.storeConnection.findFirst({
    where: { id: storeId, userId: ctx.effectiveOwnerId },
  });
  if (!store) return json({ error: 'Magazin negasit.' }, { status: 404 });

  if (intent === 'connectCourier') {
    const courierUsername = String(form.get('courierUsername') || '').trim();
    const courierPassword = String(form.get('courierPassword') || '').trim();
    if (!courierUsername || !courierPassword) {
      return json({ error: 'Username si parola sunt obligatorii.' }, { status: 400 });
    }

    // Test connection
    try {
      const testRes = await fetch('https://api.sameday.ro/api/authenticate?remember_me=1', {
        method: 'POST',
        headers: { 'X-AUTH-USERNAME': courierUsername, 'X-AUTH-PASSWORD': courierPassword },
      });
      if (!testRes.ok) return json({ error: 'Autentificare esuata. Verifica username si parola.' }, { status: 400 });
    } catch (e: any) {
      return json({ error: `Conexiune esuata: ${e.message}` }, { status: 400 });
    }

    const { encrypt } = await import('~/lib/auth/crypto.server');
    await db.storeSettings.upsert({
      where: { storeConnectionId: storeId },
      create: { storeConnectionId: storeId, courierProvider: 'sameday', courierUsername: encrypt(courierUsername), courierPassword: encrypt(courierPassword) },
      update: { courierProvider: 'sameday', courierUsername: encrypt(courierUsername), courierPassword: encrypt(courierPassword) },
    });
    return json({ success: 'Conectat la SameDay cu succes! Sincronizarea automata va incepe in cateva minute.' });
  }

  if (intent === 'disconnectCourier') {
    await db.storeSettings.update({
      where: { storeConnectionId: storeId },
      data: { courierProvider: null, courierUsername: null, courierPassword: null, courierLastSyncAt: null },
    });
    return json({ success: 'Curier deconectat.' });
  }

  if (intent === 'saveCosts') {
    const shippingCostPerOrder = form.get('shippingCostPerOrder') ? parseFloat(String(form.get('shippingCostPerOrder'))) : null;
    const returnCost = form.get('returnCost') ? parseFloat(String(form.get('returnCost'))) : null;
    const cardFeePercent = form.get('cardFeePercent') ? parseFloat(String(form.get('cardFeePercent'))) : null;
    const cardFeeFixed = form.get('cardFeeFixed') ? parseFloat(String(form.get('cardFeeFixed'))) : null;
    const crossBorderFeePercent = form.get('crossBorderFeePercent') ? parseFloat(String(form.get('crossBorderFeePercent'))) : null;
    const shippingCostIntl = form.get('shippingCostIntl') ? parseFloat(String(form.get('shippingCostIntl'))) : null;
    const shippingChargeToCustomer = form.get('shippingChargeToCustomer') ? parseFloat(String(form.get('shippingChargeToCustomer'))) : null;
    const shippingChargeToCustomerIntl = form.get('shippingChargeToCustomerIntl') ? parseFloat(String(form.get('shippingChargeToCustomerIntl'))) : null;
    // HU per-weight tariff: comma-separated "kgCeiling=cost" pairs (e.g. "1=30,2=32,5=38,10=50")
    const huTariffRaw = String(form.get('shippingCostHuTariff') || '').trim();
    let shippingCostHuTariff: string | null = null;
    if (huTariffRaw) {
      const obj: Record<string, number> = {};
      for (const pair of huTariffRaw.split(',')) {
        const [k, v] = pair.split('=').map(s => s.trim());
        const kn = parseFloat(k); const vn = parseFloat(v);
        if (!isNaN(kn) && !isNaN(vn)) obj[String(kn)] = vn;
      }
      if (Object.keys(obj).length) shippingCostHuTariff = JSON.stringify(obj);
    }

    await db.storeSettings.upsert({
      where: { storeConnectionId: storeId },
      create: { storeConnectionId: storeId, shippingCostPerOrder, returnCost, cardFeePercent, cardFeeFixed, crossBorderFeePercent, shippingCostIntl, shippingChargeToCustomer, shippingChargeToCustomerIntl, shippingCostHuTariff } as any,
      update: { shippingCostPerOrder, returnCost, cardFeePercent, cardFeeFixed, crossBorderFeePercent, shippingCostIntl, shippingChargeToCustomer, shippingChargeToCustomerIntl, shippingCostHuTariff } as any,
    });
    return json({ success: 'Costuri salvate.' });
  }

  if (intent === 'importInvoice') {
    const invoiceNumber = String(form.get('invoiceNumber') || '').trim();
    if (!invoiceNumber) return json({ error: 'Numarul facturii este obligatoriu.' }, { status: 400 });
    try {
      const { importInvoice } = await import('~/lib/sameday/invoice-ledger.server');
      const result = await importInvoice(storeId, invoiceNumber);
      return json({
        success: `Factura ${invoiceNumber} importata: ${result.parsedCount} AWB-uri, ${result.appliedCount} aplicate la tracking, total ${result.totalAmount.toFixed(2)} RON.`,
      });
    } catch (err: any) {
      return json({ error: `Import esuat: ${err.message || err}` }, { status: 400 });
    }
  }

  if (intent === 'deleteInvoice') {
    const invoiceId = String(form.get('invoiceId') || '');
    if (!invoiceId) return json({ error: 'ID factura lipsa.' }, { status: 400 });
    const inv = await db.samedayInvoice.findFirst({ where: { id: invoiceId, storeConnectionId: storeId } });
    if (!inv) return json({ error: 'Factura nu exista.' }, { status: 404 });
    await db.samedayInvoice.delete({ where: { id: invoiceId } });
    return json({ success: `Factura ${inv.invoiceNumber} stearsa din BI (datele din CourierTracking ramin).` });
  }

  return json({ error: 'Unknown intent' }, { status: 400 });
}

export async function loader({ request }: LoaderFunctionArgs) {
  const ctx = await requireUserContext(request);
  const url = new URL(request.url);
  const storeId = url.searchParams.get('store');
  const country = url.searchParams.get('country'); // 'RO', 'HU', or null (all)
  const rangeParam = url.searchParams.get('range') || '30d'; // '1d' | '7d' | '30d' | 'all' | 'custom'
  const fromParam = url.searchParams.get('from'); // YYYY-MM-DD (only when range=custom)
  const toParam = url.searchParams.get('to');     // YYYY-MM-DD (only when range=custom)

  const stores = await db.storeConnection.findMany({
    where: { userId: ctx.effectiveOwnerId },
    select: { id: true, name: true },
  });

  const selectedStoreId = storeId || stores[0]?.id;
  if (!selectedStoreId) return json({ stores, data: null, selectedStoreId: null, country: null, availableCountries: [], range: rangeParam, from: fromParam, to: toParam });

  // Get store settings for cost calculations
  const storeSettings = await db.storeSettings.findUnique({ where: { storeConnectionId: selectedStoreId } });

  // Currency filter based on country
  const cf: any = country === 'RO' ? { currency: 'RON' } : country === 'HU' ? { currency: 'HUF' } : {};

  // Date range filter (on courierUpdatedAt)
  function buildDateFilter(): any {
    const now = new Date();
    if (rangeParam === 'all') return {};
    if (rangeParam === 'custom' && (fromParam || toParam)) {
      const gte = fromParam ? new Date(fromParam + 'T00:00:00') : undefined;
      const lte = toParam ? new Date(toParam + 'T23:59:59.999') : undefined;
      const filter: any = {};
      if (gte) filter.gte = gte;
      if (lte) filter.lte = lte;
      return Object.keys(filter).length ? { courierUpdatedAt: filter } : {};
    }
    const daysMap: Record<string, number> = { '1d': 1, '7d': 7, '30d': 30 };
    const days = daysMap[rangeParam] ?? 30;
    const gte = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
    return { courierUpdatedAt: { gte } };
  }
  const df = buildDateFilter();
  // Combined filter (country + date)
  const f = { ...cf, ...df } as any;

  // Available countries (distinct currencies for this store)
  const countryCounts = await db.courierTracking.groupBy({
    by: ['currency'],
    where: { storeConnectionId: selectedStoreId },
    _count: true,
  });
  const availableCountries = countryCounts
    .map(c => ({
      ...(COUNTRY_MAP[c.currency] || { code: c.currency, name: c.currency, flag: '' }),
      count: c._count,
      currency: c.currency,
    }))
    .sort((a, b) => b.count - a.count);

  const [totalAwb, delivered, returned, pickedUp, inTransit, codMarked, cardDelivered] = await Promise.all([
    db.courierTracking.count({ where: { storeConnectionId: selectedStoreId, ...f } }),
    db.courierTracking.count({ where: { storeConnectionId: selectedStoreId, isDelivered: true, ...f } }),
    db.courierTracking.count({ where: { storeConnectionId: selectedStoreId, isReturned: true, ...f } }),
    db.courierTracking.count({ where: { storeConnectionId: selectedStoreId, isPickedUp: true, isDelivered: false, isReturned: false, ...f } }),
    db.courierTracking.count({ where: { storeConnectionId: selectedStoreId, isPickedUp: false, isDelivered: false, isReturned: false, ...f } }),
    db.courierTracking.count({ where: { storeConnectionId: selectedStoreId, shopifyPaymentMarked: true, ...f } }),
    db.courierTracking.count({ where: { storeConnectionId: selectedStoreId, isDelivered: true, isCod: false, ...f } }),
  ]);

  // COD totals — only query relevant currencies based on country filter
  const emptyAgg = { _sum: { codAmount: null }, _count: 0 };
  const [codStatsRON, codStatsHUF, returnedCodRON, returnedCodHUF] = await Promise.all([
    country !== 'HU'
      ? db.courierTracking.aggregate({ where: { storeConnectionId: selectedStoreId, isCod: true, isDelivered: true, currency: 'RON', ...df }, _sum: { codAmount: true }, _count: true })
      : emptyAgg,
    country !== 'RO'
      ? db.courierTracking.aggregate({ where: { storeConnectionId: selectedStoreId, isCod: true, isDelivered: true, currency: 'HUF', ...df }, _sum: { codAmount: true }, _count: true })
      : emptyAgg,
    country !== 'HU'
      ? db.courierTracking.aggregate({ where: { storeConnectionId: selectedStoreId, isCod: true, isReturned: true, currency: 'RON', ...df }, _sum: { codAmount: true }, _count: true })
      : emptyAgg,
    country !== 'RO'
      ? db.courierTracking.aggregate({ where: { storeConnectionId: selectedStoreId, isCod: true, isReturned: true, currency: 'HUF', ...df }, _sum: { codAmount: true }, _count: true })
      : emptyAgg,
  ]);

  // Recent tracking events
  const recentDelivered = await db.courierTracking.findMany({
    where: { storeConnectionId: selectedStoreId, isDelivered: true, ...f },
    orderBy: { courierUpdatedAt: 'desc' },
    select: {
      awb: true, orderNumber: true, statusName: true, codAmount: true,
      isCod: true, shopifyPaymentMarked: true, county: true, courierUpdatedAt: true, currency: true,
      servicePayment: true,
    },
  });

  const recentReturned = await db.courierTracking.findMany({
    where: { storeConnectionId: selectedStoreId, isReturned: true, ...f },
    orderBy: { courierUpdatedAt: 'desc' },
    select: {
      awb: true, orderNumber: true, statusName: true, codAmount: true,
      isCod: true, county: true, courierUpdatedAt: true, currency: true,
      servicePayment: true,
    },
  });

  const inTransitList = await db.courierTracking.findMany({
    where: { storeConnectionId: selectedStoreId, isDelivered: false, isReturned: false, ...f },
    orderBy: { courierUpdatedAt: 'desc' },
    select: {
      awb: true, orderNumber: true, statusName: true, codAmount: true,
      isCod: true, isPickedUp: true, county: true, courierUpdatedAt: true, currency: true,
      servicePayment: true,
    },
  });

  const deliveryRate = totalAwb > 0 ? Math.round((delivered / (delivered + returned)) * 1000) / 10 : 0;
  const returnRate = totalAwb > 0 ? Math.round((returned / (delivered + returned)) * 1000) / 10 : 0;

  // Real shipping costs from SameDay estimate-cost (servicePayment field)
  const [realCostDelivered, realCostReturned, realCostCoverage] = await Promise.all([
    db.courierTracking.aggregate({
      where: { storeConnectionId: selectedStoreId, isDelivered: true, servicePayment: { not: null }, ...f },
      _sum: { servicePayment: true },
      _count: true,
    }),
    db.courierTracking.aggregate({
      where: { storeConnectionId: selectedStoreId, isReturned: true, servicePayment: { not: null }, ...f },
      _sum: { servicePayment: true },
      _count: true,
    }),
    db.courierTracking.count({
      where: { storeConnectionId: selectedStoreId, servicePayment: { not: null }, ...f },
    }),
  ]);

  const hasRealCosts = realCostCoverage > 0;
  const realShippingDelivered = realCostDelivered._sum.servicePayment || 0;
  const realShippingReturned = realCostReturned._sum.servicePayment || 0;
  const realShippingTotal = realShippingDelivered + realShippingReturned;
  const avgCostPerShipment = realCostCoverage > 0 ? realShippingTotal / realCostCoverage : 0;

  // Fallback to settings-based estimates for uncovered AWBs
  const returnCostPerUnit = storeSettings?.returnCost || 0;
  const settingsShippingCost = country === 'HU' && storeSettings?.shippingCostIntl
    ? storeSettings.shippingCostIntl
    : storeSettings?.shippingCostPerOrder || 0;

  // Card fee calculations
  const cardPct = country === 'HU' && storeSettings?.crossBorderFeePercent
    ? storeSettings.crossBorderFeePercent
    : storeSettings?.cardFeePercent || 0;
  const cardFixed = storeSettings?.cardFeeFixed || 0;
  const cardOrders = await db.courierTracking.findMany({
    where: { storeConnectionId: selectedStoreId, isDelivered: true, isCod: false, ...f },
    select: { orderId: true },
  });
  let cardRevenue = 0;
  for (const co of cardOrders) {
    if (co.orderId) {
      const o = await db.order.findUnique({ where: { id: co.orderId }, select: { total: true } });
      if (o) cardRevenue += Number(o.total);
    }
  }
  const totalCardFeesCalc = cardPct > 0 ? Math.round((cardRevenue * cardPct / 100 + cardDelivered * cardFixed) * 100) / 100 : 0;

  // Determine primary currency for display
  const primaryCurrency = country === 'HU' ? 'HUF' : 'RON';

  // Shipping charge to customer (for overspend detection)
  // For HU country filter use shippingChargeToCustomerIntl, otherwise default RO charge.
  const shippingCharge = country === 'HU' && storeSettings?.shippingChargeToCustomerIntl
    ? storeSettings.shippingChargeToCustomerIntl
    : storeSettings?.shippingChargeToCustomer || 0;

  // Orders where real SameDay cost exceeds what customer paid
  let overCostList: any[] = [];
  let overCostTotal = 0;
  let overCostLoss = 0;
  if (shippingCharge > 0) {
    const overCostAwbs = await db.courierTracking.findMany({
      where: {
        storeConnectionId: selectedStoreId,
        isDelivered: true,
        servicePayment: { gt: shippingCharge },
        ...f,
      },
      select: {
        awb: true, orderNumber: true, servicePayment: true, codAmount: true,
        isCod: true, county: true, courierUpdatedAt: true, currency: true,
        orderId: true,
      },
      orderBy: { servicePayment: 'desc' },
    });

    // Fetch order totals for profit calculation
    overCostList = [];
    for (const ct of overCostAwbs) {
      let orderTotal = 0;
      if (ct.orderId) {
        const o = await db.order.findUnique({ where: { id: ct.orderId }, select: { total: true } });
        if (o) orderTotal = Number(o.total);
      }
      const loss = Math.round(((ct.servicePayment || 0) - shippingCharge) * 100) / 100;
      overCostList.push({
        awb: ct.awb,
        orderNumber: ct.orderNumber,
        servicePayment: ct.servicePayment,
        codAmount: ct.codAmount,
        isCod: ct.isCod,
        county: ct.county,
        courierUpdatedAt: ct.courierUpdatedAt,
        currency: ct.currency,
        orderTotal,
        loss,
        profit: Math.round((orderTotal - (ct.servicePayment || 0)) * 100) / 100,
      });
    }
    overCostTotal = overCostList.length;
    overCostLoss = Math.round(overCostList.reduce((s: number, r: any) => s + r.loss, 0) * 100) / 100;
  }

  // SameDay invoices list (latest 20)
  const samedayInvoices = await db.samedayInvoice.findMany({
    where: { storeConnectionId: selectedStoreId },
    orderBy: [{ invoiceDate: 'desc' }, { createdAt: 'desc' }],
    take: 20,
    select: {
      id: true,
      invoiceNumber: true,
      invoiceDate: true,
      awbCount: true,
      totalAmount: true,
      status: true,
      errorMessage: true,
      appliedAt: true,
      createdAt: true,
    },
  });

  return json({
    stores,
    selectedStoreId,
    country,
    availableCountries,
    range: rangeParam,
    from: fromParam,
    to: toParam,
    samedayInvoices,
    data: {
      totalAwb, delivered, returned, pickedUp, inTransit, codMarked, cardDelivered,
      deliveryRate, returnRate,
      primaryCurrency,
      codCollectedRON: codStatsRON._sum.codAmount || 0,
      codCollectedRONCount: codStatsRON._count || 0,
      codCollectedHUF: codStatsHUF._sum.codAmount || 0,
      codCollectedHUFCount: codStatsHUF._count || 0,
      codLostRON: returnedCodRON._sum.codAmount || 0,
      codLostRONCount: returnedCodRON._count || 0,
      codLostHUF: returnedCodHUF._sum.codAmount || 0,
      codLostHUFCount: returnedCodHUF._count || 0,
      // Real shipping costs from SameDay
      hasRealCosts,
      realShippingDelivered: Math.round(realShippingDelivered * 100) / 100,
      realShippingReturned: Math.round(realShippingReturned * 100) / 100,
      realShippingTotal: Math.round(realShippingTotal * 100) / 100,
      avgCostPerShipment: Math.round(avgCostPerShipment * 100) / 100,
      realCostCoverage,
      totalAwbWithCost: realCostCoverage,
      // Fallback estimated costs (for HU or uncovered AWBs)
      settingsShippingCost,
      estimatedShippingTotal: !hasRealCosts ? Math.round(delivered * settingsShippingCost * 100) / 100 : 0,
      estimatedReturnTotal: !hasRealCosts ? Math.round(returned * (settingsShippingCost + returnCostPerUnit) * 100) / 100 : 0,
      // Card fees & settings
      totalCardFees: totalCardFeesCalc,
      cardPct,
      cardFixed,
      hasSettings: hasRealCosts || settingsShippingCost > 0 || cardPct > 0 || returnCostPerUnit > 0,
      courierConnected: !!(storeSettings?.courierProvider),
      settings: storeSettings ? { shippingCostPerOrder: storeSettings.shippingCostPerOrder, returnCost: storeSettings.returnCost, cardFeePercent: storeSettings.cardFeePercent, cardFeeFixed: storeSettings.cardFeeFixed, crossBorderFeePercent: storeSettings.crossBorderFeePercent, shippingCostIntl: storeSettings.shippingCostIntl, shippingChargeToCustomer: storeSettings.shippingChargeToCustomer, shippingChargeToCustomerIntl: (storeSettings as any).shippingChargeToCustomerIntl ?? null, shippingCostHuTariff: (storeSettings as any).shippingCostHuTariff ?? null } : null,
      shippingCharge,
      overCostList,
      overCostTotal,
      overCostLoss,
      recentDelivered,
      recentReturned,
      inTransitList,
    },
  });
}

function fmtDate(d: string | null) {
  if (!d) return '-';
  return new Date(d).toLocaleDateString('ro-RO', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

function fmtMoney(n: number, currency = 'RON') {
  return n.toLocaleString('ro-RO', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' ' + currency;
}

export default function CourierPage() {
  const { stores, data, selectedStoreId, country, availableCountries, range, from, to, samedayInvoices } = useLoaderData<typeof loader>();
  const [searchParams, setSearchParams] = useSearchParams();
  const actionData = useActionData<typeof action>();
  const [tab, setTab] = useState<'delivered' | 'returned' | 'transit' | 'overcost' | 'invoices'>('delivered');
  const [page, setPage] = useState(0);
  const perPage = 25;

  const updateParam = (key: string, value: string | null) => {
    const params = new URLSearchParams(searchParams);
    if (value) params.set(key, value);
    else params.delete(key);
    setSearchParams(params);
  };

  const updateParams = (updates: Record<string, string | null>) => {
    const params = new URLSearchParams(searchParams);
    for (const [k, v] of Object.entries(updates)) {
      if (v) params.set(k, v);
      else params.delete(k);
    }
    setSearchParams(params);
  };

  const setRange = (r: string) => {
    if (r === 'custom') updateParams({ range: 'custom' });
    else updateParams({ range: r, from: null, to: null });
    setPage(0);
  };
  const currentRange = range || '30d';

  if (!data) {
    return (
      <div>
        <div className="page-header"><h1 className="page-title">Courier Tracking</h1></div>
        <div className="card" style={{ textAlign: 'center', padding: '56px 24px' }}>
          <p style={{ color: 'var(--color-text-muted)' }}>Conecteaza un magazin.</p>
        </div>
      </div>
    );
  }

  const showCountryFilter = availableCountries.length > 1;
  const pc = data.primaryCurrency; // primary currency for display

  return (
    <div>
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 'var(--space-sm)' }}>
        <div>
          <h1 className="page-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Truck size={22} /> Courier Tracking
          </h1>
          <p className="page-subtitle">{data.totalAwb} colete monitorizate via SameDay</p>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {stores.length > 1 && (
            <select className="form-input" style={{ width: 220 }} value={selectedStoreId || ''} onChange={(e) => updateParam('store', e.target.value)}>
              {stores.map((s: any) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          )}
        </div>
      </div>

      {/* Country filter */}
      {showCountryFilter && (
        <div style={{ display: 'flex', gap: 6, marginBottom: 'var(--space-md)', flexWrap: 'wrap' }}>
          <button
            onClick={() => { updateParam('country', null); setPage(0); }}
            style={{
              padding: '6px 14px', fontSize: '0.8125rem', fontWeight: !country ? 600 : 400,
              borderRadius: 20, border: '1px solid',
              borderColor: !country ? 'var(--kimono-orange)' : 'var(--border-default)',
              background: !country ? 'rgba(249,115,22,0.08)' : 'var(--bg-secondary)',
              color: !country ? 'var(--kimono-orange)' : 'var(--text-secondary)',
              cursor: 'pointer', transition: 'all 0.15s',
              display: 'flex', alignItems: 'center', gap: 6,
            }}
          >
            <Globe size={13} />
            Toate tarile
            <span style={{ fontSize: '0.7rem', opacity: 0.7 }}>
              ({availableCountries.reduce((s: number, c: any) => s + c.count, 0)})
            </span>
          </button>
          {availableCountries.map((c: any) => (
            <button
              key={c.code}
              onClick={() => { updateParam('country', c.code); setPage(0); }}
              style={{
                padding: '6px 14px', fontSize: '0.8125rem', fontWeight: country === c.code ? 600 : 400,
                borderRadius: 20, border: '1px solid',
                borderColor: country === c.code ? 'var(--kimono-orange)' : 'var(--border-default)',
                background: country === c.code ? 'rgba(249,115,22,0.08)' : 'var(--bg-secondary)',
                color: country === c.code ? 'var(--kimono-orange)' : 'var(--text-secondary)',
                cursor: 'pointer', transition: 'all 0.15s',
                display: 'flex', alignItems: 'center', gap: 6,
              }}
            >
              <Flag code={c.code} size={14} />
              {c.name}
              <span style={{ fontSize: '0.7rem', opacity: 0.7 }}>({c.count})</span>
            </button>
          ))}
        </div>
      )}

      {/* Date range filter */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 'var(--space-md)', flexWrap: 'wrap', alignItems: 'center' }}>
        {[
          { key: '1d', label: 'Ultima zi' },
          { key: '7d', label: 'Ultimele 7 zile' },
          { key: '30d', label: 'Ultimele 30 zile' },
          { key: 'all', label: 'Toate' },
          { key: 'custom', label: 'Custom' },
        ].map((opt) => {
          const active = currentRange === opt.key;
          return (
            <button
              key={opt.key}
              onClick={() => setRange(opt.key)}
              style={{
                padding: '6px 14px', fontSize: '0.8125rem', fontWeight: active ? 600 : 400,
                borderRadius: 20, border: '1px solid',
                borderColor: active ? 'var(--kimono-orange)' : 'var(--border-default)',
                background: active ? 'rgba(249,115,22,0.08)' : 'var(--bg-secondary)',
                color: active ? 'var(--kimono-orange)' : 'var(--text-secondary)',
                cursor: 'pointer', transition: 'all 0.15s',
              }}
            >
              {opt.label}
            </button>
          );
        })}
        {currentRange === 'custom' && (
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginLeft: 8 }}>
            <input
              type="date"
              className="form-input"
              defaultValue={from || ''}
              onChange={(e) => updateParams({ range: 'custom', from: e.target.value || null })}
              style={{ width: 150, fontSize: '0.8125rem' }}
            />
            <span style={{ fontSize: '0.8125rem', color: 'var(--text-muted)' }}>→</span>
            <input
              type="date"
              className="form-input"
              defaultValue={to || ''}
              onChange={(e) => updateParams({ range: 'custom', to: e.target.value || null })}
              style={{ width: 150, fontSize: '0.8125rem' }}
            />
          </div>
        )}
      </div>

      {data.totalAwb === 0 && !data.courierConnected && (
        <div className="card" style={{ padding: '28px', marginBottom: 'var(--space-xl)', border: '1px dashed var(--border-default)' }}>
          <h3 style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--text-primary)', marginBottom: 12 }}>Configureaza Courier Tracking</h3>
          <p style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)', lineHeight: 1.6, marginBottom: 16 }}>
            Pentru a folosi Courier Tracking ai nevoie de:
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
              <span style={{ width: 24, height: 24, borderRadius: '50%', background: 'var(--kimono-orange)', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700, flexShrink: 0 }}>1</span>
              <div>
                <div style={{ fontSize: '0.8125rem', fontWeight: 600, color: 'var(--text-primary)' }}>Cont SameDay cu acces API</div>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Username si parola API de la SameDay. Contacteaza SameDay pentru activare.</div>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
              <span style={{ width: 24, height: 24, borderRadius: '50%', background: 'var(--kimono-orange)', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700, flexShrink: 0 }}>2</span>
              <div>
                <div style={{ fontSize: '0.8125rem', fontWeight: 600, color: 'var(--text-primary)' }}>AWB-uri pe comenzi in Shopify</div>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Comenzile trebuie sa aiba tracking number-ul (AWB) setat pe fulfillment. Aplicatii ca XConnector fac asta automat.</div>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
              <span style={{ width: 24, height: 24, borderRadius: '50%', background: 'var(--kimono-orange)', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700, flexShrink: 0 }}>3</span>
              <div>
                <div style={{ fontSize: '0.8125rem', fontWeight: 600, color: 'var(--text-primary)' }}>Sincronizare automata</div>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Odata configurat, statusurile se sincronizeaza automat la fiecare 30 de minute. Comenzile COD livrate sunt marcate automat ca platite in Shopify. Comenzile refuzate sunt anulate cu restocarea produselor.</div>
              </div>
            </div>
          </div>
          <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: 16 }}>
            </p>

          <Form method="post" style={{ marginTop: 20 }}>
            <input type="hidden" name="intent" value="connectCourier" />
            <input type="hidden" name="storeId" value={selectedStoreId || ''} />
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
              <div>
                <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)', display: 'block', marginBottom: 4 }}>SameDay API Username</label>
                <input name="courierUsername" type="text" className="form-input" placeholder="usernameAPI" style={{ width: '100%' }} required />
              </div>
              <div>
                <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)', display: 'block', marginBottom: 4 }}>SameDay API Password</label>
                <input name="courierPassword" type="password" className="form-input" placeholder="parola API" style={{ width: '100%' }} required />
              </div>
            </div>
            <button type="submit" className="btn btn-primary">Conecteaza SameDay</button>
          </Form>
        </div>
      )}

      {/* KPI Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 'var(--space-md)', marginBottom: 'var(--space-xl)' }}>
        <div className="card">
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.8125rem', color: 'var(--color-text-muted)', marginBottom: 'var(--space-xs)' }}>
            <CheckCircle size={14} style={{ color: '#22c55e' }} /> Livrate
          </div>
          <div style={{ fontSize: '1.75rem', fontWeight: 700, color: '#22c55e' }}>{data.delivered}</div>
          <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', marginTop: 4 }}>Rata: {data.deliveryRate}%</div>
        </div>
        <div className="card">
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.8125rem', color: 'var(--color-text-muted)', marginBottom: 'var(--space-xs)' }}>
            <XCircle size={14} style={{ color: '#ef4444' }} /> Returnate
          </div>
          <div style={{ fontSize: '1.75rem', fontWeight: 700, color: '#ef4444' }}>{data.returned}</div>
          <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', marginTop: 4 }}>Rata retur: {data.returnRate}%</div>
        </div>
        <div className="card">
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.8125rem', color: 'var(--color-text-muted)', marginBottom: 'var(--space-xs)' }}>
            <Clock size={14} style={{ color: '#f59e0b' }} /> In tranzit
          </div>
          <div style={{ fontSize: '1.75rem', fontWeight: 700, color: '#f59e0b' }}>{data.pickedUp + data.inTransit}</div>
          <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', marginTop: 4 }}>{data.pickedUp} ridicate, {data.inTransit} in curs</div>
        </div>
        <div className="card">
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.8125rem', color: 'var(--color-text-muted)', marginBottom: 'var(--space-xs)' }}>
            <Package size={14} style={{ color: '#3b82f6' }} /> COD incasat
          </div>
          {/* Single country: show only that currency as primary */}
          {country === 'HU' ? (
            <>
              <div style={{ fontSize: '1.5rem', fontWeight: 700, color: '#3b82f6' }}>
                {Math.round(data.codCollectedHUF).toLocaleString('ro-RO')} HUF
              </div>
              <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', marginTop: 4 }}>{data.codCollectedHUFCount} comenzi</div>
            </>
          ) : (
            <>
              <div style={{ fontSize: '1.5rem', fontWeight: 700, color: '#3b82f6' }}>{fmtMoney(data.codCollectedRON)}</div>
              <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', marginTop: 4 }}>{data.codCollectedRONCount} comenzi RON</div>
              {!country && data.codCollectedHUF > 0 && (
                <div style={{ fontSize: '0.8125rem', fontWeight: 600, color: '#3b82f6', marginTop: 4 }}>
                  + {Math.round(data.codCollectedHUF).toLocaleString('ro-RO')} HUF
                  <span style={{ fontSize: '0.7rem', fontWeight: 400, color: 'var(--color-text-muted)', marginLeft: 4 }}>({data.codCollectedHUFCount} comenzi)</span>
                </div>
              )}
            </>
          )}
        </div>
        <div className="card">
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.8125rem', color: 'var(--color-text-muted)', marginBottom: 'var(--space-xs)' }}>
            <XCircle size={14} style={{ color: '#dc2626' }} /> COD pierdut (retururi)
          </div>
          {country === 'HU' ? (
            <>
              <div style={{ fontSize: '1.5rem', fontWeight: 700, color: '#dc2626' }}>
                {Math.round(data.codLostHUF).toLocaleString('ro-RO')} HUF
              </div>
              <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', marginTop: 4 }}>{data.codLostHUFCount} comenzi</div>
            </>
          ) : (
            <>
              <div style={{ fontSize: '1.5rem', fontWeight: 700, color: '#dc2626' }}>{fmtMoney(data.codLostRON)}</div>
              <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', marginTop: 4 }}>{data.codLostRONCount} comenzi RON</div>
              {!country && data.codLostHUF > 0 && (
                <div style={{ fontSize: '0.8125rem', fontWeight: 600, color: '#dc2626', marginTop: 4 }}>
                  + {Math.round(data.codLostHUF).toLocaleString('ro-RO')} HUF
                  <span style={{ fontSize: '0.7rem', fontWeight: 400, color: 'var(--color-text-muted)', marginLeft: 4 }}>({data.codLostHUFCount} comenzi)</span>
                </div>
              )}
            </>
          )}
        </div>
        <div className="card">
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.8125rem', color: 'var(--color-text-muted)', marginBottom: 'var(--space-xs)' }}>
            <ArrowUpDown size={14} style={{ color: '#8b5cf6' }} /> Platite cu cardul
          </div>
          <div style={{ fontSize: '1.75rem', fontWeight: 700, color: '#8b5cf6' }}>{data.cardDelivered}</div>
          <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', marginTop: 4 }}>Din {data.delivered} livrate</div>
        </div>
      </div>

      {/* Shipping costs — real from SameDay */}
      {data.hasRealCosts && (
        <div className="card" style={{ marginBottom: 'var(--space-xl)', padding: '20px', background: 'rgba(220,38,38,0.02)', border: '0.5px solid rgba(220,38,38,0.15)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <div style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--text-primary)' }}>
              Costuri transport SameDay
              <span style={{ fontSize: '0.7rem', fontWeight: 400, color: 'var(--text-muted)', marginLeft: 8 }}>
                (cost real per AWB — {data.totalAwbWithCost} din {data.totalAwb} colete)
              </span>
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 'var(--space-md)' }}>
            <div>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: 2 }}>Transport livrate ({(data as any).realCostCoverage > 0 ? `${data.delivered} comenzi` : ''})</div>
              <div style={{ fontSize: '1.25rem', fontWeight: 700, color: '#b45309' }}>-{fmtMoney(data.realShippingDelivered)}</div>
            </div>
            {data.realShippingReturned > 0 && (
              <div>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: 2 }}>Transport retururi ({data.returned} retururi)</div>
                <div style={{ fontSize: '1.25rem', fontWeight: 700, color: '#dc2626' }}>-{fmtMoney(data.realShippingReturned)}</div>
              </div>
            )}
            <div>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: 2 }}>Cost mediu per expediție</div>
              <div style={{ fontSize: '1.25rem', fontWeight: 700, color: '#6366f1' }}>{fmtMoney(data.avgCostPerShipment)}</div>
            </div>
            {data.totalCardFees > 0 && (
              <div>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: 2 }}>Fee-uri card ({data.cardPct}% + {data.cardFixed} RON/trx)</div>
                <div style={{ fontSize: '1.25rem', fontWeight: 700, color: '#7c3aed' }}>-{fmtMoney(data.totalCardFees)}</div>
              </div>
            )}
            <div>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: 2 }}>Total costuri transport</div>
              <div style={{ fontSize: '1.25rem', fontWeight: 700, color: '#dc2626' }}>-{fmtMoney(data.realShippingTotal + data.totalCardFees)}</div>
            </div>
          </div>
        </div>
      )}

      {/* Estimated costs fallback (HU or no real cost data) */}
      {!data.hasRealCosts && data.settingsShippingCost > 0 && (
        <div className="card" style={{ marginBottom: 'var(--space-xl)', padding: '20px', background: 'rgba(245,158,11,0.03)', border: '0.5px solid rgba(245,158,11,0.2)' }}>
          <div style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--text-primary)', marginBottom: 12 }}>
            Costuri transport estimate
            <span style={{ fontSize: '0.7rem', fontWeight: 400, color: 'var(--text-muted)', marginLeft: 8 }}>
              (din Settings — {data.settingsShippingCost} RON/expediție)
            </span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 'var(--space-md)' }}>
            <div>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: 2 }}>Transport livrate ({data.delivered} x {data.settingsShippingCost} RON)</div>
              <div style={{ fontSize: '1.25rem', fontWeight: 700, color: '#b45309' }}>-{fmtMoney(data.estimatedShippingTotal)}</div>
            </div>
            {data.estimatedReturnTotal > 0 && (
              <div>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: 2 }}>Transport retururi ({data.returned} retururi)</div>
                <div style={{ fontSize: '1.25rem', fontWeight: 700, color: '#dc2626' }}>-{fmtMoney(data.estimatedReturnTotal)}</div>
              </div>
            )}
            <div>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: 2 }}>Total estimat</div>
              <div style={{ fontSize: '1.25rem', fontWeight: 700, color: '#dc2626' }}>-{fmtMoney(data.estimatedShippingTotal + data.estimatedReturnTotal + data.totalCardFees)}</div>
            </div>
          </div>
        </div>
      )}

      {/* Action feedback */}
      {actionData?.error && <div className="alert alert-error" style={{ marginBottom: 16 }}>{(actionData as any).error}</div>}
      {actionData?.success && <div className="alert alert-success" style={{ marginBottom: 16 }}>{(actionData as any).success}</div>}

      {/* Costs settings (inline) */}
      {selectedStoreId && (
        <details className="card" style={{ marginBottom: 'var(--space-md)', padding: '20px' }} open={!data.hasSettings}>
          <summary style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', cursor: 'pointer', userSelect: 'none', marginBottom: 4, display: 'flex', alignItems: 'center', gap: 8 }}>
            <span>{data.hasSettings ? 'Editează costurile operationale' : 'Seteaza costurile operationale'}</span>
            {data.hasSettings && <span style={{ fontSize: 11, fontWeight: 400, color: 'var(--text-muted)' }}>(click pentru a edita)</span>}
          </summary>
          <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 8, marginBottom: 16 }}>Aceste valori sunt folosite pentru calculul profitabilitatii reale (fallback când nu există cost real din factură).</div>
          <Form method="post">
            <input type="hidden" name="intent" value="saveCosts" />
            <input type="hidden" name="storeId" value={selectedStoreId || ''} />
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, marginBottom: 12 }}>
              <div>
                <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-primary)', display: 'block', marginBottom: 4 }}>Cost transport/comanda (RON)</label>
                <input name="shippingCostPerOrder" type="number" step="0.01" className="form-input" defaultValue={data.settings?.shippingCostPerOrder || ''} placeholder="ex: 20" style={{ width: '100%' }} />
              </div>
              <div>
                <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-primary)', display: 'block', marginBottom: 4 }}>Cost extra retur (RON)</label>
                <input name="returnCost" type="number" step="0.01" className="form-input" defaultValue={data.settings?.returnCost || ''} placeholder="0 daca nu se taxeaza" style={{ width: '100%' }} />
              </div>
              <div>
                <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-primary)', display: 'block', marginBottom: 4 }}>Fee card (%)</label>
                <input name="cardFeePercent" type="number" step="0.01" className="form-input" defaultValue={data.settings?.cardFeePercent || ''} placeholder="ex: 1.7" style={{ width: '100%' }} />
              </div>
              <div>
                <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-primary)', display: 'block', marginBottom: 4 }}>Fee fix card (RON)</label>
                <input name="cardFeeFixed" type="number" step="0.01" className="form-input" defaultValue={data.settings?.cardFeeFixed || ''} placeholder="ex: 1.25" style={{ width: '100%' }} />
              </div>
              <div>
                <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-primary)', display: 'block', marginBottom: 4 }}>Fee cross-border (%)</label>
                <input name="crossBorderFeePercent" type="number" step="0.01" className="form-input" defaultValue={data.settings?.crossBorderFeePercent || ''} placeholder="ex: 2" style={{ width: '100%' }} />
              </div>
              <div>
                <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-primary)', display: 'block', marginBottom: 4 }}>Transport international (RON)</label>
                <input name="shippingCostIntl" type="number" step="0.01" className="form-input" defaultValue={data.settings?.shippingCostIntl || ''} placeholder="ex: 35" style={{ width: '100%' }} />
              </div>
              <div>
                <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--kimono-orange)', display: 'block', marginBottom: 4 }}>Pret transport RO catre client (RON)</label>
                <input name="shippingChargeToCustomer" type="number" step="0.01" className="form-input" defaultValue={data.settings?.shippingChargeToCustomer || ''} placeholder="ex: 19.90" style={{ width: '100%' }} />
              </div>
              <div>
                <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--kimono-orange)', display: 'block', marginBottom: 4 }}>Pret transport HU catre client (RON)</label>
                <input name="shippingChargeToCustomerIntl" type="number" step="0.01" className="form-input" defaultValue={(data.settings as any)?.shippingChargeToCustomerIntl || ''} placeholder="ex: 29.90" style={{ width: '100%' }} />
              </div>
              <div style={{ gridColumn: '1 / -1' }}>
                <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-primary)', display: 'block', marginBottom: 4 }}>
                  Tarifar HU pe greutate (kgPlafon=RON, separat prin virgula)
                </label>
                <input
                  name="shippingCostHuTariff"
                  type="text"
                  className="form-input"
                  defaultValue={(() => {
                    const raw = (data.settings as any)?.shippingCostHuTariff;
                    if (!raw) return '';
                    try {
                      const o = JSON.parse(raw);
                      return Object.entries(o).map(([k, v]) => `${k}=${v}`).join(',');
                    } catch { return ''; }
                  })()}
                  placeholder="ex: 1=30,2=32,5=38,10=50 (gol = foloseste Transport international fix)"
                  style={{ width: '100%' }}
                />
                <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 4 }}>
                  Cost calculat din greutate reala + volumetrica (LxWxH/6000). Daca e gol, foloseste pretul Transport international fix.
                </div>
              </div>
            </div>
            <button type="submit" className="btn btn-primary">Salveaza costurile</button>
          </Form>
        </details>
      )}

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 0, borderBottom: '1px solid var(--border-default)', marginBottom: 'var(--space-md)', flexWrap: 'wrap' }}>
        {[
          { key: 'delivered' as const, label: `Livrate (${data.delivered})`, color: '#22c55e' },
          { key: 'returned' as const, label: `Returnate (${data.returned})`, color: '#ef4444' },
          { key: 'transit' as const, label: `In tranzit (${data.pickedUp + data.inTransit})`, color: '#f59e0b' },
          ...(data.overCostTotal > 0 ? [{ key: 'overcost' as const, label: `Transport depasit (${data.overCostTotal})`, color: '#dc2626' }] : []),
          { key: 'invoices' as const, label: `Facturi SameDay (${samedayInvoices.length})`, color: '#6366f1' },
        ].map(t => (
          <button key={t.key} onClick={() => { setTab(t.key); setPage(0); }} style={{
            padding: '10px 20px', fontSize: '0.8125rem', fontWeight: tab === t.key ? 600 : 400,
            background: 'none', border: 'none', cursor: 'pointer',
            borderBottom: tab === t.key ? `2px solid ${t.color}` : '2px solid transparent',
            color: tab === t.key ? 'var(--text-primary)' : 'var(--text-muted)',
            marginBottom: -1,
          }}>{t.label}</button>
        ))}
      </div>

      {/* Facturi SameDay */}
      {tab === 'invoices' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' }}>
          <div className="card" style={{ padding: 'var(--space-md)' }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 'var(--space-md)', flexWrap: 'wrap' }}>
              <div style={{ flex: 1, minWidth: 280 }}>
                <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8 }}>
                  <FileText size={16} /> Import factură SameDay
                </h3>
                <p style={{ margin: '6px 0 0 0', fontSize: '0.8125rem', color: 'var(--text-muted)', lineHeight: 1.5 }}>
                  Introdu numărul facturii din panoul client.sameday.ro. BI descarcă desfășurătorul CSV, salvează liniile per AWB și actualizează automat costul real de transport în tracking (suprascrie estimarea, păstrează vechea valoare în <code>estimatedCost</code>).
                </p>
              </div>
              <Form method="post" style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-start' }}>
                <input type="hidden" name="intent" value="importInvoice" />
                <input type="hidden" name="storeId" value={selectedStoreId || ''} />
                <input
                  type="text"
                  name="invoiceNumber"
                  placeholder="ex: 270500021017"
                  required
                  style={{
                    padding: '8px 12px',
                    fontSize: '0.875rem',
                    border: '1px solid var(--border-default)',
                    borderRadius: 6,
                    background: 'var(--bg-input, white)',
                    color: 'var(--text-primary)',
                    minWidth: 180,
                  }}
                />
                <button
                  type="submit"
                  style={{
                    padding: '8px 16px',
                    fontSize: '0.875rem',
                    fontWeight: 600,
                    background: '#6366f1',
                    color: 'white',
                    border: 'none',
                    borderRadius: 6,
                    cursor: 'pointer',
                  }}
                >
                  Importă
                </button>
              </Form>
            </div>
            {actionData && 'error' in actionData && actionData.error && (
              <div style={{ marginTop: 12, padding: 10, background: 'rgba(239,68,68,0.1)', color: '#dc2626', borderRadius: 6, fontSize: '0.8125rem' }}>
                {actionData.error}
              </div>
            )}
            {actionData && 'success' in actionData && actionData.success && (
              <div style={{ marginTop: 12, padding: 10, background: 'rgba(34,197,94,0.1)', color: '#15803d', borderRadius: 6, fontSize: '0.8125rem' }}>
                {actionData.success}
              </div>
            )}
          </div>

          <div className="card" style={{ overflowX: 'auto' }}>
            {samedayInvoices.length === 0 ? (
              <div style={{ padding: 'var(--space-lg)', textAlign: 'center', color: 'var(--text-muted)' }}>
                Nicio factură importată încă. Introdu un număr de factură SameDay mai sus pentru a începe.
              </div>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 700 }}>
                <thead>
                  <tr>
                    <th style={thStyle}>Număr factură</th>
                    <th style={thStyle}>Data factură</th>
                    <th style={{ ...thStyle, textAlign: 'right' }}>AWB-uri</th>
                    <th style={{ ...thStyle, textAlign: 'right' }}>Total facturat</th>
                    <th style={thStyle}>Status</th>
                    <th style={thStyle}>Aplicat la</th>
                    <th style={thStyle}>Acțiuni</th>
                  </tr>
                </thead>
                <tbody>
                  {samedayInvoices.map((inv: any) => (
                    <tr key={inv.id} style={{ borderBottom: '0.5px solid var(--border-default)' }}>
                      <td style={{ ...tdStyle, fontWeight: 600, fontFamily: 'monospace' }}>{inv.invoiceNumber}</td>
                      <td style={tdStyle}>{inv.invoiceDate ? new Date(inv.invoiceDate).toLocaleDateString('ro-RO') : '-'}</td>
                      <td style={{ ...tdStyle, textAlign: 'right' }}>{inv.awbCount || 0}</td>
                      <td style={{ ...tdStyle, textAlign: 'right', fontWeight: 600 }}>{inv.totalAmount ? fmtMoney(inv.totalAmount) : '-'}</td>
                      <td style={tdStyle}>
                        <span style={{
                          display: 'inline-block',
                          padding: '2px 8px',
                          borderRadius: 4,
                          fontSize: '0.75rem',
                          fontWeight: 600,
                          background:
                            inv.status === 'APPLIED' ? 'rgba(34,197,94,0.15)' :
                            inv.status === 'ERROR' ? 'rgba(239,68,68,0.15)' :
                            'rgba(245,158,11,0.15)',
                          color:
                            inv.status === 'APPLIED' ? '#15803d' :
                            inv.status === 'ERROR' ? '#dc2626' :
                            '#b45309',
                        }}>
                          {inv.status}
                        </span>
                        {inv.errorMessage && (
                          <div style={{ fontSize: '0.7rem', color: '#dc2626', marginTop: 2 }}>{inv.errorMessage}</div>
                        )}
                      </td>
                      <td style={tdStyle}>{inv.appliedAt ? new Date(inv.appliedAt).toLocaleString('ro-RO', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '-'}</td>
                      <td style={tdStyle}>
                        <div style={{ display: 'flex', gap: 6 }}>
                          <Form method="post" style={{ display: 'inline' }}>
                            <input type="hidden" name="intent" value="importInvoice" />
                            <input type="hidden" name="storeId" value={selectedStoreId || ''} />
                            <input type="hidden" name="invoiceNumber" value={inv.invoiceNumber} />
                            <button type="submit" style={{ padding: '4px 10px', fontSize: '0.75rem', background: 'transparent', border: '1px solid var(--border-default)', borderRadius: 4, cursor: 'pointer', color: 'var(--text-primary)' }}>
                              Re-import
                            </button>
                          </Form>
                          <Form method="post" style={{ display: 'inline' }} onSubmit={(e) => { if (!confirm(`Stergi factura ${inv.invoiceNumber} din BI? (datele aplicate raman in CourierTracking)`)) e.preventDefault(); }}>
                            <input type="hidden" name="intent" value="deleteInvoice" />
                            <input type="hidden" name="storeId" value={selectedStoreId || ''} />
                            <input type="hidden" name="invoiceId" value={inv.id} />
                            <button type="submit" style={{ padding: '4px 10px', fontSize: '0.75rem', background: 'transparent', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 4, cursor: 'pointer', color: '#dc2626' }}>
                              Șterge
                            </button>
                          </Form>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {/* Overcost summary */}
      {tab === 'overcost' && data.overCostTotal > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 'var(--space-md)', marginBottom: 'var(--space-md)' }}>
          <div className="card">
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: 4 }}>Comenzi cu transport depasit</div>
            <div style={{ fontSize: '1.5rem', fontWeight: 700, color: '#dc2626' }}>{data.overCostTotal}</div>
            <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: 2 }}>din {data.delivered} livrate ({data.delivered > 0 ? Math.round(data.overCostTotal / data.delivered * 100) : 0}%)</div>
          </div>
          <div className="card">
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: 4 }}>Pierdere totala transport</div>
            <div style={{ fontSize: '1.5rem', fontWeight: 700, color: '#dc2626' }}>-{fmtMoney(data.overCostLoss)}</div>
            <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: 2 }}>Cost SameDay peste {data.shippingCharge} RON incasat</div>
          </div>
          <div className="card">
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: 4 }}>Pierdere medie/comanda</div>
            <div style={{ fontSize: '1.5rem', fontWeight: 700, color: '#dc2626' }}>-{fmtMoney(data.overCostTotal > 0 ? data.overCostLoss / data.overCostTotal : 0)}</div>
          </div>
        </div>
      )}

      {/* Overcost table / default delivered/returned/transit tables (hidden when on invoices tab) */}
      {tab === 'invoices' ? null : tab === 'overcost' ? (
        <div className="card" style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 700 }}>
            <thead>
              <tr>
                <th style={thStyle}>Comanda</th>
                <th style={thStyle}>AWB</th>
                <th style={thStyle}>Judet</th>
                <th style={{ ...thStyle, textAlign: 'right' }}>Valoare comanda</th>
                <th style={{ ...thStyle, textAlign: 'right' }}>Incasat transport</th>
                <th style={{ ...thStyle, textAlign: 'right' }}>Cost SameDay</th>
                <th style={{ ...thStyle, textAlign: 'right' }}>Diferenta</th>
                <th style={{ ...thStyle, textAlign: 'right' }}>Profit comanda</th>
                <th style={thStyle}>Data</th>
              </tr>
            </thead>
            <tbody>
              {data.overCostList.slice(page * perPage, (page + 1) * perPage).map((r: any) => (
                <tr key={r.awb} style={{ borderBottom: '0.5px solid var(--border-default)' }}>
                  <td style={{ ...tdStyle, fontWeight: 600 }}>{r.orderNumber || '-'}</td>
                  <td style={tdStyle}><code style={{ fontSize: '0.75rem' }}>{r.awb}</code></td>
                  <td style={tdStyle}>{r.county || '-'}</td>
                  <td style={{ ...tdStyle, textAlign: 'right' }}>{r.orderTotal > 0 ? fmtMoney(r.orderTotal) : '-'}</td>
                  <td style={{ ...tdStyle, textAlign: 'right', color: '#22c55e' }}>{fmtMoney(data.shippingCharge)}</td>
                  <td style={{ ...tdStyle, textAlign: 'right', fontWeight: 600, color: '#dc2626' }}>{fmtMoney(r.servicePayment)}</td>
                  <td style={{ ...tdStyle, textAlign: 'right', fontWeight: 700, color: '#dc2626' }}>-{fmtMoney(r.loss)}</td>
                  <td style={{ ...tdStyle, textAlign: 'right', fontWeight: 600, color: r.profit >= 0 ? '#22c55e' : '#dc2626' }}>
                    {r.orderTotal > 0 ? fmtMoney(r.profit) : '-'}
                  </td>
                  <td style={tdStyle}>{fmtDate(r.courierUpdatedAt)}</td>
                </tr>
              ))}
              {data.overCostList.length === 0 && (
                <tr><td colSpan={9} style={{ textAlign: 'center', padding: '32px 24px', color: 'var(--color-text-muted)' }}>
                  {data.shippingCharge > 0 ? 'Nicio comanda cu transport depasit.' : 'Seteaza pretul de transport catre client in formularul de costuri.'}
                </td></tr>
              )}
            </tbody>
          </table>
          {(() => {
            const totalPages = Math.ceil(data.overCostList.length / perPage);
            if (totalPages <= 1) return null;
            return (
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 16px', borderTop: '0.5px solid var(--border-default)' }}>
                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                  {page * perPage + 1}–{Math.min((page + 1) * perPage, data.overCostList.length)} din {data.overCostList.length}
                </span>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button disabled={page === 0} onClick={() => setPage(p => p - 1)} style={{ padding: '4px 12px', fontSize: '0.75rem', border: '0.5px solid var(--border-default)', borderRadius: 4, background: 'var(--bg-secondary)', cursor: page === 0 ? 'default' : 'pointer', opacity: page === 0 ? 0.4 : 1 }}>Anterior</button>
                  <button disabled={page >= totalPages - 1} onClick={() => setPage(p => p + 1)} style={{ padding: '4px 12px', fontSize: '0.75rem', border: '0.5px solid var(--border-default)', borderRadius: 4, background: 'var(--bg-secondary)', cursor: page >= totalPages - 1 ? 'default' : 'pointer', opacity: page >= totalPages - 1 ? 0.4 : 1 }}>Urmator</button>
                </div>
              </div>
            );
          })()}
        </div>
      ) : (
      /* Regular tables (delivered/returned/transit) */
      <div className="card" style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 600 }}>
          <thead>
            <tr>
              <th style={thStyle}>AWB</th>
              <th style={thStyle}>Comanda</th>
              <th style={thStyle}>Status</th>
              <th style={{ ...thStyle, textAlign: 'right' }}>COD</th>
              <th style={{ ...thStyle, textAlign: 'right' }}>Cost</th>
              <th style={thStyle}>Judet</th>
              {!country && <th style={thStyle}>Tara</th>}
              <th style={thStyle}>Data</th>
              {tab === 'delivered' && <th style={thStyle}>Plata</th>}
            </tr>
          </thead>
          <tbody>
            {(() => {
              const list = tab === 'delivered' ? data.recentDelivered : tab === 'returned' ? data.recentReturned : data.inTransitList;
              return list.slice(page * perPage, (page + 1) * perPage);
            })().map((r: any) => {
              const rowCurrency = r.currency || 'RON';
              const countryInfo = COUNTRY_MAP[rowCurrency];
              return (
                <tr key={r.awb} style={{ borderBottom: '0.5px solid var(--border-default)' }}>
                  <td style={tdStyle}><code style={{ fontSize: '0.75rem' }}>{r.awb}</code></td>
                  <td style={tdStyle}>{r.orderNumber || '-'}</td>
                  <td style={tdStyle}>
                    <span style={{
                      fontSize: '0.7rem', fontWeight: 600, padding: '2px 8px', borderRadius: 4,
                      background: tab === 'delivered' ? 'rgba(34,197,94,0.1)' : tab === 'returned' ? 'rgba(239,68,68,0.1)' : 'rgba(245,158,11,0.1)',
                      color: tab === 'delivered' ? '#15803d' : tab === 'returned' ? '#dc2626' : '#b45309',
                    }}>{r.statusName}</span>
                  </td>
                  <td style={{ ...tdStyle, textAlign: 'right', fontWeight: 600 }}>
                    {r.isCod ? `${(r.codAmount || 0).toLocaleString('ro-RO', { minimumFractionDigits: 2 })} ${rowCurrency}` : '0,00'}
                  </td>
                  <td style={{ ...tdStyle, textAlign: 'right', fontSize: '0.75rem', color: r.servicePayment ? 'var(--text-primary)' : 'var(--text-muted)' }}>
                    {r.servicePayment ? `${r.servicePayment.toLocaleString('ro-RO', { minimumFractionDigits: 2 })} RON` : '-'}
                  </td>
                  <td style={tdStyle}>{r.county || '-'}</td>
                  {!country && (
                    <td style={tdStyle}>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><Flag code={countryInfo?.code || rowCurrency} size={13} /></span>
                    </td>
                  )}
                  <td style={tdStyle}>{fmtDate(r.courierUpdatedAt)}</td>
                  {tab === 'delivered' && (
                    <td style={tdStyle}>
                      <span style={{ fontSize: '0.7rem', fontWeight: 600, padding: '2px 6px', borderRadius: 4, background: r.isCod ? 'rgba(245,158,11,0.1)' : 'rgba(59,130,246,0.1)', color: r.isCod ? '#b45309' : '#2563eb' }}>
                        {r.isCod ? 'COD' : 'Card'}
                      </span>
                    </td>
                  )}
                </tr>
              );
            })}
            {(() => {
              const list = tab === 'delivered' ? data.recentDelivered : tab === 'returned' ? data.recentReturned : data.inTransitList;
              return list.length === 0;
            })() && (
              <tr><td colSpan={!country ? 9 : 8} style={{ textAlign: 'center', padding: '32px 24px', color: 'var(--color-text-muted)' }}>Nicio inregistrare.</td></tr>
            )}
          </tbody>
        </table>
        {(() => {
          const list = tab === 'delivered' ? data.recentDelivered : tab === 'returned' ? data.recentReturned : data.inTransitList;
          const totalPages = Math.ceil(list.length / perPage);
          if (totalPages <= 1) return null;
          return (
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 16px', borderTop: '0.5px solid var(--border-default)' }}>
              <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                {page * perPage + 1}–{Math.min((page + 1) * perPage, list.length)} din {list.length}
              </span>
              <div style={{ display: 'flex', gap: 6 }}>
                <button disabled={page === 0} onClick={() => setPage(p => p - 1)} style={{ padding: '4px 12px', fontSize: '0.75rem', border: '0.5px solid var(--border-default)', borderRadius: 4, background: 'var(--bg-secondary)', cursor: page === 0 ? 'default' : 'pointer', opacity: page === 0 ? 0.4 : 1 }}>Anterior</button>
                <button disabled={page >= totalPages - 1} onClick={() => setPage(p => p + 1)} style={{ padding: '4px 12px', fontSize: '0.75rem', border: '0.5px solid var(--border-default)', borderRadius: 4, background: 'var(--bg-secondary)', cursor: page >= totalPages - 1 ? 'default' : 'pointer', opacity: page >= totalPages - 1 ? 0.4 : 1 }}>Urmator</button>
              </div>
            </div>
          );
        })()}
      </div>
      )}
    </div>
  );
}

const thStyle: React.CSSProperties = {
  textAlign: 'left', padding: 'var(--space-sm) var(--space-md)',
  fontSize: '0.75rem', color: 'var(--color-text-muted)', fontWeight: 600,
  borderBottom: '0.5px solid var(--border-default)',
};

const tdStyle: React.CSSProperties = {
  padding: 'var(--space-sm) var(--space-md)', fontSize: '0.8125rem',
};
