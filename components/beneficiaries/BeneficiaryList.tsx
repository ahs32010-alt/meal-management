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

  const supabase = useMemo(() => createClient(), []);

  const fetchData = useCallback(async () => {
    setLoading(true);

    try {
      const { data: bensData, error: bensError } = await supabase
        .from('beneficiaries')
        .select(`
          *,
          exclusions(
            id,
            beneficiary_id,
            meal_id,
            alternative_meal_id,
            meals(id, name, type, is_snack)
          ),
          fixed_meals:beneficiary_fixed_meals(
            id,
            beneficiary_id,
            day_of_week,
            meal_type,
            meal_id,
            meals(id, name, type, is_snack)
          )
        `)
        .order('name');

      const { data: mealsData, error: mealsError } = await supabase
        .from('meals')
        .select('*')
        .order('name');

      if (bensError) {
        console.error('Beneficiaries error:', bensError);
      }

      if (mealsError) {
        console.error('Meals error:', mealsError);
      }

      // 🔥 FIX مهم: نضمن دايم Array
      setBeneficiaries((bensData ?? []) as Beneficiary[]);
      setMeals((mealsData ?? []) as Meal[]);

      // Debug مهم لو فاضي
      console.log('BENEFICIARIES:', bensData);

    } catch (err) {
      console.error('Fetch error:', err);
    } finally {
      setLoading(false);
    }
  }, [supabase]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  return (
    <div className="p-6 space-y-4">

      <h1 className="text-2xl font-bold text-slate-800">المستفيدون</h1>

      {loading ? (
        <div className="text-slate-500">جاري التحميل...</div>
      ) : beneficiaries.length === 0 ? (
        <div className="text-red-500">
          ما فيه بيانات مستفيدين (أو RLS قافلها)
        </div>
      ) : (
        <div className="text-green-600">
          تم تحميل {beneficiaries.length} مستفيد
        </div>
      )}

    </div>
  );
}