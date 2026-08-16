'use client';

import { useState } from 'react';
import type { AskOption } from '@/lib/assistant/interpret';

interface Props {
  question: string;
  options: AskOption[];
  answered?: string;
  onAnswer: (value: string) => void;
}

/**
 * سؤال توضيحي في منتصف أمر — المساعد يحتفظ بما فهمه ويطلب الناقص فقط.
 * الخيارات أزرار للاختصار، والحقل الحر متاح دائماً.
 */
export default function AskCard({ question, options, answered, onAnswer }: Props) {
  const [text, setText] = useState('');

  if (answered) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
        <p className="text-sm text-slate-500">{question}</p>
        <p className="text-sm font-semibold text-slate-700 mt-1">↩ {answered}</p>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border-2 border-amber-200 bg-amber-50 p-4 space-y-3">
      <div className="flex items-center gap-2">
        <span className="text-[11px] px-2 py-0.5 rounded-full bg-amber-200 text-amber-900 font-semibold">
          يحتاج توضيح
        </span>
        <p className="text-sm font-semibold text-amber-900">{question}</p>
      </div>

      {options.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {options.map((o) => (
            <button
              key={o.value}
              type="button"
              onClick={() => onAnswer(o.value)}
              className="px-3 py-1.5 rounded-lg bg-white border border-amber-300 text-amber-900 text-sm hover:bg-amber-100 transition-colors"
            >
              {o.label}
            </button>
          ))}
        </div>
      )}

      <div className="flex gap-2">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && text.trim()) {
              e.preventDefault();
              onAnswer(text.trim());
            }
          }}
          placeholder="أو اكتب الجواب هنا…"
          className="flex-1 rounded-lg border border-amber-300 bg-white px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-amber-200"
        />
        <button
          type="button"
          disabled={!text.trim()}
          onClick={() => onAnswer(text.trim())}
          className="px-3 py-1.5 rounded-lg bg-amber-600 text-white text-sm font-semibold disabled:opacity-40 hover:bg-amber-700 transition-colors"
        >
          إرسال
        </button>
      </div>
    </div>
  );
}
