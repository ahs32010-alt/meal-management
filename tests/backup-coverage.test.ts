import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  BACKUP_TABLES,
  BACKUP_TABLE_LABELS,
  restoreFromSnapshot,
  rowsForClientInsert,
  snapshotMissingTables,
  tablesNotCoveredByServer,
  type BackupSnapshot,
} from '@/lib/backup-snapshot';
import { buildBackupMetaRows, buildBackupSheets, buildBackupSQL, toSqlLiteral } from '@/lib/backup-export';
import { DELIVERY_ORDER_HEADERS } from '@/lib/delivery-order-sheet';

const SUPABASE_DIR = join(__dirname, '..', 'supabase');

/** جداول مستبعدة من النسخة عمداً — أي جدول جديد لازم يدخل النسخة أو هذه القائمة. */
const INTENTIONALLY_EXCLUDED = [
  'backups',             // تفادي التعشيش
  'app_users',           // المستخدمون والصلاحيات لا تتأثر بالاستعادة
  'activity_log',        // السجل لا يتأثر
  'pending_actions',     // طابور موافقات لحظي
  'telegram_link_codes', // ربط حسابات تيليجرام بالمستخدمين — يتبع app_users
  'telegram_links',
  'telegram_pending',
  'telegram_sessions',
  'telegram_updates',
];

function emptySnapshot(): BackupSnapshot {
  const tables = Object.fromEntries(BACKUP_TABLES.map(t => [t, []])) as unknown as BackupSnapshot['tables'];
  return { version: 1, taken_at: '2026-10-01T00:00:00Z', tables };
}

describe('تغطية جداول النسخة الاحتياطية', () => {
  it('كل جدول تُنشئه ملفات supabase/*.sql إما في النسخة أو مستبعد عمداً', () => {
    const created = new Set<string>();
    for (const f of readdirSync(SUPABASE_DIR).filter(n => n.endsWith('.sql'))) {
      const sql = readFileSync(join(SUPABASE_DIR, f), 'utf8');
      for (const m of sql.matchAll(/create table if not exists (?:public\.)?([a-z_]+)/gi)) {
        created.add(m[1].toLowerCase());
      }
    }
    const covered = new Set<string>([...BACKUP_TABLES, ...INTENTIONALLY_EXCLUDED]);
    const missing = [...created].filter(t => !covered.has(t));
    expect(missing, 'جداول غير محفوظة في النسخة').toEqual([]);
    // وبالعكس: لا جدول في النسخة بلا تعريف
    const unknown = BACKUP_TABLES.filter(t => !created.has(t));
    expect(unknown).toEqual([]);
  });

  it('قائمة السيرفر (آخر backup_logical_tables) = BACKUP_TABLES حرفياً وبالترتيب', () => {
    const sql = readFileSync(join(SUPABASE_DIR, 'backup-menu-overrides-coverage-migration.sql'), 'utf8');
    const body = sql.slice(sql.indexOf('select array['), sql.indexOf(']::text[]'));
    const list = [...body.matchAll(/'([a-z_]+)'/g)].map(m => m[1]);
    expect(list).toEqual([...BACKUP_TABLES]);
  });

  it('لكل جدول اسم عربي', () => {
    for (const t of BACKUP_TABLES) {
      expect(BACKUP_TABLE_LABELS[t], t).toBeTruthy();
      expect(BACKUP_TABLE_LABELS[t]).toMatch(/[؀-ۿ]/);
    }
  });
});

describe('توافق النسخ القديمة + مساعدات الاستعادة', () => {
  it('snapshotMissingTables يكشف الجداول الغائبة عن نسخة قديمة', () => {
    const snap = emptySnapshot();
    const tables = snap.tables as unknown as Record<string, unknown>;
    delete tables.beneficiary_menu_overrides;
    delete tables.diet_systems;
    expect(snapshotMissingTables(snap)).toEqual(['diet_systems', 'beneficiary_menu_overrides']);
    expect(snapshotMissingTables(emptySnapshot())).toEqual([]);
  });

  it('rowsForClientInsert يُسقط صفوف الأنظمة من exclusions فقط (الـtriggers تعيدها)', () => {
    const rows = [
      { id: '1', beneficiary_id: 'b', meal_id: 'm1', diet_id: null },
      { id: '2', beneficiary_id: 'b', meal_id: 'm2', diet_id: 'd1' },
      { id: '3', beneficiary_id: 'b', meal_id: 'm3' }, // نسخة قبل ترقية الأنظمة
    ];
    expect(rowsForClientInsert('exclusions', rows).map(r => r.id)).toEqual(['1', '3']);
    expect(rowsForClientInsert('menu_items', rows)).toHaveLength(3);
  });

  it('tablesNotCoveredByServer: ما لم يظهر في inserted ولا skipped', () => {
    const inserted = Object.fromEntries(BACKUP_TABLES.map(t => [t, 0]));
    delete inserted.beneficiary_menu_overrides;
    delete inserted.sticker_settings;
    expect(tablesNotCoveredByServer(inserted, ['sticker_settings'])).toEqual(['beneficiary_menu_overrides']);
  });
});

/** عميل Supabase وهمي يسجّل ما يُمسح وما يُدرَج */
function mockSupabase(rpcResult: { data: unknown; error: { message: string } | null }) {
  const log: { deleted: string[]; inserted: Record<string, unknown[]> } = { deleted: [], inserted: {} };
  const client = {
    rpc: async () => rpcResult,
    from: (table: string) => ({
      delete: () => ({
        not: async () => { log.deleted.push(table); return { error: null }; },
      }),
      insert: async (rows: unknown) => {
        const arr = Array.isArray(rows) ? rows : [rows];
        (log.inserted[table] ??= []).push(...arr);
        return { error: null };
      },
    }),
  };
  return { client: client as never, log };
}

describe('restoreFromSnapshot', () => {
  it('يكمل من المتصفح جدولاً لا تعرفه دالة الاستعادة على السيرفر (تعديلات المنيو)', async () => {
    const snap = emptySnapshot();
    const overrides = [{ id: 'o1', beneficiary_id: 'b1', action: 'remove', base_meal_id: 'm1' }];
    (snap.tables as unknown as Record<string, unknown[]>).beneficiary_menu_overrides = overrides;
    (snap.tables as unknown as Record<string, unknown[]>).meals = [{ id: 'm1' }];

    const serverInserted = Object.fromEntries(
      BACKUP_TABLES.filter(t => t !== 'beneficiary_menu_overrides').map(t => [t, t === 'meals' ? 1 : 0]),
    );
    const { client, log } = mockSupabase({ data: { ok: true, inserted: serverInserted, skipped_tables: [] }, error: null });

    const res = await restoreFromSnapshot(client, snap);
    expect(res.atomic).toBe(false);
    expect(res.inserted.meals).toBe(1);
    expect(res.inserted.beneficiary_menu_overrides).toBe(1);
    // المتصفح لمس الجدول الناقص فقط — لم يُعِد مسح ما استعاده السيرفر
    expect(log.deleted).toEqual(['beneficiary_menu_overrides']);
    expect(log.inserted).toEqual({ beneficiary_menu_overrides: overrides });
    expect(res.warnings.join(' ')).toContain('backup-menu-overrides-coverage-migration.sql');
  });

  it('ذرّية بالكامل حين تغطي قائمة السيرفر كل الجداول', async () => {
    const serverInserted = Object.fromEntries(BACKUP_TABLES.map(t => [t, 0]));
    const { client, log } = mockSupabase({ data: { ok: true, inserted: serverInserted, skipped_tables: [] }, error: null });
    const res = await restoreFromSnapshot(client, emptySnapshot());
    expect(res.atomic).toBe(true);
    expect(res.warnings).toEqual([]);
    expect(log.deleted).toEqual([]);
  });

  it('المسار القديم: يمسح بعكس الترتيب ويُدرج بالترتيب، ويحذّر من جداول غائبة عن النسخة', async () => {
    const snap = emptySnapshot();
    const t = snap.tables as unknown as Record<string, unknown[]>;
    delete t.beneficiary_menu_overrides;
    t.exclusions = [{ id: 'e1', diet_id: null }, { id: 'e2', diet_id: 'd1' }];
    const { client, log } = mockSupabase({ data: null, error: { message: 'function restore_backup_snapshot does not exist' } });

    const res = await restoreFromSnapshot(client, snap);
    expect(res.atomic).toBe(false);
    expect(log.deleted).toEqual([...BACKUP_TABLES].reverse());
    expect(log.inserted.exclusions).toEqual([{ id: 'e1', diet_id: null }]);
    expect(res.warnings.join(' ')).toContain(BACKUP_TABLE_LABELS.beneficiary_menu_overrides);
  });
});

describe('ملف SQL', () => {
  it('أعمدة المصفوفات بصيغة Postgres لا JSON، و jsonb يبقى JSON', () => {
    expect(toSqlLiteral(['a', "it's", 'q"x'], true)).toBe(`'{"a","it''s","q\\"x"}'`);
    expect(toSqlLiteral([], true)).toBe(`'{}'`);
    expect(toSqlLiteral({ k: [1] })).toBe(`'{"k":[1]}'`);

    const snap = emptySnapshot();
    const t = snap.tables as unknown as Record<string, unknown[]>;
    t.beneficiary_fixed_meals = [{ id: 'f1', suppress_if_meal_ids: ['u1', 'u2'] }];
    t.sticker_settings = [{ id: 1, diet_order: ['سكري'], show_diet_order: true }];
    t.order_cost_snapshots = [{ id: 's1', breakdown: { a: 1 } }];
    const sql = buildBackupSQL(snap);
    expect(sql).toContain(`('f1', '{"u1","u2"}')`);
    expect(sql).toContain(`(1, '{"سكري"}', true)`);
    expect(sql).toContain(`('s1', '{"a":1}')`);
  });

  it('ترتيب الجداول من BACKUP_TABLES مهما كان ترتيب المفاتيح (jsonb لا يحفظه)، والعمود الغائب → DEFAULT', () => {
    const shuffled = Object.fromEntries([...BACKUP_TABLES].reverse().map(x => [x, [] as unknown[]]));
    shuffled.meals = [{ id: 'm1', name: 'رز' }, { id: 'm2', name: 'خبز', category: 'cold' }];
    const sql = buildBackupSQL({ version: 1, taken_at: '', tables: shuffled as never });
    const inserts = [...sql.matchAll(/-- ─── جدول: ([a-z_]+)/g)].map(m => m[1]);
    expect(inserts).toEqual([...BACKUP_TABLES]);
    expect(sql).toContain(`('m1', 'رز', DEFAULT)`);
    expect(sql).toContain(`('m2', 'خبز', 'cold')`);
  });
});

describe('أوراق Excel المقروءة', () => {
  const snap = emptySnapshot();
  const t = snap.tables as unknown as Record<string, unknown[]>;
  t.meals = [
    { id: 'm1', name: 'رز', type: 'lunch', is_snack: false, category: 'hot' },
    { id: 'm2', name: 'سمك', type: 'lunch', is_snack: false, category: 'hot' },
  ];
  t.beneficiaries = [{ id: 'b1', name: 'أحمد', code: 'B001', entity_type: 'beneficiary' }];
  t.diet_systems = [{ id: 'd1', name: 'سكري', description: 'بلا سكر' }];
  t.diet_system_exclusions = [{ diet_id: 'd1', meal_id: 'm2', alternative_meal_id: 'm1' }];
  t.beneficiary_diets = [{ beneficiary_id: 'b1', diet_id: 'd1' }];
  t.fixed_extras_manual = [{ meal_id: 'm1', meal_type: 'lunch', quantity: 3, start_date: '2026-09-01', end_date: null }];
  t.beneficiary_menu_overrides = [{
    beneficiary_id: 'b1', week_number: 2, day_of_week: 0, meal_type: 'lunch',
    action: 'replace', base_meal_id: 'm2', target_meal_id: 'm1', quantity: 1, is_alternative: false,
  }];
  t.delivery_creators = [{ id: 'c1', name: 'خالد', phone: '0500' }];
  t.delivery_orders = [{
    id: 'o1', order_number: 'Delv.0001', date: '2026-09-30', meal_type: 'lunch',
    creator_id: 'c1', delivery_date: '2026-10-01', delivery_time: '12:00',
  }];
  t.sticker_settings = [{ id: 1, diet_order: ['سكري', 'ملح'], show_diet_order: false }];
  t.delivery_print_header = [{ id: 1, company_name_ar: 'شركة' }];

  const sheets = buildBackupSheets(snap);
  const byTitle = new Map(sheets.map(s => [s.title, s.rows] as const));

  it('الأنظمة الغذائية: الاستبعادات بالبديل والمستفيدون', () => {
    expect(byTitle.get('الأنظمة الغذائية')).toEqual([{
      'النظام': 'سكري',
      'الوصف': 'بلا سكر',
      'الأصناف المستبعدة (← البديل)': 'سمك ← رز',
      'عدد المستفيدين': '1',
      'المستفيدون': 'أحمد (B001)',
    }]);
  });

  it('تعديلات المنيو والإضافات اليدوية', () => {
    expect(byTitle.get('تعديلات منيو المستفيدين')?.[0]).toMatchObject({
      'المستفيد': 'أحمد', 'الأسبوع': '2', 'اليوم': 'احد', 'الإجراء': 'استبدال',
      'الصنف الأساسي': 'سمك', 'الصنف البديل/المضاف': 'رز',
    });
    expect(byTitle.get('إضافات ثابتة يدوية')).toEqual([{
      'الصنف': 'رز', 'الوجبة': 'غداء', 'العدد اليومي': '3', 'من تاريخ': '2026-09-01', 'إلى تاريخ': 'مستمر',
    }]);
  });

  it('أوامر التسليم تحمل المنشئ وموعد التسليم', () => {
    expect(byTitle.get('أوامر التسليم')?.[0]).toMatchObject({
      'المُنشئ': 'خالد', 'جوال المُنشئ': '0500', 'تاريخ التسليم': '2026-10-01', 'وقت التسليم': '12:00',
    });
    // نفس رؤوس ملف صفحة أوامر التسليم بالترتيب — فتُستورد الورقة هناك مباشرة
    expect(Object.keys(byTitle.get('أوامر التسليم')![0])).toEqual(DELIVERY_ORDER_HEADERS);
    expect(byTitle.get('منشئو التسليم')).toEqual([{ 'الاسم': 'خالد', 'الجوال': '0500' }]);
  });

  it('الإعدادات: ترتيب الستيكرات وترويسة الطباعة', () => {
    expect(byTitle.get('إعدادات الستيكرات')).toEqual([{
      'ترتيب الأنظمة في الستيكرات': 'سكري ← ملح', 'إظهار الترتيب': 'لا',
    }]);
    expect(byTitle.get('ترويسة طباعة التسليم')).toContainEqual({ 'الحقل': 'اسم الشركة (عربي)', 'القيمة': 'شركة' });
  });

  it('أسماء الأوراق ≤ ٣١ حرفاً وفريدة', () => {
    for (const s of sheets) expect(s.title.length, s.title).toBeLessThanOrEqual(31);
    expect(new Set(sheets.map(s => s.title)).size).toBe(sheets.length);
  });

  it('ورقة Meta: اسم عربي لكل جدول', () => {
    const meta = buildBackupMetaRows(snap);
    expect(meta).toContainEqual({ 'الحقل': 'عدد تعديلات منيو المستفيدين (beneficiary_menu_overrides)', 'القيمة': '1' });
    expect(meta).toHaveLength(2 + BACKUP_TABLES.length);
  });
});
