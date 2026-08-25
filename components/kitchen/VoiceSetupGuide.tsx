'use client';

/**
 * دليل تثبيت الصوت العربي على الجهاز.
 *
 * أرخص حلّ وأمتنه: صوت الجهاز مجاني بلا حصة ولا إنترنت ولا مفتاح. المشكلة
 * الأصلية لم تكن رداءة الأصوات العربية، بل **غيابها** عن الجهاز — فالمحرّك
 * الإنجليزي كان يحاول نطق العربية.
 *
 * والخطوات تُعرض لمنصّة واحدة لا للكل: من يقف أمام التابلت لا يحتاج خطوات
 * آيفون تزاحم خطوات أندرويد على الشاشة.
 */

import { useEffect, useState } from 'react';
import { detectPlatform, SETUP_GUIDES, type Platform } from '@/lib/kitchen/platform';

const ORDER: Platform[] = ['android', 'ios', 'desktop'];

export default function VoiceSetupGuide({ onUseServer }: { onUseServer?: () => void }) {
  const [platform, setPlatform] = useState<Platform>('desktop');

  useEffect(() => {
    setPlatform(detectPlatform());
  }, []);

  const guide = SETUP_GUIDES[platform];

  return (
    <div className="rounded-2xl bg-slate-800 border-2 border-slate-700 p-5">
      <h3 className="font-bold text-lg mb-1">تثبيت صوت عربي على هذا الجهاز</h3>
      <p className="text-sm text-slate-400 leading-relaxed mb-4">
        أفضل حل وأرخصه: مجاني تماماً، بلا حصة ولا إنترنت، ويشتغل فوراً عند كل ضغطة.
      </p>

      {/* تبديل المنصّة — الاستنتاج تقريبي، فلا نحبس المستخدم على تخميننا */}
      <div className="flex gap-1.5 mb-4">
        {ORDER.map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => setPlatform(key)}
            className={`flex-1 h-11 rounded-xl text-sm font-bold border-2 ${
              platform === key
                ? 'bg-emerald-600 border-emerald-400'
                : 'bg-slate-700 border-slate-600 text-slate-300'
            }`}
          >
            {SETUP_GUIDES[key].title}
          </button>
        ))}
      </div>

      <ol className="space-y-2.5">
        {guide.steps.map((step, i) => (
          <li key={i} className="flex gap-3 text-sm">
            <span className="w-7 h-7 rounded-full bg-slate-700 grid place-items-center font-bold text-xs flex-shrink-0 tabular-nums">
              {i + 1}
            </span>
            <span className="pt-0.5 leading-relaxed">{step}</span>
          </li>
        ))}
      </ol>

      {guide.note && <p className="text-xs text-slate-500 mt-4 leading-relaxed">{guide.note}</p>}

      <div className="mt-5 flex flex-col gap-2">
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="h-12 rounded-xl bg-emerald-600 font-bold active:bg-emerald-700"
        >
          ثبّتُّه — أعد الفحص
        </button>
        {onUseServer && (
          <button
            type="button"
            onClick={onUseServer}
            className="h-12 rounded-xl bg-slate-700 font-bold text-slate-200 active:bg-slate-600"
          >
            لاحقاً — استخدم الصوت المولَّد الآن
          </button>
        )}
      </div>
    </div>
  );
}
