'use client';

interface Props {
  page: number;
  pageCount: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
}

export default function Pagination({ page, pageCount, pageSize, total, onPageChange }: Props) {
  if (total === 0) return null;
  const start = (page - 1) * pageSize + 1;
  const end = Math.min(page * pageSize, total);

  const pages = buildPageList(page, pageCount);

  return (
    <div className="flex items-center justify-between gap-3 px-2 py-3 text-sm">
      <p className="text-slate-500">
        عرض <span className="font-semibold text-slate-700">{start}</span>
        {' - '}
        <span className="font-semibold text-slate-700">{end}</span>
        {' من '}
        <span className="font-semibold text-slate-700">{total}</span>
      </p>

      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => onPageChange(page - 1)}
          disabled={page <= 1}
          className="px-2.5 py-1 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-40 disabled:hover:bg-transparent transition-colors"
        >
          السابق
        </button>
        {pages.map((p, i) =>
          p === '…' ? (
            <span key={`gap-${i}`} className="px-2 text-slate-400">…</span>
          ) : (
            <button
              key={p}
              type="button"
              onClick={() => onPageChange(p)}
              className={`min-w-[2rem] px-2 py-1 rounded-lg border text-sm font-medium transition-colors ${
                p === page
                  ? 'bg-emerald-500 border-emerald-500 text-white'
                  : 'border-slate-200 text-slate-600 hover:bg-slate-50'
              }`}
            >
              {p}
            </button>
          )
        )}
        <button
          type="button"
          onClick={() => onPageChange(page + 1)}
          disabled={page >= pageCount}
          className="px-2.5 py-1 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-40 disabled:hover:bg-transparent transition-colors"
        >
          التالي
        </button>
      </div>
    </div>
  );
}

function buildPageList(current: number, total: number): (number | '…')[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const out: (number | '…')[] = [1];
  const left = Math.max(2, current - 1);
  const right = Math.min(total - 1, current + 1);
  if (left > 2) out.push('…');
  for (let p = left; p <= right; p++) out.push(p);
  if (right < total - 1) out.push('…');
  out.push(total);
  return out;
}
