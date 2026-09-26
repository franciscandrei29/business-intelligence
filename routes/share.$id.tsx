import type { LoaderFunctionArgs, MetaFunction } from '@remix-run/node';
import { json } from '@remix-run/node';
import { useLoaderData } from '@remix-run/react';
import { getSharedReport } from '~/lib/share';

export const meta: MetaFunction = () => [{ title: 'Raport partajat — Kimono BI' }];

export async function loader({ params }: LoaderFunctionArgs) {
  const shareId = params.id;
  if (!shareId) return json({ error: 'Link invalid.' }, { status: 404 });

  const report = getSharedReport(shareId);
  if (!report) return json({ error: 'Raportul nu a fost gasit sau link-ul a expirat.' }, { status: 404 });

  return json({ report });
}

function DataRow({ label, value }: { label: string; value: string | number }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '12px 0', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
      <span style={{ color: '#8b8ba7', fontSize: '0.875rem' }}>{label}</span>
      <span style={{ color: '#e2e2f0', fontSize: '0.875rem', fontWeight: 600 }}>{typeof value === 'number' ? value.toLocaleString('ro-RO') : value}</span>
    </div>
  );
}

export default function SharedReportPage() {
  const data = useLoaderData<typeof loader>();

  if ('error' in data) {
    return (
      <div style={{ minHeight: '100vh', background: '#0f0f1a', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: "'Inter', sans-serif" }}>
        <div style={{ textAlign: 'center', padding: 40 }}>
          <h1 style={{ color: '#e74c3c', fontSize: '1.5rem', marginBottom: 12 }}>Link invalid</h1>
          <p style={{ color: '#8b8ba7', fontSize: '0.875rem' }}>{data.error}</p>
        </div>
      </div>
    );
  }

  const { report } = data;
  const rd = report.reportData;

  return (
    <div style={{ minHeight: '100vh', background: '#0f0f1a', fontFamily: "'Inter', -apple-system, sans-serif", padding: '40px 20px' }}>
      <div style={{ maxWidth: 680, margin: '0 auto' }}>
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <h1 style={{ color: '#a29bfe', fontSize: '1.25rem', fontWeight: 700, margin: 0 }}>
            Kimono <span style={{ color: '#6c5ce7' }}>BI</span> — Raport partajat
          </h1>
          <p style={{ color: '#8b8ba7', fontSize: '0.8125rem', marginTop: 8 }}>
            {report.storeName} &middot; {new Date(report.createdAt).toLocaleDateString('ro-RO')}
          </p>
        </div>

        <div style={{
          background: '#1a1a2e',
          border: '1px solid #2d2d44',
          borderRadius: 12,
          padding: 28,
          marginBottom: 24,
        }}>
          <h2 style={{ color: '#e2e2f0', fontSize: '1.125rem', fontWeight: 600, marginTop: 0, marginBottom: 20 }}>
            {rd.type || report.reportType}
          </h2>

          {rd.type === 'Dashboard Summary' && (
            <>
              <DataRow label="Produse" value={rd.productCount} />
              <DataRow label="Comenzi" value={rd.orderCount} />
              <DataRow label="Clienti" value={rd.customerCount} />
              <DataRow label="Venit total" value={rd.totalRevenue.toLocaleString('ro-RO', { style: 'currency', currency: 'RON' })} />
            </>
          )}

          {rd.type === 'RFM Analysis' && (
            <>
              <DataRow label="Total clienti analizati" value={rd.totalCustomers} />
              {rd.segments && Object.entries(rd.segments).map(([seg, count]: any) => (
                <DataRow key={seg} label={seg} value={count} />
              ))}
            </>
          )}

          {rd.type === 'Revenue Forecast' && (
            <>
              <DataRow label="Venit ultimele 30 zile" value={rd.last30DaysRevenue.toLocaleString('ro-RO', { style: 'currency', currency: 'RON' })} />
              <DataRow label="Comenzi ultimele 30 zile" value={rd.last30DaysOrders} />
              <DataRow label="Valoare medie comanda" value={rd.avgOrderValue.toLocaleString('ro-RO', { style: 'currency', currency: 'RON' })} />
            </>
          )}

          {rd.type === 'BI Audit' && (
            <>
              <DataRow label="Produse" value={rd.products} />
              <DataRow label="Comenzi" value={rd.orders} />
              <DataRow label="Clienti" value={rd.customers} />
              <DataRow label="Calitate date" value={rd.dataQuality} />
            </>
          )}
        </div>

        <div style={{ textAlign: 'center', color: '#4a4a6a', fontSize: '0.75rem' }}>
          Generat cu Kimono BI &middot; Expira {new Date(report.expiresAt).toLocaleDateString('ro-RO')}
        </div>
      </div>
    </div>
  );
}
