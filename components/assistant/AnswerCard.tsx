'use client';

import type { Answer, AnswerBlock, StatItem } from '@/lib/assistant/types';

const TONE_STYLES: Record<NonNullable<StatItem['tone']>, string> = {
  default: 'bg-slate-50 border-slate-200 text-slate-800',
  primary: 'bg-emerald-50 border-emerald-200 text-emerald-800',
  success: 'bg-sky-50 border-sky-200 text-sky-800',
  warn: 'bg-amber-50 border-amber-200 text-amber-800',
};

function Stats({ items }: { items: StatItem[] }) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
      {items.map((s, i) => (
        <div
          key={`${s.label}-${i}`}
          className={`rounded-xl border px-3 py-2.5 ${TONE_STYLES[s.tone ?? 'default']}`}
        >
          <div className="text-[11px] opacity-70 leading-tight">{s.label}</div>
          <div className="text-xl font-bold tabular-nums leading-tight mt-0.5">{s.value}</div>
          {s.hint && <div className="text-[10px] opacity-60 mt-0.5 truncate">{s.hint}</div>}
        </div>
      ))}
    </div>
  );
}

function Table({
  caption,
  columns,
  rows,
  numericColumns,
}: Extract<AnswerBlock, { type: 'table' }>) {
  const numeric = new Set(numericColumns ?? []);
  return (
    <div>
      {caption && <div className="text-xs font-semibold text-slate-500 mb-1.5">{caption}</div>}
      <div className="overflow-x-auto rounded-xl border border-slate-200">
        <table className="w-full text-sm min-w-[520px]">
          <thead className="bg-slate-50">
            <tr>
              {columns.map((c) => (
                <th
                  key={c}
                  className="text-start font-semibold text-slate-600 px-3 py-2 whitespace-nowrap text-xs"
                >
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className="border-t border-slate-100 hover:bg-slate-50/60">
                {r.map((cell, j) => (
                  <td
                    key={j}
                    className={`px-3 py-2 text-slate-700 whitespace-nowrap ${
                      numeric.has(j) ? 'tabular-nums font-semibold' : ''
                    }`}
                  >
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Block({ block }: { block: AnswerBlock }) {
  switch (block.type) {
    case 'stats':
      return <Stats items={block.items} />;
    case 'table':
      return <Table {...block} />;
    case 'list':
      return (
        <div>
          {block.caption && (
            <div className="text-xs font-semibold text-slate-500 mb-1.5">{block.caption}</div>
          )}
          <ul className="flex flex-wrap gap-1.5">
            {block.items.map((it, i) => (
              <li
                key={`${it}-${i}`}
                className="px-2.5 py-1 rounded-lg bg-slate-100 text-slate-700 text-sm"
              >
                {it}
              </li>
            ))}
          </ul>
        </div>
      );
    case 'note':
      return (
        <div
          className={`text-xs rounded-lg px-3 py-2 border leading-relaxed ${
            block.tone === 'warn'
              ? 'bg-amber-50 border-amber-200 text-amber-800'
              : 'bg-slate-50 border-slate-200 text-slate-600'
          }`}
        >
          {block.text}
        </div>
      );
  }
}

interface Props {
  answer: Answer;
  onSuggestion?: (q: string) => void;
}

export default function AnswerCard({ answer, onSuggestion }: Props) {
  return (
    <div
      className={`rounded-2xl border bg-white p-4 space-y-3 shadow-sm ${
        answer.ok ? 'border-slate-200' : 'border-amber-200'
      }`}
    >
      <div>
        <h3 className="font-bold text-slate-800 text-base">{answer.title}</h3>
        <p className="text-sm text-slate-600 mt-1 leading-relaxed">{answer.summary}</p>
      </div>

      {answer.blocks.map((b, i) => (
        <Block key={i} block={b} />
      ))}

      {answer.source && (
        <div className="text-[11px] text-slate-400 border-t border-slate-100 pt-2 leading-relaxed">
          المصدر: {answer.source}
        </div>
      )}

      {answer.suggestions && answer.suggestions.length > 0 && onSuggestion && (
        <div className="flex flex-wrap gap-1.5 pt-1">
          {answer.suggestions.map((s, i) => (
            <button
              key={`${s}-${i}`}
              type="button"
              onClick={() => onSuggestion(s)}
              className="px-2.5 py-1 rounded-lg border border-emerald-200 bg-emerald-50 text-emerald-700 text-xs hover:bg-emerald-100 transition-colors"
            >
              {s}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
