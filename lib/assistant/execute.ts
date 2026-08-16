/**
 * تنفيذ خطة مؤكَّدة.
 *
 * يُستدعى فقط من مسار الـAPI بعد:
 *   1. التحقق من هوية المستخدم وصلاحيته على الصفحة المعنية.
 *   2. إعادة بناء الخطة من نفس مدخلات المستخدم ومطابقة توقيعها.
 *
 * كل عملية تُنفَّذ بالترتيب، ويُلتقط عكسها قبلها — فلو ندم المستخدم يقدر
 * يتراجع. عند أول فشل نتوقف ونرجّع ما تم؛ لا نُكمل على بيانات نصفها متغيّر.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { logActivityServer } from '@/lib/activity-log-server';
import type { Op, Plan } from './plan';
import { captureAfterInsert, captureBefore, encodeUndo } from './undo';

export interface ExecuteOutcome {
  ok: boolean;
  applied: number;
  total: number;
  error?: string;
  /** رمز موقَّع يُمكّن من التراجع — null لو تعذّر. */
  undoToken?: string | null;
}

/**
 * أعمدة قد تكون غير موجودة لو أحد الـmigrations الاختيارية ما اتشغّل.
 * عند فشل الكتابة بسبب عمود ناقص نُعيد المحاولة بدونها بدل ما ينهار الأمر.
 */
const OPTIONAL_COLUMNS: Record<string, string[]> = {
  beneficiary_fixed_meals: ['category', 'suppress_if_meal_ids'],
  menu_items: ['entity_type', 'multiplier', 'extra_quantity'],
  meals: ['category', 'entity_type'],
  beneficiaries: ['is_active', 'entity_type', 'no_fish', 'no_pasta_sandwich', 'low_carb'],
  daily_orders: ['entity_type', 'week_number', 'day_of_week'],
  order_items: ['category', 'multiplier', 'extra_quantity', 'display_name'],
};

function stripOptional(table: string, values: Record<string, unknown>): Record<string, unknown> | null {
  const optional = OPTIONAL_COLUMNS[table];
  if (!optional) return null;
  const next: Record<string, unknown> = {};
  let dropped = false;
  for (const [k, v] of Object.entries(values)) {
    if (optional.includes(k)) { dropped = true; continue; }
    next[k] = v;
  }
  return dropped ? next : null;
}

type RunResult = { error: string } | { ids: string[] };

async function runOp(supabase: SupabaseClient, op: Op): Promise<RunResult> {
  if (op.action === 'insert') {
    const { data, error } = await supabase.from(op.table).insert(op.values).select('id');
    if (!error) return { ids: ((data as unknown as Array<{ id: string }>) ?? []).map((r) => r.id) };
    if (/column|schema cache/i.test(error.message)) {
      const fallback = stripOptional(op.table, op.values);
      if (fallback) {
        const retry = await supabase.from(op.table).insert(fallback).select('id');
        if (!retry.error) {
          return { ids: ((retry.data as unknown as Array<{ id: string }>) ?? []).map((r) => r.id) };
        }
        return { error: retry.error.message };
      }
    }
    return { error: error.message };
  }

  if (op.action === 'update') {
    let q = supabase.from(op.table).update(op.values);
    for (const [k, v] of Object.entries(op.match)) q = q.eq(k, v);
    const { error } = await q;
    if (!error) return { ids: [] };
    if (/column|schema cache/i.test(error.message)) {
      const fallback = stripOptional(op.table, op.values);
      if (fallback && Object.keys(fallback).length > 0) {
        let r = supabase.from(op.table).update(fallback);
        for (const [k, v] of Object.entries(op.match)) r = r.eq(k, v);
        const retry = await r;
        if (!retry.error) return { ids: [] };
        return { error: retry.error.message };
      }
    }
    return { error: error.message };
  }

  let q = supabase.from(op.table).delete();
  for (const [k, v] of Object.entries(op.match)) q = q.eq(k, v);
  const { error } = await q;
  return error ? { error: error.message } : { ids: [] };
}

/** ينفّذ سلسلة عمليات ويرجّع عكسها. لا يسجّل شيئاً — المتصل يقرّر. */
async function runAll(
  supabase: SupabaseClient,
  ops: Op[],
): Promise<{ applied: number; undo: Op[]; error?: string }> {
  const undo: Op[] = [];
  let applied = 0;

  for (const op of ops) {
    const before = await captureBefore(supabase, op);
    const result = await runOp(supabase, op);

    if ('error' in result) {
      return { applied, undo: undo.reverse(), error: result.error };
    }

    // العكس يُبنى بعد النجاح فقط
    undo.push(...(before ?? captureAfterInsert(op, result.ids)));
    applied++;
  }

  return { applied, undo: undo.reverse() };
}

export async function executePlan(
  supabase: SupabaseClient,
  plan: Plan,
  actor: { userId: string; page?: string },
): Promise<ExecuteOutcome> {
  const { applied, undo, error } = await runAll(supabase, plan.ops);

  if (error) {
    return {
      ok: false,
      applied,
      total: plan.ops.length,
      error:
        applied === 0
          ? `تعذّر التنفيذ: ${error}`
          : `نُفِّذت ${applied} من ${plan.ops.length} عملية ثم توقّف التنفيذ: ${error}`,
    };
  }

  // السجل بعد نجاح كل العمليات — لا نسجّل نيّة لم تتحقق.
  await Promise.all(
    plan.activity.map((a) =>
      logActivityServer({
        user_id: actor.userId,
        action: a.action,
        entity_type: a.entity_type,
        entity_id: a.entity_id ?? null,
        entity_name: a.entity_name ?? null,
        details: { ...(a.details ?? {}), عبر: 'المساعد الذكي' },
        page: actor.page ?? '/assistant',
      }),
    ),
  );

  return {
    ok: true,
    applied,
    total: plan.ops.length,
    undoToken: encodeUndo({
      ops: undo,
      permission: plan.permission,
      label: `${plan.title} — ${plan.summary}`,
      issuedAt: Date.now(),
    }),
  };
}

/** ينفّذ عمليات التراجع الموقَّعة. */
export async function executeUndo(
  supabase: SupabaseClient,
  ops: Op[],
  label: string,
  actor: { userId: string; page?: string },
): Promise<ExecuteOutcome> {
  const { applied, error } = await runAll(supabase, ops);

  if (error) {
    return { ok: false, applied, total: ops.length, error: `تعذّر التراجع: ${error}` };
  }

  await logActivityServer({
    user_id: actor.userId,
    action: 'update',
    entity_type: 'beneficiary',
    entity_name: `تراجع — ${label}`,
    details: { العمليات: applied, عبر: 'المساعد الذكي' },
    page: actor.page ?? '/assistant',
  });

  return { ok: true, applied, total: ops.length };
}
