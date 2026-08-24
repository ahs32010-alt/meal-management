'use client';

/**
 * ستيكر الغداء/العشاء — نموذج واحد يخدم التبويبين:
 *   • «ثابتة»      → بدون `custom` (الستيكر الأساسي للمستفيد)
 *   • «حسب الوجبة» → مع `custom` فيُضاف في آخر الستيكر محظور/بديل هذا الأمر
 *
 * أي تعديل على شكل الستيكر يصير هنا مرّة واحدة فينعكس على التبويبين معاً.
 */

import { useLayoutEffect, useRef } from 'react';
import type { Beneficiary } from '@/lib/types';
import { STICKER_FLAGS } from '@/lib/sticker-flags';
import { hasCustomization, type LdMealCustomization } from './ld-types';

// ترجمة إنجليزية لأنواع الأنظمة الغذائية الشائعة — تُعرض كسطر ثانٍ تحت العربي.
export const DIET_TYPE_EN: Record<string, string> = {
  'عادي': 'Normal diet',
  'نظام غذائي عادي': 'Normal diet',
  'سكري': 'Diabetic diet',
  'سكر': 'Diabetic diet',
  'لين': 'Soft diet',
  'مهروس': 'Pureed diet',
  'سائل': 'Liquid diet',
  'قليل الملح': 'Low salt diet',
  'قليل الدهون': 'Low fat diet',
  'كلوي': 'Renal diet',
  'نباتي': 'Vegetarian diet',
};

export function dietLines(diet?: string): { ar: string; en: string } {
  const ar = (diet ?? '').trim() || 'نظام غذائي عادي';
  return { ar, en: DIET_TYPE_EN[ar] ?? '' };
}

// ── نص يتكيّف تلقائياً ليبقى في سطر واحد داخل عرض الحاوية (يتصغّر/يتكبّر) ──────
export function AutoFitText({
  text, maxPx, minPx = 6, bold, underline, dir, color, className,
}: {
  text: string; maxPx: number; minPx?: number; bold?: boolean;
  underline?: boolean; dir?: 'rtl' | 'ltr'; color?: string; className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const fit = () => {
      let size = maxPx;
      el.style.fontSize = `${size}px`;
      // يتصغّر تدريجياً لين النص يدخل في سطر واحد ضمن عرض الحاوية
      let guard = 200;
      while (size > minPx && el.scrollWidth > el.clientWidth && guard-- > 0) {
        size -= 0.5;
        el.style.fontSize = `${size}px`;
      }
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [text, maxPx, minPx]);

  return (
    <div
      ref={ref}
      dir={dir}
      className={className}
      style={{
        whiteSpace: 'nowrap',
        overflow: 'hidden',
        width: '100%',
        fontWeight: bold ? 700 : 400,
        textDecoration: underline ? 'underline' : undefined,
        color,
        lineHeight: 1.15,
      }}
    >
      {text}
    </div>
  );
}

// ── الهيدر الافتراضي (لو ما رُفعت صورة هيدر مخصّصة) ──────────────────────────
export function DefaultHeader({ s }: { s: number }) {
  return (
    <div className="relative flex items-center justify-center w-full" style={{ paddingBlock: 4 * s }}>
      <div className="text-center leading-tight px-1 min-w-0">
        <AutoFitText text="خدمات الطعام" maxPx={20 * s} bold dir="rtl" color="#047857" />
        <AutoFitText text="Food Services" maxPx={15 * s} bold dir="ltr" color="#047857" />
      </div>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/logo-hope.png"
        alt="خطوة أمل"
        className="absolute object-contain"
        style={{ right: 4 * s, top: 2 * s, height: 40 * s, width: 'auto' }}
      />
    </div>
  );
}

// ألوان قسم التخصيصات — نفس دلالة ستيكرات الفطور (محظور أحمر، بديل أزرق)
const EXCL_COLOR = '#b91c1c';
const ALT_COLOR = '#1d4ed8';

// ── قسم تخصيصات الوجبة — آخر الستيكر، تبويب «حسب الوجبة» فقط ────────────────
function CustomizationBlock({ custom, s, heightCm }: {
  custom: LdMealCustomization; s: number; heightCm: number;
}) {
  const exAr = custom.excluded.map(e => e.ar).filter(Boolean);
  const exEn = custom.excluded.map(e => e.en).filter(Boolean);
  const altAr = custom.alternatives.map(a => a.ar).filter(Boolean);
  const altEn = custom.alternatives.map(a => a.en).filter(Boolean);

  return (
    // سقف الارتفاع يحمي القالب: التخصيصات الطويلة تُقصّ ولا تدفع الستيكر خارج مقاسه
    <div className="shrink-0 overflow-hidden" style={{ maxHeight: `${heightCm * 0.36}cm`, marginTop: 2 * s }}>
      <div className="border-t-[3px] border-black" style={{ marginBottom: 3 * s }} />
      <div className="text-center font-bold underline" style={{ fontSize: 10 * s, marginBottom: 2 * s }}>
        تخصيصات {custom.mealAr} — {custom.mealEn}
      </div>

      {exAr.length > 0 && (
        <div className="text-center leading-tight" style={{ color: EXCL_COLOR }}>
          <div dir="rtl" className="break-words" style={{ fontSize: 11 * s, fontWeight: 700 }}>
            <span style={{ fontWeight: 800 }}>محظور: </span>{exAr.join('، ')}
          </div>
          {exEn.length > 0 && (
            <div dir="ltr" className="break-words" style={{ fontSize: 9.5 * s, fontWeight: 700 }}>
              NO: {exEn.join(' | ')}
            </div>
          )}
        </div>
      )}

      {altAr.length > 0 && (
        <div className="text-center leading-tight" style={{ color: ALT_COLOR, marginTop: 2 * s }}>
          <div dir="rtl" className="break-words" style={{ fontSize: 11 * s, fontWeight: 700 }}>
            <span style={{ fontWeight: 800 }}>بديل: </span>{altAr.join('، ')}
          </div>
          {altEn.length > 0 && (
            <div dir="ltr" className="break-words" style={{ fontSize: 9.5 * s, fontWeight: 700 }}>
              YES: {altEn.join(' | ')}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── ستيكر واحد بمقاس ثابت (widthCm × heightCm) ───────────────────────────────
export default function StickerCard({ ben, headerUrl, widthCm, heightCm, bgColor, custom, innerRef }: {
  ben: Beneficiary; headerUrl: string | null; widthCm: number; heightCm: number;
  bgColor?: string;
  /** تخصيصات أمر التشغيل — تُعرض في آخر الستيكر. بدونها الستيكر «ثابت». */
  custom?: LdMealCustomization | null;
  innerRef?: (el: HTMLDivElement | null) => void;
}) {
  const diet = dietLines(ben.diet_type);
  const s = Math.min(widthCm, heightCm) / 10; // معامل تحجيم نسبةً لـ10سم
  const pad = 8 * s;
  const flags = STICKER_FLAGS.filter(f => ben[f.key]);
  const showCustom = hasCustomization(custom);

  return (
    <div
      ref={innerRef}
      data-ld-sticker
      className="ld-sticker border border-black flex flex-col overflow-hidden shrink-0"
      style={{ width: `${widthCm}cm`, height: `${heightCm}cm`, background: bgColor || '#ffffff' }}
    >
      {/* الهيدر */}
      <div
        className="shrink-0 border-b border-black/70 flex items-center justify-center w-full overflow-hidden"
        style={{ maxHeight: `${heightCm * 0.27}cm` }}
      >
        {headerUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={headerUrl} alt="هيدر" className="w-full h-full object-contain" />
        ) : (
          <DefaultHeader s={s} />
        )}
      </div>

      {/* الجسم */}
      <div className="flex-1 min-h-0 flex flex-col" style={{ padding: pad, gap: 6 * s }}>
        {/* النظام الغذائي (وسط، سطر واحد، عربي فوق/إنجليزي تحت) */}
        <div className="shrink-0 text-center">
          <AutoFitText text={diet.ar} maxPx={16 * s} bold underline dir="rtl" />
          {diet.en && <AutoFitText text={diet.en} maxPx={13 * s} bold underline dir="ltr" />}
        </div>

        {/* صف: Code/Villa (يسار) + رموز الخيارات المؤشّرة (يمين).
            الصفحة RTL فأول عنصر يروح يمين — نضع الرموز أولاً (يمين) وCode/Villa أخيراً (يسار). */}
        <div className="flex items-start justify-between shrink-0" style={{ gap: 6 * s, marginTop: 4 * s }}>
          {flags.length > 0 ? (
            <div dir="rtl" className="text-right leading-tight" style={{ fontSize: 10 * s }}>
              {flags.map(f => (
                <div key={f.key} className="font-semibold whitespace-nowrap">
                  <span style={{ fontSize: 13 * s }}>{f.symbol}</span> {f.label}
                </div>
              ))}
            </div>
          ) : <span />}
          <div dir="ltr" className="text-left font-bold leading-tight whitespace-nowrap shrink-0" style={{ fontSize: 12 * s }}>
            <div>Code No.:{ben.code}</div>
            {ben.villa && <div>Villa No.:{ben.villa}</div>}
          </div>
        </div>

        {/* صندوق الاسم — حدّ مزدوج. يأخذ المساحة المتبقية ويتقلّص لصالح الملاحظات الطويلة */}
        <div className="flex-1 min-h-0 overflow-hidden flex items-center">
          <div className="w-full border-2 border-black" style={{ padding: 2.5 * s }}>
            <div className="border border-black text-center" style={{ paddingInline: 6 * s, paddingBlock: 6 * s }}>
              <AutoFitText text={ben.name} maxPx={17 * s} bold dir="rtl" />
              {ben.english_name && (
                <div style={{ marginTop: 2 * s }}>
                  <AutoFitText text={ben.english_name} maxPx={11 * s} bold dir="ltr" />
                </div>
              )}
            </div>
          </div>
        </div>

        {/* فاصل سميك */}
        <div className="border-t-[3px] border-black shrink-0" />

        {/* الحساسيات */}
        <div className="flex items-center justify-between shrink-0 font-bold" style={{ fontSize: 14 * s }}>
          <span dir="ltr">Food Allergy:</span>
          <span>حساسيات وموانع:</span>
        </div>

        {/* الملاحظات */}
        <div className="text-center shrink-0">
          <span className="underline font-bold" style={{ fontSize: 13 * s }}>Notes - الملاحظات</span>
        </div>
        {ben.notes && (
          <div className="text-center text-slate-700 shrink-0 whitespace-pre-wrap break-words" style={{ fontSize: 11 * s }}>
            {ben.notes}
          </div>
        )}

        {/* تخصيصات الوجبة — آخر الستيكر */}
        {showCustom && <CustomizationBlock custom={custom!} s={s} heightCm={heightCm} />}
      </div>
    </div>
  );
}
