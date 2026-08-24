import { supabase } from '@/lib/supabase-client';
import { fetchAllRows } from '@/lib/fetch-all';
import { fetchInactiveBeneficiaryIds } from '@/lib/inactive-beneficiaries';
import type { Beneficiary } from '@/lib/types';

const COLS = 'id, name, english_name, code, category, villa, diet_type, notes, created_at';
const FLAG_COLS = 'no_fish, no_pasta_sandwich, low_carb';

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
  const attempt = (select: string, useEntity: boolean) =>
    fetchAllRows((from, to) => {
      const q = supabase.from('beneficiaries').select(select);
      return (useEntity ? q.eq('entity_type', 'beneficiary') : q)
        .order('name').order('id').range(from, to);
    });

  // تدرّج: مع الأعمدة الجديدة → بدونها (الـmigration ما اشتغل) → بدون entity_type
  let res = await attempt(`${COLS}, ${FLAG_COLS}, entity_type`, entityFilter);
  if (res.error) res = await attempt(`${COLS}, entity_type`, entityFilter);
  if (res.error) res = await attempt(COLS, false);

  if (res.error) return { data: [], error: res.error.message };

  // استبعاد المعطّلين مؤقتاً — لا ستيكر لهم
  const inactive = await fetchInactiveBeneficiaryIds(supabase);
  const rows = ((res.data ?? []) as unknown as Beneficiary[]).filter(b => !inactive.has(b.id));
  return { data: rows, error: null };
}
