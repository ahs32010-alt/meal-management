'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase-client';
import { useCurrentUser } from '@/lib/use-current-user';
import { can } from '@/lib/permissions';
import {
  costRecipe,
  type CostUnitDef,
  type MealPrice,
  type RawMaterial,
  type RecipeCost,
  type RecipeItem,
} from '@/lib/costs';
import type { Meal } from '@/lib/types';
import CostsImportExport from './CostsImportExport';
import RawMaterialsTab from './RawMaterialsTab';
import MealCostsTab from './MealCostsTab';
import OrderCostsTab from './OrderCostsTab';

type Tab = 'materials' | 'meals' | 'orders';

const TABS: { key: Tab; label: string; hint: string }[] = [
  { key: 'materials', label: 'المواد الأولية',   hint: 'أسعار الشراء' },
  { key: 'meals',     label: 'الأصناف والأسعار', hint: 'التكلفة والربح' },
  { key: 'orders',    label: 'تكلفة أوامر التشغيل', hint: 'اليوم / الوجبة' },
];

/** رسالة الترقية الناقصة — نميّزها عن أي خطأ آخر عشان التوجيه يكون دقيقاً */
const MIGRATION_HINT =
  'جداول الأسعار والتكاليف غير مكتملة — شغّل ملفات supabase/costs-migration.sql ثم ' +
  'costs-units-migration.sql ثم costs-selling-price-migration.sql في Supabase SQL Editor.';

export default function CostsView() {
  const { user: currentUser, loading: userLoading } = useCurrentUser();
  const [tab, setTab] = useState<Tab>('orders');

  const [units, setUnits] = useState<CostUnitDef[]>([]);
  const [materials, setMaterials] = useState<RawMaterial[]>([]);
  const [recipes, setRecipes] = useState<RecipeItem[]>([]);
  const [meals, setMeals] = useState<Meal[]>([]);
  const [prices, setPrices] = useState<MealPrice[]>([]);
  // التحميل الأول فقط يفرّغ الشاشة. التحديث بعد الحفظ يصير بصمت عشان
  // ما يومض الجدول ويبان الحفظ بطيئاً وهو منتهٍ أصلاً.
  const [loading, setLoading] = useState(true);
  const loadedOnce = useRef(false);
  const [error, setError] = useState('');

  const canView   = can(currentUser, 'costs', 'view');
  const canAdd    = can(currentUser, 'costs', 'add');
  const canEdit   = can(currentUser, 'costs', 'edit');
  const canDelete = can(currentUser, 'costs', 'delete');

  const loadData = useCallback(async () => {
    if (!loadedOnce.current) setLoading(true);
    setError('');

    const [unitsRes, materialsRes, recipesRes, mealsRes, pricesRes] = await Promise.all([
      supabase.from('cost_units').select('id, name, family, factor, is_builtin').order('name'),
      supabase.from('raw_materials').select('id, name, unit_id, unit_cost, notes, is_active').order('name'),
      supabase.from('meal_recipe_items').select('id, meal_id, raw_material_id, quantity, unit_id'),
      supabase.from('meals').select('id, name, english_name, type, is_snack, category, entity_type, created_at').order('name'),
      supabase.from('meal_pricing').select('meal_id, selling_price, notes'),
    ]);

    const firstErr = unitsRes.error ?? materialsRes.error ?? recipesRes.error ?? pricesRes.error;
    if (firstErr) {
      setError(
        /does not exist|relation|schema cache/i.test(firstErr.message)
          ? MIGRATION_HINT
          : firstErr.message,
      );
      loadedOnce.current = true;
      setLoading(false);
      return;
    }
    if (mealsRes.error) {
      setError(mealsRes.error.message);
      loadedOnce.current = true;
      setLoading(false);
      return;
    }

    // numeric في Postgres يرجع نصاً عبر PostgREST — نحوّله مرة هنا فما يتسرّب
    // نص لأي حساب لاحق.
    setUnits(
      (unitsRes.data ?? []).map(u => ({ ...u, factor: Number(u.factor) || 0 })) as CostUnitDef[],
    );
    setMaterials(
      (materialsRes.data ?? []).map(m => ({ ...m, unit_cost: Number(m.unit_cost) || 0 })) as RawMaterial[],
    );
    setRecipes(
      (recipesRes.data ?? []).map(r => ({ ...r, quantity: Number(r.quantity) || 0 })) as RecipeItem[],
    );
    setMeals((mealsRes.data ?? []) as Meal[]);
    setPrices(
      (pricesRes.data ?? []).map(p => ({ ...p, selling_price: Number(p.selling_price) || 0 })) as MealPrice[],
    );
    loadedOnce.current = true;
    setLoading(false);
  }, []);

  useEffect(() => { if (canView) void loadData(); }, [canView, loadData]);

  const materialsById = useMemo(() => {
    const map: Record<string, RawMaterial> = {};
    for (const m of materials) map[m.id] = m;
    return map;
  }, [materials]);

  const unitsById = useMemo(() => {
    const map: Record<string, CostUnitDef> = {};
    for (const u of units) map[u.id] = u;
    return map;
  }, [units]);

  const recipesByMeal = useMemo(() => {
    const map: Record<string, RecipeItem[]> = {};
    for (const r of recipes) (map[r.meal_id] ??= []).push(r);
    return map;
  }, [recipes]);

  /** نفس الحساب الذي يجريه الخادم — lib/costs.ts هو المصدر الوحيد للمعادلة */
  const recipeCosts = useMemo(() => {
    const map: Record<string, RecipeCost> = {};
    for (const [mealId, items] of Object.entries(recipesByMeal)) {
      map[mealId] = costRecipe(items, materialsById, unitsById);
    }
    return map;
  }, [recipesByMeal, materialsById, unitsById]);

  const pricesByMeal = useMemo(() => {
    const map: Record<string, MealPrice> = {};
    for (const p of prices) map[p.meal_id] = p;
    return map;
  }, [prices]);

  const usageByMaterial = useMemo(() => {
    const map: Record<string, number> = {};
    for (const r of recipes) map[r.raw_material_id] = (map[r.raw_material_id] ?? 0) + 1;
    return map;
  }, [recipes]);

  // الوحدة مستخدَمة لو تشير لها مادة (وحدة شراء) أو سطر وصفة (وحدة الكمية)
  const usageByUnit = useMemo(() => {
    const map: Record<string, number> = {};
    for (const m of materials) map[m.unit_id] = (map[m.unit_id] ?? 0) + 1;
    for (const r of recipes) map[r.unit_id] = (map[r.unit_id] ?? 0) + 1;
    return map;
  }, [materials, recipes]);

  if (userLoading) {
    return <div className="p-6 text-slate-400 text-sm">جاري التحميل...</div>;
  }

  if (!canView) {
    return (
      <div className="p-6">
        <div className="card p-8 text-center">
          <div className="text-4xl mb-3">🔒</div>
          <h2 className="font-bold text-slate-800 mb-1">ما عندك صلاحية</h2>
          <p className="text-sm text-slate-500">صفحة التكاليف تحتاج صلاحية عرض من الأدمن.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 space-y-5">
      {/* الرأس */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="hidden md:block">
          <h1 className="text-2xl font-bold text-slate-800">الأسعار والتكاليف</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            تكلفة الأصناف من موادها الأولية، وأسعار بيعها وهامش الربح
          </p>
        </div>
        {!loading && (
          <div className="w-full md:w-auto">
            <CostsImportExport
              units={units}
              materials={materials}
              meals={meals}
              recipes={recipes}
              prices={prices}
              canImport={canAdd || canEdit}
              onChanged={loadData}
            />
          </div>
        )}
      </div>

      {/* التبويبات */}
      <div className="flex gap-2 overflow-x-auto pb-1">
        {TABS.map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-4 py-2.5 rounded-xl border-2 transition-all text-right whitespace-nowrap ${
              tab === t.key
                ? 'border-emerald-500 bg-emerald-50'
                : 'border-slate-200 bg-white hover:border-slate-300'
            }`}
          >
            <div className={`font-bold text-sm ${tab === t.key ? 'text-emerald-700' : 'text-slate-700'}`}>
              {t.label}
            </div>
            <div className={`text-[11px] ${tab === t.key ? 'text-emerald-600/70' : 'text-slate-400'}`}>
              {t.hint}
            </div>
          </button>
        ))}
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">
          {error}
        </div>
      )}

      {loading ? (
        <div className="card py-12 text-center text-slate-400 text-sm">جاري التحميل...</div>
      ) : tab === 'materials' ? (
        <RawMaterialsTab
          materials={materials}
          units={units}
          usageByMaterial={usageByMaterial}
          usageByUnit={usageByUnit}
          canAdd={canAdd}
          canEdit={canEdit}
          canDelete={canDelete}
          onChanged={loadData}
        />
      ) : tab === 'meals' ? (
        <MealCostsTab
          meals={meals}
          recipesByMeal={recipesByMeal}
          recipeCosts={recipeCosts}
          pricesByMeal={pricesByMeal}
          materials={materials}
          units={units}
          canEdit={canEdit}
          onChanged={loadData}
        />
      ) : (
        <OrderCostsTab canFreeze={canEdit} canUnfreeze={canDelete} />
      )}
    </div>
  );
}
