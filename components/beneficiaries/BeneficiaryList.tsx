'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { createClient } from '@/lib/supabase-client';
import type { Beneficiary, Meal } from '@/lib/types';
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
    const [bensResult, mealsResult] = await Promise.all([
      supabase
        .from('beneficiaries')
        .select(`
          id, name, english_name, code, category, villa, diet_type,
          fixed_items, notes, created_at,
          exclusions(id, beneficiary_id, meal_id, alternative_meal_id,
            meals:meals!exclusions_meal_id_fkey(id, name, type, is_snack)),
          fixed_meals:beneficiary_fixed_meals(id, beneficiary_id, day_of_week, meal_type, meal_id,
            meals(id, name, type, is_snack))
        `)
        .order('name'),
      supabase.from('meals').select('id, name, english_name, type, is_snack, created_at')
        .order('type').order('is_snack').order('name'),
    ]);
    if (mealsResult.data) setMeals(mealsResult.data ?? []);
    setLoading(false);
  }, [supabase]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleDelete = async (id: string) => {
    if (!confirm('هل أنت متأكد من حذف هذا المستفيد؟')) return;
    setDeleting(id);
    await supabase.from('beneficiaries').delete().eq('id', id);
    await fetchData();
    setDeleting(null);
  };

  const handleDeleteAll = async () => {
    if (beneficiaries.length === 0) return;
    if (!confirm(`هل أنت متأكد من حذف جميع المستفيدين (${beneficiaries.length} مستفيد)؟ لا يمكن التراجع.`)) return;
    setDeletingAll(true);
    const ids = beneficiaries.map(b => b.id);
    await supabase.from('beneficiaries').delete().in('id', ids);
    await fetchData();
    setDeletingAll(false);
  };

  const handleEdit = (b: Beneficiary) => { setEditingBeneficiary(b); setIsModalOpen(true); };
  const handleAdd = () => { setEditingBeneficiary(null); setIsModalOpen(true); };
  const handleSaved = () => { setIsModalOpen(false); fetchData(); };

  const handleExport = () => {
    const rows = beneficiaries.map(b => ({
      'الاسم': b.name,
      'الاسم الإنجليزي': b.english_name ?? '',
      'الكود': b.code,
      'الفئة': b.category ?? '',
      'الفيلا': b.villa ?? '',
      'النظام الغذائي': b.diet_type ?? '',
      'الأصناف الثابتة': b.fixed_items ?? '',
      'ملاحظات': b.notes ?? '',
      'الأصناف المحظورة': (b.exclusions ?? []).map(e => e.meals?.name ?? '').filter(Boolean).join(';'),
    }));
    exportXLSX(rows, `مستفيدون_${new Date().toISOString().slice(0, 10)}.xlsx`, 'المستفيدون');
  };

  const handleImport = async (rows: Record<string, string>[]) => {
    let imported = 0;
    const errors: string[] = [];
    const mealNameMap: Record<string, string> = {};
    meals.forEach(m => { mealNameMap[m.name] = m.id; });

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const name = row['الاسم']?.trim();
      const code = row['الكود']?.trim();
      if (!name || !code) { errors.push(`صف ${i + 2}: الاسم والكود مطلوبان`); continue; }

      const payload = {
        name, english_name: row['الاسم الإنجليزي']?.trim() || null,
        code, category: row['الفئة']?.trim() || '',
        villa: row['الفيلا']?.trim() || null,
        diet_type: row['النظام الغذائي']?.trim() || null,
        fixed_items: row['الأصناف الثابتة']?.trim() || null,
        notes: row['ملاحظات']?.trim() || null,
      };

      const { data, error } = await supabase
        .from('beneficiaries').upsert(payload, { onConflict: 'code' }).select().single();
      if (error) { errors.push(`صف ${i + 2} (${name}): ${error.message}`); continue; }

      const exclusionNames = row['الأصناف المحظورة']?.trim();
      if (data && exclusionNames) {
        await supabase.from('exclusions').delete().eq('beneficiary_id', data.id);
        const mealIds = exclusionNames.split(';').map(n => n.trim()).filter(Boolean)
          .map(n => mealNameMap[n]).filter(Boolean);
        if (mealIds.length > 0)
          await supabase.from('exclusions').insert(mealIds.map(mid => ({ beneficiary_id: data.id, meal_id: mid })));
      }
      imported++;
    }
    return { imported, errors };
  };

  const filtered = beneficiaries.filter(b => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    const exclusionNames = (b.exclusions ?? []).map(e => e.meals?.name ?? '').join(' ');
    const fixedMealNames = (b.fixed_meals ?? [])
      .map(fm => (fm as { meals?: { name: string } }).meals?.name ?? '').join(' ');
    return (
      b.name.toLowerCase().includes(q) ||
      b.code.toLowerCase().includes(q) ||
      (b.category ?? '').toLowerCase().includes(q) ||
      (b.villa ?? '').toLowerCase().includes(q) ||
      (b.english_name ?? '').toLowerCase().includes(q) ||
      exclusionNames.includes(q) ||
      fixedMealNames.includes(q)
    );
  });

  const IMPORT_HEADERS = ['الاسم', 'الاسم الإنجليزي', 'الكود', 'الفئة', 'الفيلا', 'النظام الغذائي', 'الأصناف الثابتة', 'ملاحظات', 'الأصناف المحظورة'];
  const IMPORT_TEMPLATE_ROW = ['أحمد محمد', 'Ahmed Mohamed', 'BEN-001', 'موظف', 42, 'عادي', '', '', 'أرز;شوربة'];

  return (
    <div className="p-6 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">المستفيدون</h1>
          <p className="text-slate-500 text-sm mt-0.5">{beneficiaries.length} مستفيد مسجل</p>
        </div>
        <div className="flex items-center gap-2">
          {beneficiaries.length > 0 && (
            <button onClick={handleDeleteAll} disabled={deletingAll} className="btn-secondary text-sm text-red-600 border-red-200 hover:bg-red-50">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
              {deletingAll ? 'جاري الحذف...' : 'حذف الكل'}
            </button>
          )}
          <button onClick={() => setImportOpen(true)} className="btn-secondary text-sm">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
            </svg>
            استيراد
          </button>
          <button onClick={handleExport} disabled={beneficiaries.length === 0} className="btn-secondary text-sm">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
            تصدير
          </button>
          <button onClick={handleAdd} className="btn-primary">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            إضافة مستفيد
          </button>
        </div>
      </div>

      {/* Search */}
      <div className="relative">
        <svg className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
        <input type="text" value={search} onChange={e => setSearch(e.target.value)}
          placeholder="بحث بالاسم، الكود، الفيلا، الأصناف المحظورة، الأصناف الثابتة..." className="input-field pr-10" />
      </div>

      {/* Table */}
      <div className="card overflow-hidden">
        {loading ? (
          <div className="p-8 text-center">
            <div className="animate-spin w-8 h-8 border-2 border-emerald-500 border-t-transparent rounded-full mx-auto" />
            <p className="text-slate-400 mt-3 text-sm">جاري التحميل...</p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="py-16 text-center text-slate-400">
            <svg className="w-14 h-14 mx-auto mb-3 opacity-30" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
            <p className="font-medium">لا يوجد مستفيدون</p>
            <p className="text-sm mt-1">ابدأ بإضافة مستفيد أو استيراد ملف CSV</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="bg-slate-50">
                  <th className="table-header">#</th>
                  <th className="table-header">الاسم</th>
                  <th className="table-header">الكود</th>
                  <th className="table-header">الفيلا</th>
                  <th className="table-header">النظام الغذائي</th>
                  <th className="table-header">المحظورات</th>
                  <th className="table-header">الثابتة الأسبوعية</th>
                  <th className="table-header text-center">الإجراءات</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((b, index) => (
                  <tr key={b.id} className="hover:bg-slate-50 transition-colors">
                    <td className="table-cell text-slate-400 text-xs">{index + 1}</td>
                    <td className="table-cell">
                      <div className="font-semibold text-slate-800">{b.name}</div>
                      {b.english_name && <div className="text-xs text-slate-400 font-mono">{b.english_name}</div>}
                    </td>
                    <td className="table-cell">
                      <code className="bg-slate-100 px-2 py-0.5 rounded text-xs text-slate-600 font-mono">{b.code}</code>
                    </td>
                    <td className="table-cell text-center">
                      {b.villa ? <span className="badge bg-blue-50 text-blue-700">{b.villa}</span> : <span className="text-slate-300 text-xs">—</span>}
                    </td>
                    <td className="table-cell">
                      {b.diet_type ? <span className="badge bg-amber-50 text-amber-700 text-xs">{b.diet_type}</span> : <span className="text-slate-300 text-xs">—</span>}
                    </td>
                    <td className="table-cell">
                      {!b.exclusions || b.exclusions.length === 0 ? (
                        <span className="text-slate-300 text-xs">—</span>
                      ) : (
                        <div className="flex flex-wrap gap-1">
                          {b.exclusions.map(ex => (
                            <span key={ex.meal_id} className={`badge text-xs ${ex.meals?.is_snack ? 'bg-amber-100 text-amber-700' : 'bg-red-100 text-red-700'}`}>
                              {ex.meals?.name ?? '—'}
                            </span>
                          ))}
                        </div>
                      )}
                    </td>
                    <td className="table-cell">
                      {!b.fixed_meals || b.fixed_meals.length === 0 ? (
                        <span className="text-slate-300 text-xs">—</span>
                      ) : (() => {
                        const grouped: Record<string, { name: string; days: number[] }> = {};
                        for (const fm of b.fixed_meals) {
                          const mealName = (fm as { meals?: { name: string } }).meals?.name ?? fm.meal_id;
                          if (!grouped[mealName]) grouped[mealName] = { name: mealName, days: [] };
                          grouped[mealName].days.push(fm.day_of_week);
                        }
                        return (
                          <div className="flex flex-wrap gap-1">
                            {Object.values(grouped).map(g => (
                              <span key={g.name} className="badge bg-emerald-100 text-emerald-700 text-xs" title={`${g.days.length} يوم`}>
                                {g.name} ({g.days.length}د)
                              </span>
                            ))}
                          </div>
                        );
                      })()}
                    </td>
                    <td className="table-cell">
                      <div className="flex items-center justify-center gap-2">
                        <button onClick={() => handleEdit(b)} className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors" title="تعديل">
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                          </svg>
                        </button>
                        <button onClick={() => handleDelete(b.id)} disabled={deleting === b.id}
                          className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors disabled:opacity-40" title="حذف">
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
      </div>

      {isModalOpen && (
        <BeneficiaryModal beneficiary={editingBeneficiary} meals={meals} onClose={() => setIsModalOpen(false)} onSaved={handleSaved} />
      )}

      {importOpen && (
        <ImportModal
          title="المستفيدين"
          templateHeaders={IMPORT_HEADERS}
          templateRow={IMPORT_TEMPLATE_ROW}
          onImport={handleImport}
          onClose={() => setImportOpen(false)}
          onDone={() => { setImportOpen(false); fetchData(); }}
        />
      )}
    </div>
  );
}
