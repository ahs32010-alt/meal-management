import { supabase } from '@/lib/supabase-client';
import { fetchAllRows } from '@/lib/fetch-all';
import type { Beneficiary } from '@/lib/types';

const COLS = 'id, name, english_name, code, category, villa, diet_type, notes, created_at';
const FLAG_COLS = 'no_fish, no_pasta, no_sandwich, low_carb';

/**
 * يقرأ بيانات الستيكر لكل المستفيدين النشِطين.
 *
 * القراءة على دفعات — بدونها يقصّ PostgREST القائمة عند ١٠٠٠ صف بصمت فتُطبع
 * الستيكرات ناقصة بلا أي تنبيه. والتدرّج في الأعمدة يخلّي الصفحة تشتغل حتى لو
 * الـmigration الخاص بأعمدة الخيارات أو `entity_type` ما اتشغّل بعد.
 *
 * @param entityFilter عند true يقتصر على `entity_type = 'beneficiary'`؛ عند false
 *   يجيب الجميع (مستفيدين ومرافقين) — يلزم تبويب «حسب الوجبة» لأن أمر التشغيل
 *   قد يكون لأمر مرافقين.
 */
export async function fetchStickerBeneficiaries(
  entityFilter = true,
): Promise<{ data: Beneficiary[]; error: string | null }> {
  // `is_active` ضمن نفس الاستعلام لا في استعلام مستقل: قراءة ثانية من نفس
  // الجدول كانت تكلّف رحلة شبكة كاملة (~٤٥٠ms) بلا فائدة.
  const attempt = (select: string, useEntity: boolean) =>
    fetchAllRows((from, to) => {
      const q = supabase.from('beneficiaries').select(select);
      return (useEntity ? q.eq('entity_type', 'beneficiary') : q)
        .order('name').order('id').range(from, to);
    });

  // تدرّج: مع الأعمدة الجديدة → بدونها (الـmigration ما اشتغل) → بدون entity_type
  // custom_ld_meals (علامة فرز «وجبات غداء وعشاء مخصصة») اختياري قبل ترقيته
  let res = await attempt(`${COLS}, ${FLAG_COLS}, custom_ld_meals, is_active, entity_type`, entityFilter);
  if (res.error) res = await attempt(`${COLS}, ${FLAG_COLS}, is_active, entity_type`, entityFilter);
  if (res.error) res = await attempt(`${COLS}, is_active, entity_type`, entityFilter);
  if (res.error) res = await attempt(`${COLS}, entity_type`, entityFilter);
  if (res.error) res = await attempt(COLS, false);

  if (res.error) return { data: [], error: res.error.message };

  // استبعاد المعطّلين مؤقتاً — لا ستيكر لهم. الصفوف قبل الـmigration بلا عمود
  // `is_active` فتكون undefined، ونعتبرها مفعّلة كما كان السلوك دائماً.
  const rows = ((res.data ?? []) as unknown as Beneficiary[]).filter(b => b.is_active !== false);

  // النظام الغذائي في الستيكر = «النظام الغذائي الأساسي» (beneficiary_diets) لا
  // الخانة النصية القديمة: نكتب أسماء أنظمته في diet_type فتمشي عليها الطباعة
  // والترتيب والألوان وملف Word كما هي. بلا نظام = فاضي («نظام غذائي عادي»).
  const labels = await fetchDietLabels();
  return { data: rows.map(b => ({ ...b, diet_type: labels.get(b.id) ?? '' })), error: null };
}

const NORMAL_DIET = 'نظام غذائي عادي';

/** المستفيد ← أسماء أنظمته الأساسية مرتّبة («نظام غذائي عادي» أولاً) ومفصولة بـ « - » */
export async function fetchDietLabels(): Promise<Map<string, string>> {
  const res = await fetchAllRows((from, to) =>
    supabase.from('beneficiary_diets').select('beneficiary_id, diet_id, diet_systems(name)')
      .order('beneficiary_id').order('diet_id').range(from, to));
  const names = new Map<string, string[]>();
  if (res.error) return new Map();
  for (const r of (res.data ?? []) as unknown as { beneficiary_id: string; diet_systems: { name: string } | null }[]) {
    const n = r.diet_systems?.name?.trim();
    if (!n) continue;
    const list = names.get(r.beneficiary_id) ?? [];
    if (!list.includes(n)) list.push(n);
    names.set(r.beneficiary_id, list);
  }
  const out = new Map<string, string>();
  for (const [id, list] of names) {
    list.sort((a, b) => (a === NORMAL_DIET ? -1 : b === NORMAL_DIET ? 1 : a.localeCompare(b, 'ar')));
    out.set(id, list.join(' - '));
  }
  return out;
}
