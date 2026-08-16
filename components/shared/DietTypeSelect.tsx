'use client';

/**
 * اختيار النظام الغذائي من قائمة منسدلة بدل الكتابة الحرة.
 *
 * القائمة تُبنى من الأنظمة المسجَّلة فعلاً في قاعدة البيانات، بعد جمع
 * الإملاءات المتكافئة في اسم واحد — فلا تظهر «حمية» و«حميه» كخيارين.
 *
 * وعند إضافة نظام جديد يُطابَق أولاً على الموجود: لو كتبت ما يكافئ نظاماً
 * مسجَّلاً، يُختار المسجَّل بدل إنشاء نسخة ثانية منه.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase-client';
import { canonicalDietList, matchDiet, normalizeDietKey } from '@/lib/diet-types';

const NEW_OPTION = '__new__';

interface Props {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  /** يُستخدم في نموذج المرافقين كما هو في المستفيدين — نفس الجدول. */
  id?: string;
}

export default function DietTypeSelect({ value, onChange, disabled, id }: Props) {
  const [known, setKnown] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState('');
  const [note, setNote] = useState('');
  const draftRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await supabase.from('beneficiaries').select('diet_type');
      if (cancelled) return;
      const rows = (data as { diet_type: string | null }[] | null) ?? [];
      setKnown(canonicalDietList(rows.map((r) => r.diet_type)));
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (adding) draftRef.current?.focus();
  }, [adding]);

  const current = value.trim();

  /**
   * القيمة المحفوظة تُعرض كما هي بالضبط — حتى لو كان إملاؤها قديماً — حتى
   * ما نوهم المستخدم أنها شيء آخر. والاسم الموحّد يظهر بجانبها في القائمة
   * ليقدر ينقل إليه بنفسه.
   */
  const options = useMemo(() => {
    const exact = known.some((k) => k === current);
    return current && !exact ? [current, ...known] : known;
  }, [known, current]);

  const equivalent = useMemo(
    () => (current ? known.find((k) => k !== current && normalizeDietKey(k) === normalizeDietKey(current)) : undefined),
    [known, current],
  );

  const commitDraft = () => {
    const matched = matchDiet(draft, known);
    if (!matched) {
      setAdding(false);
      setDraft('');
      return;
    }
    // لو كان مكافئاً لنظام مسجَّل، نوضّح أننا استخدمنا المسجَّل بدل نسخة جديدة
    setNote(
      normalizeDietKey(matched) === normalizeDietKey(draft) && matched !== draft.trim()
        ? `استُخدم النظام المسجَّل «${matched}» بدل إنشاء نسخة جديدة منه.`
        : '',
    );
    if (!known.includes(matched)) setKnown((prev) => canonicalDietList([...prev, matched]));
    onChange(matched);
    setAdding(false);
    setDraft('');
  };

  if (adding) {
    return (
      <div className="space-y-1.5">
        <div className="flex gap-2">
          <input
            ref={draftRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                commitDraft();
              }
              if (e.key === 'Escape') {
                e.preventDefault();
                setAdding(false);
                setDraft('');
              }
            }}
            className="input-field"
            placeholder="اسم النظام الغذائي الجديد"
          />
          <button
            type="button"
            onClick={commitDraft}
            disabled={!draft.trim()}
            className="px-4 rounded-lg bg-emerald-600 text-white text-sm font-semibold disabled:opacity-40 hover:bg-emerald-700 transition-colors whitespace-nowrap"
          >
            إضافة
          </button>
          <button
            type="button"
            onClick={() => {
              setAdding(false);
              setDraft('');
            }}
            className="px-3 rounded-lg border border-slate-200 text-slate-600 text-sm hover:bg-slate-50 transition-colors"
          >
            إلغاء
          </button>
        </div>
        <p className="text-[11px] text-slate-400">
          لو كان النظام مسجّلاً بإملاء مختلف، سيُستخدم المسجَّل تلقائياً.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-1.5">
      <select
        id={id}
        value={current}
        disabled={disabled || loading}
        onChange={(e) => {
          const v = e.target.value;
          setNote('');
          if (v === NEW_OPTION) {
            setAdding(true);
            return;
          }
          onChange(v);
        }}
        className="input-field"
      >
        <option value="">{loading ? 'جارٍ التحميل…' : '— بدون نظام غذائي —'}</option>
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
        <option value={NEW_OPTION}>+ نظام غذائي جديد…</option>
      </select>

      {equivalent && (
        <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-1.5 leading-relaxed">
          هذا النظام مسجّل أيضاً باسم «{equivalent}».{' '}
          <button
            type="button"
            onClick={() => onChange(equivalent)}
            className="font-semibold underline hover:text-amber-900"
          >
            وحّده على «{equivalent}»
          </button>
        </p>
      )}

      {note && <p className="text-[11px] text-emerald-700">{note}</p>}
    </div>
  );
}
