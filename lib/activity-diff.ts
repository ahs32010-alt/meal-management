// ============================================================================
// بناء تفاصيل سجل النشاط: «ايش تغيّر بالضبط»
//
// نقاط الاستدعاء كانت تسجّل القيم الجديدة فقط، فالسجل يقول «عُدِّل المستفيد
// فلان» بدون ما يقول أي حقل تغيّر ولا من إيش لإيش. هذي الوحدة تبني الفرق
// الحقيقي بين اللقطة القديمة والجديدة، وتخزّنه بمفاتيح محجوزة تفهمها شاشة
// «آخر التحديثات» وتعرضها كمقارنة قبل ← بعد.
//
// وحدة نقية (بدون 'use client') — تُستدعى من مكوّنات العميل ومن مسارات الخادم.
// ============================================================================

import { CHANGES_DETAIL_KEY, FIELDS_DETAIL_KEY } from '@/lib/activity-describe';

export interface FieldChange {
  before: unknown;
  after: unknown;
}

type Rec = Record<string, unknown> | null | undefined;

const isBlank = (v: unknown) => v === undefined || v === null || v === '';

/**
 * مقارنة متسامحة مع اختلافات التمثيل التي لا تعني تغييراً فعلياً:
 * null مقابل '' (حقل فُرِّغ ثم حُفظ)، '5' مقابل 5 (قيمة قادمة من input نصي)،
 * و false مقابل null (عمود boolean بلا قيمة افتراضية).
 */
function sameValue(a: unknown, b: unknown): boolean {
  if (isBlank(a) && isBlank(b)) return true;
  if (typeof a === 'boolean' || typeof b === 'boolean') return Boolean(a) === Boolean(b);
  if (typeof a === 'number' || typeof b === 'number') {
    const na = Number(a);
    const nb = Number(b);
    if (Number.isFinite(na) && Number.isFinite(nb)) return na === nb;
  }
  if (typeof a === 'object' || typeof b === 'object') {
    return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
  }
  return String(a) === String(b);
}

/**
 * الحقول التي اختلفت فعلاً بين لقطتين.
 * `fields` يحصر المقارنة بحقول بعينها — مهم لأن كائن الصف القادم من القاعدة
 * يحمل أعمدة تقنية (id, created_at, entity_type…) ما لها معنى في السجل.
 */
export function diffFields(before: Rec, after: Rec, fields?: string[]): Record<string, FieldChange> {
  const keys = fields ?? Array.from(new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})]));
  const out: Record<string, FieldChange> = {};
  for (const k of keys) {
    const a = before?.[k];
    const b = after?.[k];
    if (sameValue(a, b)) continue;
    out[k] = { before: a ?? null, after: b ?? null };
  }
  return out;
}

const isFilled = (v: unknown) =>
  !(v === null || v === undefined || v === '' || (Array.isArray(v) && v.length === 0));

/**
 * تفاصيل عملية تعديل: مقارنة قبل/بعد لكل حقل تغيّر، مع أي تفاصيل إضافية
 * (فروقات القوائم المرتبطة مثلاً).
 *
 * الملاحظة «بلا تغيير» تُكتب فقط لو ما فيه ولا تغيير ولا تفصيل إضافي — كتابتها
 * بمجرد أن حقول الجدول الرئيسي ما تغيّرت تكذب على القارئ حين يكون التغيير كله
 * في المحظورات أو الأصناف الثابتة.
 */
export function updateDetails(
  before: Rec,
  after: Rec,
  fields?: string[],
  extra: Record<string, unknown> = {}
): Record<string, unknown> {
  const changes = diffFields(before, after, fields);
  const hasChanges = Object.keys(changes).length > 0;
  const hasExtra = Object.values(extra).some(isFilled);
  if (!hasChanges && !hasExtra) return { note: 'حُفظ بدون أي تغيير' };
  return {
    ...(hasChanges ? { [CHANGES_DETAIL_KEY]: changes } : {}),
    ...extra,
  };
}

/** تفاصيل تعديل بسيط بلا قوائم مرتبطة */
export function changeDetails(before: Rec, after: Rec, fields?: string[]): Record<string, unknown> {
  return updateDetails(before, after, fields);
}

/** لقطة القيم كما أُدخلت (إضافة) أو كما كانت قبل الحذف — بلا الحقول الفارغة */
export function valueDetails(record: Rec, fields?: string[]): Record<string, unknown> {
  const src = record ?? {};
  const keys = fields ?? Object.keys(src);
  const out: Record<string, unknown> = {};
  for (const k of keys) {
    const v = src[k];
    if (v === undefined) continue;
    if (v === null || v === '') continue;
    out[k] = v;
  }
  return Object.keys(out).length > 0 ? { [FIELDS_DETAIL_KEY]: out } : {};
}

/**
 * فرق قائمتين من الأوصاف النصية (محظورات، أصناف ثابتة، مكوّنات وصفة…).
 * السطر المعدَّل يظهر مُزالاً ومُضافاً معاً — أوضح للقارئ من محاولة تتبّع أي
 * خاصية تغيّرت داخل السطر، وأبسط بكثير في التنفيذ.
 */
export function diffLists(before: string[], after: string[]): { added: string[]; removed: string[] } {
  const b = new Set(before);
  const a = new Set(after);
  return {
    added: after.filter(x => !b.has(x)),
    removed: before.filter(x => !a.has(x)),
  };
}

/** يدمج فرق قائمة في التفاصيل تحت مفتاحي «مُضاف» و«مُزال» — ويتخطّى الفارغ */
export function listDiffDetails(
  key: 'exclusions' | 'fixed_meals' | 'menu_overrides' | 'ingredients' | 'items' | 'menu_meals',
  before: string[],
  after: string[]
): Record<string, unknown> {
  const { added, removed } = diffLists(before, after);
  const out: Record<string, unknown> = {};
  if (added.length > 0) out[`added_${key}`] = added;
  if (removed.length > 0) out[`removed_${key}`] = removed;
  return out;
}
