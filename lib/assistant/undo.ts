/**
 * التراجع عن أمر منفَّذ.
 *
 * قبل كل عملية نلتقط ما يكفي لعكسها:
 *   إدراج → حذف بالمعرّف الراجع
 *   تحديث → إعادة القيم السابقة (تُقرأ قبل الكتابة)
 *   حذف   → إعادة إدراج الصف كاملاً (يُقرأ قبل الحذف)
 *
 * العمليات العكسية تُوقَّع بـHMAC بمفتاح السيرفر قبل إرسالها للمتصفح، ويُتحقَّق
 * من التوقيع عند التراجع — فالمتصفح يحمل الرمز ولا يقدر يزوّره أو يصنع عمليات
 * من عنده.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { PageKey, PermissionAction } from '@/lib/permissions';
import type { Op } from './plan';

export interface UndoPayload {
  /** العمليات العكسية بترتيب التنفيذ (معكوس ترتيب الأصل). */
  ops: Op[];
  /** نفس صلاحية الأمر الأصلي — التراجع تعديل مثله. */
  permission: { page: PageKey; action: PermissionAction };
  /** وصف يظهر للمستخدم. */
  label: string;
  /** طابع زمني لتقييد صلاحية الرمز. */
  issuedAt: number;
}

/** صلاحية رمز التراجع — ساعة واحدة. */
const TTL_MS = 60 * 60 * 1000;

function secret(): string | null {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SERVICE_KEY;
  return key && key.length >= 16 ? key : null;
}

function sign(json: string, key: string): string {
  return createHmac('sha256', key).update(json).digest('base64url');
}

/** يحوّل حمولة التراجع إلى رمز موقَّع. يرجّع null لو ما فيه مفتاح سيرفر. */
export function encodeUndo(payload: UndoPayload): string | null {
  const key = secret();
  if (!key) return null;
  const json = JSON.stringify(payload);
  const body = Buffer.from(json, 'utf8').toString('base64url');
  return `${body}.${sign(json, key)}`;
}

/** يتحقّق من الرمز ويرجّع الحمولة، أو null لو مزوّر أو منتهٍ. */
export function decodeUndo(token: unknown): UndoPayload | null {
  if (typeof token !== 'string' || !token.includes('.')) return null;
  const key = secret();
  if (!key) return null;

  const [body, mac] = token.split('.', 2);
  let json: string;
  try {
    json = Buffer.from(body, 'base64url').toString('utf8');
  } catch {
    return null;
  }

  const expected = sign(json, key);
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  let payload: UndoPayload;
  try {
    payload = JSON.parse(json) as UndoPayload;
  } catch {
    return null;
  }

  if (!payload?.ops?.length || !payload.permission) return null;
  if (Date.now() - payload.issuedAt > TTL_MS) return null;
  return payload;
}

/** الأعمدة التي لا تُعاد عند إعادة إدراج صف محذوف. */
const SKIP_ON_REINSERT = new Set(['created_at', 'updated_at']);

function reinsertValues(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    if (SKIP_ON_REINSERT.has(k)) continue;
    // العلاقات المضمّنة تجي ككائنات — ليست أعمدة
    if (v !== null && typeof v === 'object' && !Array.isArray(v)) continue;
    out[k] = v;
  }
  return out;
}

/**
 * يلتقط ما يلزم لعكس عملية **قبل** تنفيذها.
 * للإدراج نرجّع null لأن العكس يحتاج المعرّف الراجع بعد التنفيذ.
 */
export async function captureBefore(
  supabase: SupabaseClient,
  op: Op,
): Promise<Op[] | null> {
  if (op.action === 'insert') return null;

  let q = supabase.from(op.table).select('*');
  for (const [k, v] of Object.entries(op.match)) q = q.eq(k, v);
  const { data, error } = await q;
  if (error || !data) return [];

  const rows = data as unknown as Array<Record<string, unknown>>;

  if (op.action === 'delete') {
    return rows.map((r) => ({
      table: op.table,
      action: 'insert' as const,
      values: reinsertValues(r),
    }));
  }

  // تحديث: نعيد فقط الأعمدة التي مسّها الأمر
  return rows.map((r) => {
    const prev: Record<string, unknown> = {};
    for (const k of Object.keys(op.values)) prev[k] = r[k] ?? null;
    return { table: op.table, action: 'update' as const, match: { id: r.id }, values: prev };
  });
}

/** العكس لعملية إدراج نجحت وأعادت معرّفات. */
export function captureAfterInsert(op: Op, insertedIds: string[]): Op[] {
  return insertedIds.map((id) => ({ table: op.table, action: 'delete' as const, match: { id } }));
}
