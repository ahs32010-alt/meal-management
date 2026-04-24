'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { createClient } from '@/lib/supabase-client';
import type { Beneficiary, Meal } from '@/lib/types';
import { DAY_LABELS, DAYS_ORDER } from '@/lib/types';
import BeneficiaryModal from './BeneficiaryModal';
import ImportModal from '@/components/shared/ImportModal';
import { exportXLSX } from '@/lib/xlsx-utils';

export default function BeneficiaryList() {
  const [beneficiaries, setBeneficiaries] = useState<Beneficiary[]>([]);
  const [meals, setMeals] = useState<Meal[]>([]);
  const [loading, setLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [editingBeneficiary, setEditingBeneficiary] = useState<Beneficiary | null>(null);
  const [search, setSearch] = useState('');
  const [deleting, setDeleting] = useState<string | null>(null);
  const [deletingAll, setDeletingAll] = useState(false);

  const supabase = useMemo(() => createClient(), []);

  const fetchData = useCallback(async () => {
    setLoading(true);

    try {
      const [bensResult, mealsResult] = await Promise.all([
        supabase
          .from('beneficiaries')
          .select(`
            id, name, english_name, code, category, villa, diet_type,
            fixed_items, notes, created_at,
            exclusions(
              id, beneficiary_id, meal_id, alternative_meal_id,
              meals:meals!exclusions_meal_id_fkey(id, name, type, is_snack),
              alternative_meal:meals!exclusions_alternative_meal_id_fkey(id, name)
            ),
            fixed_meals:beneficiary_fixed_meals(
              id, beneficiary_id, day_of_week, meal_type, meal_id,
              meals(id, name, type, is_snack)
            )
          `)
          .order('name'),

        supabase
          .from('meals')
          .select('id, name, english_name, type, is_snack, created_at')
          .order('type')
          .order('is_snack')
          .order('name'),
      ]);

      // ✅ FIX 1: لازم نحفظ المستفيدين فعلياً
      if (bensResult.data) {
        setBeneficiaries((bensResult.data ?? []) as unknown as Beneficiary[]);
      }

      if (mealsResult.data) {
        setMeals(mealsResult.data as Meal[]);
      }

    } catch (err) {
      console.error('Fetch error:', err);
    } finally {
      setLoading(false);
    }
  }, [supabase]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleDelete = async (id: string) => {
    if (!confirm('هل أنت متأكد من حذف هذا المستفيد؟')) return;

    setDeleting(id);
    await supabase.from('beneficiaries').delete().eq('id', id);
    await fetchData();
    setDeleting(null);
  };

  const handleDeleteAll = async () => {
    if (beneficiaries.length === 0) return;

    if (!confirm(`هل أنت متأكد من حذف جميع المستفيدين (${beneficiaries.length})؟`)) return;

    setDeletingAll(true);

    const ids = beneficiaries.map(b => b.id);
    await supabase.from('beneficiaries').delete().in('id', ids);

    await fetchData();
    setDeletingAll(false);
  };

  const handleEdit = (b: Beneficiary) => {
    setEditingBeneficiary(b);
    setIsModalOpen(true);
  };

  const handleAdd = () => {
    setEditingBeneficiary(null);
    setIsModalOpen(true);
  };

  const handleSaved = () => {
    setIsModalOpen(false);
    fetchData();
  };

  const handleExport = () => {
    const DAY_SHORT: Record<number, string> = {
      0: 'احد', 1: 'اثنين', 2: 'ثلاثاء', 3: 'اربعاء', 4: 'خميس', 5: 'جمعة', 6: 'سبت',
    };

    const rows = beneficiaries.map(b => {
      // الأصناف المحظورة وبدائلها: فول؛كبدة - شكشوكة؛تونة
      const excl = b.exclusions ?? [];
      const exclusionStr = excl
        .map(e => {
          const mealName = e.meals?.name ?? '';
          const altName = (e as any).alternative_meal?.name ?? '';
          return altName ? `${mealName}؛${altName}` : mealName;
        })
        .filter(Boolean)
        .join(' - ');

      // الأصناف الثابتة: فول؛سبت احد اربعاء - صنف2؛يوم1
      const fixedMeals = b.fixed_meals ?? [];
      const mealDaysMap = new Map<string, number[]>();
      for (const fm of fixedMeals) {
        const mealName = (fm as any).meals?.name ?? '';
        if (!mealName) continue;
        if (!mealDaysMap.has(mealName)) mealDaysMap.set(mealName, []);
        mealDaysMap.get(mealName)!.push(fm.day_of_week);
      }
      const fixedStr = Array.from(mealDaysMap.entries())
        .map(([meal, days]) => `${meal}؛${days.map(d => DAY_SHORT[d]).join(' ')}`)
        .join(' - ');

      return {
        'الاسم': b.name,
        'الاسم الإنجليزي': b.english_name ?? '',
        'الكود': b.code,
        'الفئة': b.category ?? '',
        'الفيلا': b.villa ?? '',
        'النظام الغذائي': b.diet_type ?? '',
        'الأصناف الثابتة': fixedStr,
        'ملاحظات': b.notes ?? '',
        'الأصناف المحظورة وبدائلها': exclusionStr,
      };
    });
    exportXLSX(rows, `مستفيدون_${new Date().toISOString().slice(0, 10)}.xlsx`, 'المستفيدون');
  };

  const filtered = beneficiaries.filter(b => {
    if (!search.trim()) return true;

    const q = search.toLowerCase();

    const exclusionNames = (b.exclusions ?? [])
      .map(e => e.meals?.name ?? '')
      .join(' ');

    const fixedMealNames = (b.fixed_meals ?? [])
      .map(fm => (fm as any)?.meals?.name ?? '')
      .join(' ');

    return (
      b.name?.toLowerCase().includes(q) ||
      b.code?.toLowerCase().includes(q) ||
      (b.category ?? '').toLowerCase().includes(q) ||
      (b.villa ?? '').toLowerCase().includes(q) ||
      (b.english_name ?? '').toLowerCase().includes(q) ||
      exclusionNames.includes(q) ||
      fixedMealNames.includes(q)
    );
  });

  return (
    <div className="p-6 space-y-4">

      {/* Header */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h1 className="text-2xl font-bold text-slate-800">المستفيدون</h1>
        <div className="flex items-center gap-2 flex-wrap">
          <button onClick={() => setImportOpen(true)} className="btn-secondary text-sm">استيراد Excel</button>
          <button onClick={handleExport} disabled={beneficiaries.length === 0} className="btn-secondary text-sm">تصدير Excel</button>
          <button
            onClick={handleDeleteAll}
            disabled={deletingAll || beneficiaries.length === 0}
            className="btn-secondary text-sm text-red-600 hover:bg-red-50 border-red-200"
          >
            {deletingAll ? 'جاري الحذف...' : 'حذف الكل'}
          </button>
          <button onClick={handleAdd} className="btn-primary text-sm">+ إضافة مستفيد</button>
        </div>
      </div>

      {/* Search + count */}
      <div className="flex items-center gap-3">
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="ابحث بالاسم أو الكود أو الفيلا..."
          className="input-field max-w-sm"
        />
        <span className="text-sm text-slate-500">{filtered.length} مستفيد</span>
      </div>

      {/* Table */}
      {loading ? (
        <div className="flex justify-center py-12">
          <div className="animate-spin w-8 h-8 border-2 border-emerald-500 border-t-transparent rounded-full" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="py-16 text-center text-slate-400">
          <p className="font-medium">{search ? 'لا توجد نتائج' : 'لا يوجد مستفيدون بعد'}</p>
        </div>
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="bg-slate-50 text-right">
                <th className="table-header">#</th>
                <th className="table-header">الاسم</th>
                <th className="table-header">الكود</th>
                <th className="table-header">الفئة</th>
                <th className="table-header">الفيلا</th>
                <th className="table-header">النظام الغذائي</th>
                <th className="table-header">الأصناف الثابتة</th>
                <th className="table-header">الأصناف المحظورة</th>
                <th className="table-header">ملاحظات</th>
                <th className="table-header text-center">الإجراءات</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((b, idx) => (
                <tr key={b.id} className="hover:bg-slate-50 transition-colors border-t border-slate-100">
                  <td className="table-cell text-slate-400 text-xs">{idx + 1}</td>
                  <td className="table-cell">
                    <div className="font-semibold text-slate-800">{b.name}</div>
                    {b.english_name && <div className="text-xs text-slate-400">{b.english_name}</div>}
                  </td>
                  <td className="table-cell">
                    <span className="font-mono text-sm bg-slate-100 px-2 py-0.5 rounded">{b.code}</span>
                  </td>
                  <td className="table-cell text-slate-600">{b.category ?? '—'}</td>
                  <td className="table-cell text-slate-600">{b.villa ?? '—'}</td>
                  <td className="table-cell text-slate-600">{b.diet_type ?? '—'}</td>
                  <td className="table-cell">
                    {(b.fixed_meals ?? []).length === 0 ? (
                      <span className="text-slate-300 text-xs">لا يوجد</span>
                    ) : (
                      <div className="flex flex-wrap gap-1.5">
                        {(() => {
                          // Group by meal_id, collect days sorted by DAYS_ORDER
                          const map = new Map<string, { name: string; days: number[] }>();
                          for (const fm of b.fixed_meals ?? []) {
                            const name = (fm as any).meals?.name ?? fm.meal_id;
                            if (!map.has(fm.meal_id)) map.set(fm.meal_id, { name, days: [] });
                            map.get(fm.meal_id)!.days.push(fm.day_of_week);
                          }
                          return Array.from(map.values()).map(({ name, days }) => {
                            const sortedDays = DAYS_ORDER.filter(d => days.includes(d));
                            const dayLabels = sortedDays.map(d => DAY_LABELS[d]);
                            return (
                              <span key={name} className="inline-flex items-center gap-1 text-xs bg-emerald-50 text-emerald-700 border border-emerald-100 px-2 py-0.5 rounded-full">
                                <span className="font-semibold">{name}</span>
                                <span className="text-emerald-400">·</span>
                                <span className="text-emerald-600">{dayLabels.join('، ')}</span>
                              </span>
                            );
                          });
                        })()}
                      </div>
                    )}
                  </td>
                  <td className="table-cell">
                    {(b.exclusions ?? []).length === 0 ? (
                      <span className="text-slate-300 text-xs">لا يوجد</span>
                    ) : (
                      <div className="flex flex-wrap gap-1">
                        {(b.exclusions ?? []).map(e => (
                          <span key={e.id} className="text-xs bg-red-50 text-red-700 border border-red-100 px-1.5 py-0.5 rounded">
                            {e.meals?.name}
                          </span>
                        ))}
                      </div>
                    )}
                  </td>
                  <td className="table-cell text-slate-500 text-sm">{b.notes ?? '—'}</td>
                  <td className="table-cell">
                    <div className="flex items-center justify-center gap-2">
                      <button
                        onClick={() => handleEdit(b)}
                        className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                        title="تعديل"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                        </svg>
                      </button>
                      <button
                        onClick={() => handleDelete(b.id)}
                        disabled={deleting === b.id}
                        className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors disabled:opacity-40"
                        title="حذف"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {isModalOpen && (
        <BeneficiaryModal
          beneficiary={editingBeneficiary}
          meals={meals}
          onClose={() => setIsModalOpen(false)}
          onSaved={handleSaved}
        />
      )}

      {importOpen && (
        <ImportModal
          title="المستفيدون"
          templateHeaders={['الاسم', 'الاسم الإنجليزي', 'الكود', 'الفئة', 'الفيلا', 'النظام الغذائي', 'الأصناف الثابتة', 'ملاحظات', 'الأصناف المحظورة وبدائلها']}
          templateRow={['محمد أحمد', 'Mohammad Ahmad', 'B001', 'عائلة', '5', '', 'فول؛سبت احد اربعاء', '', 'فول؛كبدة - شكشوكة؛تونة']}
          onClose={() => setImportOpen(false)}
          onDone={() => { setImportOpen(false); fetchData(); }}
          onImport={async (rows) => {
            let imported = 0;
            const errors: string[] = [];

            // Load all meals for name→{id,type} lookup
            const { data: mealsData } = await supabase.from('meals').select('id, name, type');
            const mealByName = new Map<string, { id: string; type: string }>(
              (mealsData ?? []).map(m => [m.name, { id: m.id, type: m.type }])
            );

            const DAY_MAP: Record<string, number> = {
              'سبت': 6, 'السبت': 6,
              'احد': 0, 'أحد': 0, 'الأحد': 0,
              'اثنين': 1, 'الاثنين': 1,
              'ثلاثاء': 2, 'الثلاثاء': 2,
              'اربعاء': 3, 'أربعاء': 3, 'الأربعاء': 3,
              'خميس': 4, 'الخميس': 4,
              'جمعة': 5, 'الجمعة': 5,
            };

            // مسح كل المستفيدين الحاليين (استبدال كامل)
            const { data: allBens } = await supabase.from('beneficiaries').select('id');
            const allIds = (allBens ?? []).map((b: { id: string }) => b.id);
            if (allIds.length > 0) {
              await supabase.from('beneficiaries').delete().in('id', allIds);
            }

            for (let i = 0; i < rows.length; i++) {
              const row = rows[i];
              const name = row['الاسم']?.trim();
              const code = row['الكود']?.trim();
              if (!name || !code) {
                errors.push(`صف ${i + 2}: الاسم والكود مطلوبان`);
                continue;
              }

              const { data: benData, error: benError } = await supabase
                .from('beneficiaries')
                .insert({
                  name,
                  english_name: row['الاسم الإنجليزي']?.trim() || null,
                  code,
                  category: row['الفئة']?.trim() || null,
                  villa: row['الفيلا']?.trim() || null,
                  diet_type: row['النظام الغذائي']?.trim() || null,
                  fixed_items: null,
                  notes: row['ملاحظات']?.trim() || null,
                })
                .select('id')
                .single();

              if (benError || !benData) {
                errors.push(`صف ${i + 2} (${name}): ${benError?.message ?? 'خطأ غير معروف'}`);
                continue;
              }

              const benId = benData.id;

              // الأصناف المحظورة وبدائلها: فول؛كبدة - شكشوكة؛تونة
              const exclusionRaw = (row['الأصناف المحظورة وبدائلها'] ?? '').trim();
              if (exclusionRaw) {
                const pairs = exclusionRaw.split('-').map(s => s.trim()).filter(Boolean);
                for (const pair of pairs) {
                  const parts = pair.split('؛').map(s => s.trim());
                  const mealName = parts[0];
                  const altName = parts[1] ?? '';
                  const meal = mealByName.get(mealName);
                  if (!meal) {
                    errors.push(`صف ${i + 2}: الصنف "${mealName}" غير موجود في قاعدة البيانات`);
                    continue;
                  }
                  const altMeal = altName ? (mealByName.get(altName) ?? null) : null;
                  if (altName && !altMeal) {
                    errors.push(`صف ${i + 2}: البديل "${altName}" غير موجود في قاعدة البيانات`);
                  }
                  await supabase.from('exclusions').insert({
                    beneficiary_id: benId,
                    meal_id: meal.id,
                    alternative_meal_id: altMeal?.id ?? null,
                  });
                }
              }

              // الأصناف الثابتة: فول؛سبت احد اربعاء - صنف2؛يوم1
              const fixedRaw = (row['الأصناف الثابتة'] ?? '').trim();
              if (fixedRaw) {
                const parts = fixedRaw.split('-').map(s => s.trim()).filter(Boolean);
                for (const part of parts) {
                  const [mealName, daysStr] = part.split('؛').map(s => s.trim());
                  if (!mealName || !daysStr) continue;
                  const meal = mealByName.get(mealName);
                  if (!meal) {
                    errors.push(`صف ${i + 2}: الصنف الثابت "${mealName}" غير موجود في قاعدة البيانات`);
                    continue;
                  }
                  const days = daysStr.split(/\s+/).filter(Boolean);
                  for (const dayStr of days) {
                    const dayNum = DAY_MAP[dayStr];
                    if (dayNum === undefined) {
                      errors.push(`صف ${i + 2}: اليوم "${dayStr}" غير معروف`);
                      continue;
                    }
                    await supabase.from('beneficiary_fixed_meals').insert({
                      beneficiary_id: benId,
                      day_of_week: dayNum,
                      meal_type: meal.type,
                      meal_id: meal.id,
                    });
                  }
                }
              }

              imported++;
            }

            await fetchData();
            return { imported, errors };
          }}
        />
      )}

    </div>
  );
}