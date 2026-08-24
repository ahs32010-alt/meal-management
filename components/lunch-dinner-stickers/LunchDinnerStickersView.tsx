'use client';

/**
 * صفحة ستيكرات الغداء والعشاء — تبويبان:
 *   • «ثابتة»      → ستيكر لكل مستفيد بلا ارتباط بأمر تشغيل (السلوك القديم)
 *   • «حسب الوجبة» → ستيكرات أمر تشغيل معيّن، وفي آخر كل ستيكر محظور/بديل ذلك اليوم
 *
 * إعدادات الهيدر وألوان الأنظمة الغذائية تُحمَّل هنا مرّة واحدة وتُمرَّر للتبويبين
 * حتى يبقى الستيكر واحداً في الشكل مهما تنقّلت بينهما.
 */

import { useState } from 'react';
import LdFixedTab from './LdFixedTab';
import LdByMealTab from './LdByMealTab';
import { useLdStickerSettings } from './ld-settings';

type Tab = 'fixed' | 'byMeal';

const TABS: { key: Tab; label: string; hint: string }[] = [
  { key: 'fixed',  label: 'ثابتة',      hint: 'ستيكر لكل مستفيد' },
  { key: 'byMeal', label: 'حسب الوجبة', hint: 'حسب أمر التشغيل' },
];

export default function LunchDinnerStickersView() {
  const [tab, setTab] = useState<Tab>('fixed');
  // التبويب يُركَّب عند أول زيارة ثم يبقى مركّباً — فما يجيب بياناته إلا لمن فتحه،
  // وبعدها التنقّل بين التبويبين ما يعيد أي تحميل.
  const [visited, setVisited] = useState<Set<Tab>>(() => new Set<Tab>(['fixed']));
  const settings = useLdStickerSettings();

  const openTab = (next: Tab) => {
    setTab(next);
    setVisited(prev => (prev.has(next) ? prev : new Set(prev).add(next)));
  };

  return (
    <div className="p-4 md:p-6">
      <div className="no-print mb-5">
        <h1 className="text-2xl font-bold text-slate-800">ستيكرات الغداء والعشاء</h1>

        {/* التبويبات */}
        <div className="mt-3 inline-flex items-center gap-1 p-1 bg-slate-100 rounded-xl">
          {TABS.map(t => {
            const active = tab === t.key;
            return (
              <button
                key={t.key}
                type="button"
                onClick={() => openTab(t.key)}
                className={`px-4 py-2 rounded-lg text-sm font-bold transition-colors ${
                  active ? 'bg-white text-emerald-700 shadow-sm' : 'text-slate-500 hover:text-slate-700'
                }`}
              >
                {t.label}
                <span className="block text-[10px] font-medium text-slate-400">{t.hint}</span>
              </button>
            );
          })}
        </div>
      </div>

      {visited.has('fixed') && (
        <div hidden={tab !== 'fixed'}>
          <LdFixedTab settings={settings} />
        </div>
      )}
      {visited.has('byMeal') && (
        <div hidden={tab !== 'byMeal'}>
          <LdByMealTab settings={settings} />
        </div>
      )}
    </div>
  );
}
