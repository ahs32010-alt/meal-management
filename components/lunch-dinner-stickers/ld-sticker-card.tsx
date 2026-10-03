'use client';

/**
 * ستيكر الغداء/العشاء — نموذج واحد يخدم التبويبين:
 *   • «ثابتة»      → بدون `custom` (الستيكر الأساسي للمستفيد)
 *   • «حسب الوجبة» → مع `custom` فيُضاف في آخر الستيكر محظور/بديل هذا الأمر
 *
 * أي تعديل على شكل الستيكر يصير هنا مرّة واحدة فينعكس على التبويبين معاً.
 */

import { useLayoutEffect, useRef, useState } from 'react';
import type { Beneficiary } from '@/lib/types';
import { STICKER_FLAGS } from '@/lib/sticker-flags';
import { hasCustomization, LD_CATEGORY, type LdMealCustomization } from './ld-types';

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
    let alive = true;
    void document.fonts?.ready.then(() => { if (alive) fit(); });
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => { alive = false; ro.disconnect(); };
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

/**
 * أحجام الخطوط القابلة للمعايرة (بالبكسل لستيكر 10×10، وتتناسب مع أي مقاس) —
 * مصدر واحد للصفحة والـPDF، وملف Word يشتقّ أحجامه منها بنسبتها للافتراضي.
 */
export const LD_FONT_SIZES = {
  // معتمدة من صفحة معايرة الخطوط (2026-09-29)
  name_ar: 20.5,
  name_en: 17,
  code: 13.5,
  villa: 15,
  diet_ar: 17.5,
  diet_en: 16,
} as const;

// ── Code/Villa في زاوية الهيدر اليسرى (مقابل شعار خطوة أمل يميناً) ──────────────
export function CodeVilla({ ben, s }: { ben: Beneficiary; s: number }) {
  return (
    <div dir="ltr" className="text-left font-bold leading-tight whitespace-nowrap shrink-0">
      <div style={{ fontSize: LD_FONT_SIZES.code * s }}>Code No.: {ben.code}</div>
      {ben.villa && <div style={{ fontSize: LD_FONT_SIZES.villa * s }}>Villa No.: {ben.villa}</div>}
    </div>
  );
}

// ── الهيدر الافتراضي (لو ما رُفعت صورة هيدر مخصّصة) ──────────────────────────
// ثلاثة أعمدة بلا تداخل: الشعار يميناً، «خدمات الطعام» وسطاً، Code/Villa يساراً.
export function DefaultHeader({ s, ben }: { s: number; ben: Beneficiary }) {
  return (
    <div className="flex items-center w-full" style={{ paddingBlock: 4 * s, paddingInline: 5 * s, gap: 5 * s }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/logo-hope.png" alt="خطوة أمل" className="object-contain shrink-0" style={{ height: 40 * s, width: 'auto' }} />
      <div className="text-center leading-tight flex-1 min-w-0">
        <AutoFitText text="خدمات الطعام" maxPx={18 * s} bold dir="rtl" color="#047857" />
        <AutoFitText text="Food Services" maxPx={13 * s} bold dir="ltr" color="#047857" />
      </div>
      <CodeVilla ben={ben} s={s} />
    </div>
  );
}

// ── صندوق الاسم — أولوية الستيكر ─────────────────────────────────────────────
/**
 * كل سطر (عربي/إنجليزي) بحجمه في LD_FONT_SIZES، ويصغر فقط لو ما دخل عرضاً في
 * سطر واحد. والصندوق يحجز ارتفاعه كاملاً، فلو ضاق الستيكر تصغر النصوص الثانوية
 * أولاً (انظر StickerCard) ولا يصغر الاسم إلا بعدها عبر `grow`.
 */
function NameBox({ name, english, s, grow }: {
  name: string; english?: string | null; s: number;
  /** معامل خط الاسم — أكبر من s في الستيكر العريض، ويصغر آخراً عند الضيق */
  grow: number;
}) {
  const areaRef = useRef<HTMLDivElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const arRef = useRef<HTMLDivElement>(null);
  const enRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const area = areaRef.current, box = boxRef.current, ar = arRef.current, en = enRef.current;
    if (!area || !box || !ar) return;
    const MIN = 5;
    const fitWidth = (el: HTMLDivElement, max: number) => {
      let size = max;
      el.style.fontSize = `${size}px`;
      let guard = 300;
      while (size > MIN && el.scrollWidth > el.clientWidth && guard-- > 0) {
        size -= 0.5;
        el.style.fontSize = `${size}px`;
      }
    };
    const fit = () => {
      fitWidth(ar, LD_FONT_SIZES.name_ar * grow);
      if (en) fitWidth(en, LD_FONT_SIZES.name_en * grow);
      // يحجز ارتفاع الاسم كاملاً — الضيق يُحلّ بتصغير الثانوية لا بقصّ الاسم
      area.style.minHeight = `${box.offsetHeight}px`;
    };
    fit();
    // القياس قبل تحميل خط ثمانية يعطي عرضاً أضيق فيُقصّ الاسم — نعيده بعد تحميله
    let alive = true;
    void document.fonts?.ready.then(() => { if (alive) fit(); });
    const ro = new ResizeObserver(fit);
    ro.observe(box);
    ro.observe(area);
    return () => { alive = false; ro.disconnect(); };
  }, [name, english, s, grow]);

  const line = { whiteSpace: 'nowrap', overflow: 'hidden', width: '100%', fontWeight: 700, lineHeight: 1.2 } as const;
  return (
    <div ref={areaRef} className="flex-1 overflow-hidden flex items-center">
      <div ref={boxRef} className="w-full border-2 border-black" style={{ padding: 2.5 * s }}>
        <div className="border border-black text-center" style={{ paddingInline: 6 * s, paddingBlock: 5 * s }}>
          <div ref={arRef} dir="rtl" style={line}>{name}</div>
          {english && <div ref={enRef} dir="ltr" style={{ ...line, marginTop: 2 * s }}>{english}</div>}
        </div>
      </div>
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
  const cat = custom.category ? LD_CATEGORY[custom.category] : null;

  return (
    // سقف الارتفاع يحمي القالب: التخصيصات الطويلة تُقصّ ولا تدفع الستيكر خارج مقاسه
    <div className="shrink-0 overflow-hidden" style={{ maxHeight: `${heightCm * 0.36}cm`, marginTop: 2 * s }}>
      <div className="border-t-[3px] border-black" style={{ marginBottom: 3 * s }} />
      {/* سطر واحد: الوجبة + تصنيف هذا الكيس (حار/بارد/سناك) بلونه — فيعرف
          المطبخ أي ستيكر يروح مع أي كيس حين ينفصل المستفيد على أكثر من ستيكر */}
      <div className="text-center leading-tight" style={{ fontSize: 10 * s, marginBottom: 2 * s }}>
        <span className="font-bold underline">تخصيصات {custom.mealAr} {custom.mealEn}</span>
        {cat && (
          <span className="font-extrabold" style={{ color: cat.hex }}> · {cat.ar} {cat.en}</span>
        )}
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
  const base = Math.min(widthCm, heightCm) / 10; // معامل تحجيم نسبةً لـ10سم

  /**
   * لا يُقصّ شيء، والاسم آخر ما يصغر. لو الجسم فاض (ملاحظات/تخصيصات طويلة على
   * مقاس صغير): تصغر النصوص الثانوية (k) حتى 60%، ثم الاسم (nk) حتى 40%، ثم
   * الثانوية حتى 40%. الهيدر وCode/Villa والنظام الغذائي بحجمها دائماً.
   */
  const [k, setK] = useState(1);
  const [nk, setNk] = useState(1);
  const bodyRef = useRef<HTMLDivElement>(null);
  const fitKey = `${widthCm}|${heightCm}|${ben.id}|${ben.name}|${ben.english_name ?? ''}|${ben.notes ?? ''}|${JSON.stringify(custom ?? null)}`;
  const [lastKey, setLastKey] = useState(fitKey);
  if (lastKey !== fitKey) { setLastKey(fitKey); setK(1); setNk(1); }
  useLayoutEffect(() => {
    const body = bodyRef.current;
    if (!body || body.scrollHeight <= body.clientHeight + 1) return;
    const step = (v: number) => Math.round((v - 0.05) * 100) / 100;
    if (k > 0.6) setK(step);
    else if (nk > 0.4) setNk(step);
    else if (k > 0.4) setK(step);
  }, [k, nk, fitKey]);
  const s = base;       // الأساسية: الهيدر وCode/Villa والنظام الغذائي
  const s2 = base * k;  // الثانوية: الخيارات والحساسيات والملاحظات والتخصيصات
  const pad = 8 * s2;
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
          // الهيدر المرفوع يميناً وCode/Villa يساراً — صف واحد بلا تداخل
          <div className="flex items-center w-full h-full" style={{ paddingInline: 5 * s, gap: 5 * s }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={headerUrl} alt="هيدر" className="flex-1 min-w-0 h-full object-contain" style={{ maxHeight: `${heightCm * 0.27}cm` }} />
            <CodeVilla ben={ben} s={s} />
          </div>
        ) : (
          <DefaultHeader s={s} ben={ben} />
        )}
      </div>

      {/* الجسم */}
      <div ref={bodyRef} className="flex-1 min-h-0 flex flex-col overflow-hidden" style={{ padding: pad, gap: 6 * s2 }}>
        {/* النظام الغذائي (وسط، سطر واحد، عربي فوق/إنجليزي تحت) */}
        <div className="shrink-0 text-center">
          <AutoFitText text={diet.ar} maxPx={LD_FONT_SIZES.diet_ar * s} bold underline dir="rtl" />
          {diet.en && <AutoFitText text={diet.en} maxPx={LD_FONT_SIZES.diet_en * s} bold underline dir="ltr" />}
        </div>

        {/* رموز الخيارات المؤشّرة (يمين) — Code/Villa انتقلت لزاوية الهيدر */}
        {flags.length > 0 && (
          <div dir="rtl" className="text-right leading-tight shrink-0" style={{ fontSize: 10 * s2 }}>
            {flags.map(f => (
              <div key={f.key} className="font-semibold whitespace-nowrap">
                <span style={{ fontSize: 13 * s2 }}>{f.symbol}</span> {f.label}
              </div>
            ))}
          </div>
        )}

        {/* صندوق الاسم — حدّ مزدوج، يأخذ المساحة المتبقية بأكبر خط يدخلها */}
        {/* العريض (مثل 8×5) يسمح باسم أكبر من معامل الضلع الأقصر */}
        <NameBox name={ben.name} english={ben.english_name} s={s}
          grow={(Math.min(widthCm, heightCm * 1.5) / 10) * nk} />

        {/* فاصل سميك */}
        <div className="border-t-[3px] border-black shrink-0" />

        {/* الحساسيات */}
        <div className="flex items-center justify-between shrink-0 font-bold" style={{ fontSize: 14 * s2 }}>
          <span dir="ltr">Food Allergy:</span>
          <span>حساسيات وموانع:</span>
        </div>

        {/* الملاحظات */}
        <div className="text-center shrink-0">
          <span className="underline font-bold" style={{ fontSize: 13 * s2 }}>Notes - الملاحظات</span>
        </div>
        {ben.notes && (
          <div className="text-center text-slate-700 shrink-0 whitespace-pre-wrap break-words" style={{ fontSize: 11 * s2 }}>
            {ben.notes}
          </div>
        )}

        {/* تخصيصات الوجبة — آخر الستيكر */}
        {showCustom && <CustomizationBlock custom={custom!} s={s2} heightCm={heightCm} />}
      </div>
    </div>
  );
}
