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
    try {
      const [bensResult, mealsResult] = await Promise.all([
        supabase
          .from('beneficiaries')
          .select(`
            id, name, english_name, code, category, villa, diet_type,
            fixed_items, notes, created_at,
            exclusions(
              id, beneficiary_id, meal_id, alternative_meal_id,
              meals:meals!exclusions_meal_id_fkey(
                id, name, type, is_snack
              )
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

      if (bensResult.data) {
        setBeneficiaries(bensResult.data);
      }

      if (mealsResult.data) {
        setMeals(mealsResult.data);
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
    if (!confirm(`هل أنت متأكد من حذف جميع المستفيدين؟`)) return;

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

  // ── Export ─────────────────────────────
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
      'الأصناف المحظورة': (b.exclusions ?? [])
        .map(e => e.meals?.name ?? '')
        .filter(Boolean)
        .join(';'),
    }));

    exportXLSX(rows, `مستفيدون_${new Date().toISOString().slice(0, 10)}.xlsx`, 'المستفيدون');
  };

  // ── Import ─────────────────────────────
  const handleImport = async (rows: Record<string, string>[]) => {
    let imported = 0;
    const errors: string[] = [];

    const mealMap: Record<string, string> = {};
    meals.forEach(m => {
      mealMap[m.name] = m.id;
    });

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];

      const name = row['الاسم']?.trim();
      const code = row['الكود']?.trim();

      if (!name || !code) {
        errors.push(`صف ${i + 2}: الاسم والكود مطلوبان`);
        continue;
      }

      const payload = {
        name,
        english_name: row['الاسم الإنجليزي']?.trim() || null,
        code,
        category: row['الفئة']?.trim() || '',
        villa: row['الفيلا']?.trim() || null,
        diet_type: row['النظام الغذائي']?.trim() || null,
        fixed_items: row['الأصناف الثابتة']?.trim() || null,
        notes: row['ملاحظات']?.trim() || null,
      };

      const { data, error } = await supabase
        .from('beneficiaries')
        .upsert(payload, { onConflict: 'code' })
        .select()
        .single();

      if (error) {
        errors.push(`صف ${i + 2}: ${error.message}`);
        continue;
      }

      const exclusionNames = row['الأصناف المحظورة']?.trim();

      if (data && exclusionNames) {
        await supabase.from('exclusions').delete().eq('beneficiary_id', data.id);

        const mealIds = exclusionNames
          .split(';')
          .map(n => n.trim())
          .filter(Boolean)
          .map(n => mealMap[n])
          .filter(Boolean);

        if (mealIds.length > 0) {
          await supabase.from('exclusions').insert(
            mealIds.map(mid => ({
              beneficiary_id: data.id,
              meal_id: mid,
            }))
          );
        }
      }

      imported++;
    }

    return { imported, errors };
  };

  const filtered = beneficiaries.filter(b => {
    if (!search.trim()) return true;

    const q = search.toLowerCase();

    const exclusions = (b.exclusions ?? [])
      .map(e => e.meals?.name ?? '')
      .join(' ');

    const fixedMeals = (b.fixed_meals ?? [])
      .map(fm => (fm as any).meals?.name ?? '')
      .join(' ');

    return (
      b.name?.toLowerCase().includes(q) ||
      b.code?.toLowerCase().includes(q) ||
      (b.category ?? '').toLowerCase().includes(q) ||
      (b.villa ?? '').toLowerCase().includes(q) ||
      (b.english_name ?? '').toLowerCase().includes(q) ||
      exclusions.includes(q) ||
      fixedMeals.includes(q)
    );
  });

  return (
    <div className="p-6 space-y-4">
      <h1 className="text-2xl font-bold">المستفيدون</h1>

      {loading ? (
        <p>Loading...</p>
      ) : (
        <p>عدد المستفيدين: {beneficiaries.length}</p>
      )}

      {/* باقي الواجهة كما هي عندك بدون تغيير */}
    </div>
  );
}