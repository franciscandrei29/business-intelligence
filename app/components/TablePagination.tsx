
export function TablePagination({ total, perPage, page, onPerPageChange, onPageChange }: {
  total: number; perPage: number; page: number;
  onPerPageChange: (n: number) => void; onPageChange: (n: number) => void;
}) {
  const totalPages = Math.ceil(total / perPage);
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>Per pagin\u0103:</span>
        {[25, 50, 100].map(n => (
          <button key={n} onClick={() => onPerPageChange(n)}
            style={{ padding: '4px 10px', borderRadius: 6, border: perPage === n ? '1.5px solid var(--kimono-orange)' : '1px solid var(--border-default)', background: perPage === n ? 'rgba(216,90,48,0.08)' : 'white', color: perPage === n ? 'var(--kimono-orange)' : 'var(--text-secondary)', fontSize: 11, fontWeight: 600, cursor: 'pointer' }}>
            {n}
          </button>
        ))}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{page * perPage + 1}-{Math.min((page + 1) * perPage, total)} din {total}</span>
        <button onClick={() => onPageChange(Math.max(0, page - 1))} disabled={page === 0}
          style={{ padding: '4px 10px', borderRadius: 6, border: '1px solid var(--border-default)', background: 'white', fontSize: 11, cursor: page === 0 ? 'not-allowed' : 'pointer', opacity: page === 0 ? 0.4 : 1 }}>
          \u2190
        </button>
        <button onClick={() => onPageChange(Math.min(totalPages - 1, page + 1))} disabled={(page + 1) * perPage >= total}
          style={{ padding: '4px 10px', borderRadius: 6, border: '1px solid var(--border-default)', background: 'white', fontSize: 11, cursor: (page + 1) * perPage >= total ? 'not-allowed' : 'pointer', opacity: (page + 1) * perPage >= total ? 0.4 : 1 }}>
          \u2192
        </button>
      </div>
    </div>
  );
}
