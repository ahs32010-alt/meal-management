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
              meals:meals!exclusions_meal_id_fkey(id, name, type, is_snack)
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

      <h1 className="text-2xl font-bold">المستفيدون</h1>

      {loading ? (
        <p>جاري التحميل...</p>
      ) : (
        <p>{filtered.length} مستفيد</p>
      )}

    </div>
  );
}