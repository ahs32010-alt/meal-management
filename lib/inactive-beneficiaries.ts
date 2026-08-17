import type { SupabaseClient } from '@supabase/supabase-js';
import { fetchAllRows } from '@/lib/fetch-all';

/**
 * يرجّع مجموعة معرّفات المستفيدين/المرافقين المعطّلين مؤقتاً (is_active = false).
 * هؤلاء يجب استبعادهم من أوامر التشغيل والستيكرات والتقارير.
 *
 * آمن قبل تشغيل الـmigration: لو عمود is_active غير موجود يرجّع مجموعة فارغة
 * (نعتبر الجميع مفعّلين).
 */
export async function fetchInactiveBeneficiaryIds(
  supabase: SupabaseClient,
): Promise<Set<string>> {
  try {
    const { data, error } = await fetchAllRows<{ id: string }>((from, to) =>
      supabase
        .from('beneficiaries')
        .select('id')
        .eq('is_active', false)
        .order('id')
        .range(from, to));
    if (error || !data) return new Set();
    return new Set(data.map(r => r.id));
  } catch {
    return new Set();
  }
}
