'use client';

/**
 * ستيكر عينة واحد بمقاس ثابت (widthCm × heightCm) — نفس المعروض هو اللي
 * يُلتقط للـPDF وWord والطباعة، فالشكل طبق الأصل في كل التصديرات.
 *
 * كل سطر يصغر عرضاً لين يدخل في سطر واحد (AutoFitText)، ولو فاض المحتوى
 * طولاً يصغر الكل بنسبة واحدة (k) لين يدخل — ما يُقصّ شي.
 */

import { memo, useLayoutEffect, useRef, useState } from 'react';
import { AutoFitText } from '@/components/lunch-dinner-stickers/ld-sticker-card';
import type { EntityType, MealType } from '@/lib/types';
import {
  ENTITY_AR, ENTITY_EN, MEAL_AR, MEAL_EN, formatDMY,
  type SampleDesign,
} from './sample-stickers';

export interface SampleStickerProps {
  design: SampleDesign;
  widthCm: number;
  heightCm: number;
  nameAr: string;
  nameEn: string;
  mealType: MealType;
  entity: EntityType;
  /** تاريخ الإنتاج (تاريخ أمر التشغيل) YYYY-MM-DD */
  productionISO: string;
  /** تاريخ الانتهاء YYYY-MM-DD */
  expiryISO: string;
  innerRef?: (el: HTMLDivElement | null) => void;
}

/** سطر ثنائي اللغة: العربي يميناً والإنجليزي يساراً */
function BiRow({ ar, en, px, color, bold = true }: {
  ar: string; en: string; px: number; color?: string; bold?: boolean;
}) {
  return (
    <div className="flex items-center w-full" style={{ gap: px * 0.6 }}>
      <div className="flex-1 min-w-0 text-right">
        <AutoFitText text={ar} maxPx={px} minPx={4} bold={bold} dir="rtl" color={color} />
      </div>
      <div className="flex-1 min-w-0 text-left">
        <AutoFitText text={en} maxPx={px * 0.92} minPx={4} bold={bold} dir="ltr" color={color} />
      </div>
    </div>
  );
}

function SampleStickerCard({
  design, widthCm, heightCm, nameAr, nameEn, mealType, entity, productionISO, expiryISO, innerRef,
}: SampleStickerProps) {
  const { show, sizes, accent } = design;
  const base = Math.min(widthCm, heightCm) / 10;

  // تصغير موحّد لو المحتوى فاض طولاً
  const [k, setK] = useState(1);
  const bodyRef = useRef<HTMLDivElement>(null);
  const fitKey = `${widthCm}|${heightCm}|${nameAr}|${nameEn}|${JSON.stringify(design)}`;
  const [lastKey, setLastKey] = useState(fitKey);
  if (lastKey !== fitKey) { setLastKey(fitKey); setK(1); }
  useLayoutEffect(() => {
    const body = bodyRef.current;
    if (!body || body.scrollHeight <= body.clientHeight + 1) return;
    if (k > 0.35) setK(v => Math.round((v - 0.05) * 100) / 100);
  }, [k, fitKey]);

  const s = base * k;
  const px = (f: keyof SampleDesign['sizes']) => sizes[f] * s;
  const rule = <div className="shrink-0 w-full" style={{ borderTop: `${Math.max(1, 1.5 * s)}px solid #0f172a` }} />;

  return (
    <div
      ref={innerRef}
      className="sample-sticker bg-white text-slate-900 flex flex-col overflow-hidden shrink-0"
      style={{
        width: `${widthCm}cm`,
        height: `${heightCm}cm`,
        border: design.border ? '1px solid #000' : '1px dashed #cbd5e1',
      }}
    >
      <div
        ref={bodyRef}
        className="flex-1 min-h-0 flex flex-col justify-between overflow-hidden"
        style={{ padding: 7 * s, gap: 4 * s }}
      >
        {/* الرأس: الشعار يميناً + نوع الوجبة بخط عريض واضح */}
        {(show.logo || show.meal) && (
          <div className="shrink-0 flex items-center" style={{ gap: 6 * s }}>
            {show.logo && (
              // نسخة الشعار المقصوصة بلا فراغ شفاف حولها — الأصلي يستخدمه غير هذي الصفحة
              // eslint-disable-next-line @next/next/no-img-element
              <img src="/logo-hope-sample.png" alt="خطوة أمل" className="object-contain shrink-0"
                style={{ height: px('logo'), width: 'auto' }} />
            )}
            {show.meal && (
              <div className="flex-1 min-w-0 text-center" style={{ lineHeight: 1.1 }}>
                <AutoFitText text={MEAL_AR[mealType]} maxPx={px('meal')} minPx={4} bold dir="rtl" />
                <AutoFitText text={MEAL_EN[mealType].toUpperCase()} maxPx={px('meal') * 0.75} minPx={4} bold dir="ltr" />
              </div>
            )}
          </div>
        )}

        {/* العنوان */}
        {show.title && (
          <div
            className="shrink-0 text-center rounded"
            style={{
              background: design.titleFilled ? accent : 'transparent',
              border: design.titleFilled ? undefined : `${Math.max(1, 2 * s)}px solid ${accent}`,
              paddingBlock: 3 * s,
              paddingInline: 6 * s,
            }}
          >
            <AutoFitText
              text={[design.titleAr.trim(), design.titleEn.trim()].filter(Boolean).join('  ·  ')}
              maxPx={px('title')} bold dir="rtl"
              color={design.titleFilled ? '#ffffff' : accent}
            />
          </div>
        )}

        {/* الفئة */}
        {show.entity && (
          <div className="shrink-0">
            <BiRow ar={ENTITY_AR[entity]} en={ENTITY_EN[entity]} px={px('entity')} />
          </div>
        )}

        {/* اسم الصنف — صندوق بإطار */}
        {(show.item || show.itemEn) && (
          <div
            className="shrink-0 text-center"
            style={{ border: `${Math.max(1, 2 * s)}px solid #0f172a`, paddingBlock: 4 * s, paddingInline: 6 * s }}
          >
            {show.item && <AutoFitText text={nameAr} maxPx={px('item')} bold dir="rtl" />}
            {show.itemEn && nameEn && (
              <AutoFitText text={nameEn} maxPx={px('itemEn')} bold dir="ltr" />
            )}
          </div>
        )}

        {/* التواريخ */}
        {(show.production || show.expiry) && (
          <div className="shrink-0 flex flex-col" style={{ gap: 2 * s }}>
            {rule}
            {show.production && (
              <BiRow
                ar={`الإنتاج: ${formatDMY(productionISO)}`}
                en={`Prod: ${formatDMY(productionISO)}`}
                px={px('production')}
              />
            )}
            {show.expiry && (
              <BiRow
                ar={`الانتهاء: ${formatDMY(expiryISO)}`}
                en={`Exp: ${formatDMY(expiryISO)}`}
                px={px('expiry')}
                color={accent}
              />
            )}
          </div>
        )}

        {/* ملاحظة الحفظ */}
        {show.note && (design.noteAr.trim() || design.noteEn.trim()) && (
          <BiRow ar={design.noteAr.trim()} en={design.noteEn.trim()} px={px('note')} bold={false} />
        )}
      </div>
    </div>
  );
}

/** محفوظ بـmemo — تقدّم التصدير أو الكتابة في الحقول ما يعيد رسم كل الستيكرات */
export default memo(SampleStickerCard);
