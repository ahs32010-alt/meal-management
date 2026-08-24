'use client';

/**
 * بطاقة رد المزوّد الذكي.
 *
 * تعليمات النظام تطلب من النموذج جداول Markdown للمقارنات، فنصيّرها هنا.
 * المُصيّر مقصود صغيراً ويغطّي ما نطلبه فقط: فقرات، نقاط، جداول، وعريض.
 *
 * ولا يمرّ شيء عبر `dangerouslySetInnerHTML`: النص مولَّد من نموذج قد يُوجَّه
 * بمحتوى من قاعدة البيانات، وحقن HTML من هذا الطريق ثغرة حقيقية. كل مخرَج
 * هنا عناصر React، فالنص يبقى نصاً مهما كان.
 */

import { Fragment, type ReactNode } from 'react';

/** **عريض** فقط — ما عداه يبقى نصاً كما هو. */
function renderInline(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**') && part.length > 4) {
      return (
        <strong key={i} className="font-bold text-slate-900">
          {part.slice(2, -2)}
        </strong>
      );
    }
    return <Fragment key={i}>{part}</Fragment>;
  });
}

const splitRow = (line: string) =>
  line
    .replace(/^\s*\|/, '')
    .replace(/\|\s*$/, '')
    .split('|')
    .map((c) => c.trim());

const isTableRow = (line: string) => /^\s*\|.*\|\s*$/.test(line);
const isSeparator = (line: string) => /^\s*\|[\s:|-]+\|\s*$/.test(line);
const isBullet = (line: string) => /^\s*[-*•]\s+/.test(line);

type Block =
  | { type: 'table'; head: string[]; rows: string[][] }
  | { type: 'list'; items: string[] }
  | { type: 'text'; lines: string[] };

function toBlocks(markdown: string): Block[] {
  const lines = markdown.split('\n');
  const blocks: Block[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // جدول: صف عناوين + فاصل + صفوف
    if (isTableRow(line) && i + 1 < lines.length && isSeparator(lines[i + 1])) {
      const head = splitRow(line);
      const rows: string[][] = [];
      i += 2;
      while (i < lines.length && isTableRow(lines[i]) && !isSeparator(lines[i])) {
        rows.push(splitRow(lines[i]));
        i++;
      }
      blocks.push({ type: 'table', head, rows });
      continue;
    }

    if (isBullet(line)) {
      const items: string[] = [];
      while (i < lines.length && isBullet(lines[i])) {
        items.push(lines[i].replace(/^\s*[-*•]\s+/, ''));
        i++;
      }
      blocks.push({ type: 'list', items });
      continue;
    }

    if (!line.trim()) {
      i++;
      continue;
    }

    const text: string[] = [];
    while (i < lines.length && lines[i].trim() && !isBullet(lines[i]) && !isTableRow(lines[i])) {
      text.push(lines[i]);
      i++;
    }
    if (text.length) blocks.push({ type: 'text', lines: text });
  }

  return blocks;
}

export interface AiMeta {
  provider?: string;
  model?: string;
  toolsUsed?: string[];
  fellBack?: boolean;
}

export default function AiAnswerCard({ text, meta }: { text: string; meta?: AiMeta }) {
  const blocks = toBlocks(text);

  return (
    <div className="rounded-2xl border border-violet-200 bg-white p-4 shadow-sm">
      <div className="space-y-3 text-sm text-slate-700 leading-relaxed">
        {blocks.map((block, i) => {
          if (block.type === 'table') {
            return (
              <div key={i} className="overflow-x-auto -mx-1 px-1">
                <table className="w-full text-sm border-collapse">
                  <thead>
                    <tr className="bg-slate-50">
                      {block.head.map((cell, c) => (
                        <th
                          key={c}
                          className="text-start font-bold text-slate-600 text-xs px-3 py-2 border-b border-slate-200 whitespace-nowrap"
                        >
                          {renderInline(cell)}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {block.rows.map((row, r) => (
                      <tr key={r} className="border-b border-slate-100 last:border-0">
                        {row.map((cell, c) => (
                          <td key={c} className="px-3 py-1.5 align-top">
                            {renderInline(cell)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          }

          if (block.type === 'list') {
            return (
              <ul key={i} className="list-disc ps-5 space-y-1">
                {block.items.map((item, n) => (
                  <li key={n}>{renderInline(item)}</li>
                ))}
              </ul>
            );
          }

          return (
            <p key={i} className="whitespace-pre-wrap">
              {block.lines.map((line, n) => (
                <Fragment key={n}>
                  {n > 0 && <br />}
                  {renderInline(line)}
                </Fragment>
              ))}
            </p>
          );
        })}
      </div>

      {meta && (meta.provider || meta.toolsUsed?.length) && (
        <div className="mt-3 pt-2 border-t border-slate-100 flex flex-wrap items-center gap-1.5 text-[11px] text-slate-400">
          {meta.provider && (
            <span className="px-1.5 py-0.5 rounded bg-violet-50 text-violet-600 font-semibold">
              {meta.provider}
              {meta.model ? ` · ${meta.model}` : ''}
            </span>
          )}
          {meta.fellBack && (
            <span className="px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 font-semibold">
              المزوّد المطلوب غير مهيّأ — رددنا بهذا بدلاً عنه
            </span>
          )}
          {/* أسماء الأدوات تُبنى الثقة بها: المستخدم يرى أن الرقم قُرئ لا خُمِّن */}
          {meta.toolsUsed?.length ? <span>قرأ: {[...new Set(meta.toolsUsed)].join('، ')}</span> : null}
        </div>
      )}
    </div>
  );
}
