'use client';

import { useEffect, useMemo, useState } from 'react';
import type { Beneficiary } from '@/lib/types';
import { fetchStickerBeneficiaries } from '@/components/lunch-dinner-stickers/ld-fetch';
import { DietOrderPanel, useLdStickerSettings } from '@/components/lunch-dinner-stickers/ld-settings';

/**
 * إعدادات ستيكرات الغداء والعشاء (للأدمن): ترتيب الأنظمة الغذائية، وإظهار
 * قسم الترتيب في صفحة الستيكرات أو إخفاؤه حتى لا يُعدَّل من هناك.
 */
export default function StickerSettingsView() {
  const settings = useLdStickerSettings();
  const { showDietOrder, setShowDietOrder, sharedSettings } = settings;
  const [bens, setBens] = useState<Beneficiary[]>([]);

  useEffect(() => {
    void fetchStickerBeneficiaries(false).then(r => setBens(r.data));
  }, []);

  const dietTypes = useMemo(() => {
    const set = new Set<string>();
    bens.forEach(b => { const d = b.diet_type?.trim(); if (d) set.add(d); });
    return [...set].sort((a, b) => a.localeCompare(b, 'ar'));
  }, [bens]);
  const counts = useMemo(() => {
    const m = new Map<string, number>();
    bens.forEach(b => { const d = b.diet_type?.trim(); if (d) m.set(d, (m.get(d) ?? 0) + 1); });
    return m;
  }, [bens]);

  return (
    <div className="space-y-4 max-w-2xl">
      <div className="card overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-100 bg-slate-50">
          <h2 className="font-bold text-slate-800">ستيكرات الغداء والعشاء</h2>
          <p className="text-slate-500 text-xs mt-0.5">إعدادات مشتركة لكل المستخدمين.</p>
        </div>

        <div className="p-5 flex items-center justify-between gap-4 flex-wrap">
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-slate-800 text-sm">إظهار ترتيب الستيكرات حسب الأنظمة الغذائية</p>
            <p className="text-xs text-slate-500 mt-0.5">
              {showDietOrder
                ? 'قسم «ترتيب الأنظمة الغذائية» ظاهر في صفحة الستيكرات — يقدر أي مستخدم يغيّر الترتيب.'
                : 'القسم مخفي من صفحة الستيكرات — الترتيب يبقى مطبَّقاً، ويُعدَّل من هنا فقط.'}
            </p>
            {!sharedSettings && (
              <p className="text-xs text-amber-700 mt-1">
                غير متاح بعد — شغّل supabase/sticker-settings-migration.sql في Supabase.
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={() => setShowDietOrder(!showDietOrder)}
            disabled={!sharedSettings}
            role="switch"
            aria-checked={showDietOrder}
            className={`relative inline-flex h-7 w-12 flex-shrink-0 items-center rounded-full transition-colors disabled:opacity-50 ${
              showDietOrder ? 'bg-emerald-500' : 'bg-slate-300'
            }`}
          >
            <span
              className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${
                showDietOrder ? '-translate-x-1' : '-translate-x-6'
              }`}
            />
          </button>
        </div>
      </div>

      {dietTypes.length > 0 && (
        <DietOrderPanel dietTypes={dietTypes} settings={settings} counts={counts} defaultOpen />
      )}
    </div>
  );
}
