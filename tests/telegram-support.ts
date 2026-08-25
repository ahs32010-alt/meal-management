/**
 * قاعدة بيانات في الذاكرة تكفي لاختبار طبقة تليقرام.
 *
 * تحاكي من PostgREST ما نستعمله فعلاً — الترشيح، والإدراج مع تعارض المفتاح،
 * والتحديث المشروط الذي يرجّع صفوفه. وتعارض المفتاح خصوصاً ليس تفصيلاً: عليه
 * يقوم منع التكرار كله.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

export type Row = Record<string, unknown>;

const PRIMARY_KEY: Record<string, string> = {
  telegram_updates: 'update_id',
  telegram_links: 'chat_id',
  telegram_sessions: 'chat_id',
  telegram_link_codes: 'code',
  telegram_pending: 'id',
  app_users: 'id',
};

export function makeClient(tables: Record<string, Row[]>): SupabaseClient {
  type Result = { data: Row[] | Row | null; error: { code?: string; message: string } | null };

  class Q implements PromiseLike<Result> {
    private filters: Array<{ col: string; value: unknown; op: 'eq' | 'is' }> = [];
    private mode: 'select' | 'insert' | 'update' | 'delete' | 'upsert' = 'select';
    private values: Row | null = null;
    private returning = false;
    private single = false;

    constructor(private table: string) {}

    select() { this.returning = true; return this; }
    order() { return this; }
    limit() { return this; }
    eq(col: string, value: unknown) { this.filters.push({ col, value, op: 'eq' }); return this; }
    is(col: string, value: unknown) { this.filters.push({ col, value, op: 'is' }); return this; }
    insert(values: Row) { this.mode = 'insert'; this.values = values; return this; }
    upsert(values: Row) { this.mode = 'upsert'; this.values = values; return this; }
    update(values: Row) { this.mode = 'update'; this.values = values; return this; }
    delete() { this.mode = 'delete'; return this; }
    maybeSingle() { this.single = true; this.returning = true; return this; }

    private rows(): Row[] {
      tables[this.table] ??= [];
      return tables[this.table].filter((row) =>
        this.filters.every(({ col, value, op }) =>
          op === 'is' ? (row[col] ?? null) === value : row[col] === value,
        ),
      );
    }

    private run(): Result {
      tables[this.table] ??= [];
      const table = tables[this.table];

      if (this.mode === 'insert' || this.mode === 'upsert') {
        const pk = PRIMARY_KEY[this.table];
        const at = table.findIndex((r) => r[pk] === this.values?.[pk]);
        if (at >= 0) {
          if (this.mode === 'insert') {
            return { data: null, error: { code: '23505', message: 'duplicate key' } };
          }
          table[at] = { ...table[at], ...this.values };
          return { data: this.returning ? [table[at]] : null, error: null };
        }
        const row = { ...this.values } as Row;
        table.push(row);
        return { data: this.returning ? [row] : null, error: null };
      }

      if (this.mode === 'update') {
        const matched = this.rows();
        for (const row of matched) Object.assign(row, this.values);
        return { data: this.returning ? matched : null, error: null };
      }

      if (this.mode === 'delete') {
        const doomed = new Set(this.rows());
        tables[this.table] = table.filter((r) => !doomed.has(r));
        return { data: null, error: null };
      }

      const found = this.rows();
      return { data: this.single ? (found[0] ?? null) : found, error: null };
    }

    then<A, B = never>(
      ok?: ((v: Result) => A | PromiseLike<A>) | null,
      err?: ((r: unknown) => B | PromiseLike<B>) | null,
    ): PromiseLike<A | B> {
      return Promise.resolve(this.run()).then(ok, err);
    }
  }

  return {
    from: (t: string) => new Q(t),
    rpc: async () => ({ data: null, error: null }),
  } as unknown as SupabaseClient;
}

export const TEST_USER = {
  id: 'u1',
  email: 'ahmad@example.com',
  full_name: 'أحمد',
  is_admin: false,
  permissions: {},
  approval_required: {},
  avatar_url: null,
  created_at: '2026-01-01',
  updated_at: '2026-01-01',
};

// ── التقاط نداءات تليقرام ──────────────────────────────────────────────────

export interface TgCall {
  method: string;
  body: Record<string, unknown>;
}

/** يستبدل fetch بواحد يسجّل ما كان سيُرسل لتليقرام ويرد بنجاح فارغ. */
export function captureTelegram(): { calls: TgCall[]; restore: () => void } {
  const calls: TgCall[] = [];
  const original = globalThis.fetch;

  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    const href = typeof url === 'string' ? url : url.toString();
    const method = href.split('/').pop() ?? '';
    calls.push({ method, body: JSON.parse(String(init?.body ?? '{}')) });
    return {
      ok: true,
      json: async () => ({ ok: true, result: { message_id: calls.length } }),
    } as Response;
  }) as typeof fetch;

  return { calls, restore: () => { globalThis.fetch = original; } };
}

/** كل النصوص المرسَلة عبر sendMessage — مجتمعةً للتفتيش. */
export function sentText(calls: TgCall[]): string {
  return calls
    .filter((c) => c.method === 'sendMessage')
    .map((c) => String(c.body.text ?? ''))
    .join('\n---\n');
}
