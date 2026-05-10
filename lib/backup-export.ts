'use client';

import type { BackupSnapshot } from '@/lib/backup-snapshot';
import type { ItemCategory, MealType, EntityType } from '@/lib/types';

// ─── أنواع مساعدة ───────────────────────────────────────────────────────────

interface MealRow {
  id: string; name: string; english_name?: string | null;
  type: MealType; is_snack: boolean; entity_type?: EntityType;
  created_at?: string;
}

interface BeneficiaryRow {
  id: string; name: string; english_name?: string | null;
  code: string; category?: string | null; villa?: string | null;
  diet_type?: string | null; notes?: string | null;
  entity_type?: EntityType; created_at?: string;
}

interface ExclusionRow {
  beneficiary_id: string; meal_id: string;
  alternative_meal_id?: string | null;
}

interface FixedMealRow {
  beneficiary_id: string; day_of_week: number; meal_type: MealType;
  meal_id: string; quantity: number; category?: ItemCategory;
}

interface MenuRow {
  week_number: number; day_of_week: number; meal_type: MealType;
  meal_id: string; category: ItemCategory; position: number;
  multiplier?: number; entity_type?: EntityType;
}

interface OrderRow {
  id: string; date: string; meal_type: MealType;
  week_number?: number | null; day_of_week?: number | null;
  entity_type?: EntityType; created_at?: string;
}

interface OrderItemRow {
  order_id: string; meal_id: string;
  display_name?: string | null; extra_quantity?: number | null;
  category?: ItemCategory | null; multiplier?: number | null;
}

interface CustomTranslitRow {
  word: string; transliteration: string;
}

// ─── أنواع منظومة التسليم ──────────────────────────────────────────────────
interface CityRow { id: string; name: string; created_at?: string }
interface DeliveryLocationRow { id: string; name: string; city_id?: string | null; created_at?: string }
interface DeliveryMealRow { id: string; name: string; meal_type: MealType; is_snack: boolean; created_at?: string }
interface DeliveryOrderRow {
  id: string; order_number: string; date: string; meal_type: string;
  delivery_location_id?: string | null;
  notes?: string | null;
  created_at?: string;
}
interface DeliveryOrderItemRow {
  id: string; delivery_order_id: string; display_name: string;
  meal_type: string; quantity: number; position: number;
}

// ─── خرائط مساعدة ───────────────────────────────────────────────────────────

const DAY_SHORT: Record<number, string> = {
  0: 'احد', 1: 'اثنين', 2: 'ثلاثاء', 3: 'اربعاء', 4: 'خميس', 5: 'جمعة', 6: 'سبت',
};

const MEAL_TYPE_AR: Record<MealType, string> = {
  breakfast: 'فطور',
  lunch: 'غداء',
  dinner: 'عشاء',
};

const CAT_AR: Record<ItemCategory, string> = {
  hot: 'حار',
  cold: 'بارد',
  snack: 'سناك',
};

// ─── تحويل الجداول إلى صفوف Excel — نفس الصيغ المستعملة في الصفحات ─────────

function buildBeneficiariesSheet(
  bens: BeneficiaryRow[],
  meals: MealRow[],
  exclusions: ExclusionRow[],
  fixed: FixedMealRow[],
  entityType: EntityType,
): Record<string, string>[] {
  const mealsById = new Map(meals.map(m => [m.id, m] as const));
  const filtered = bens.filter(b => (b.entity_type ?? 'beneficiary') === entityType);

  // helpers identical to BeneficiaryList.handleExport
  const buildExclStr = (benId: string, type: MealType, isSnack: boolean) =>
    exclusions
      .filter(e => e.beneficiary_id === benId)
      .map(e => {
        const m = mealsById.get(e.meal_id);
        if (!m || m.type !== type || m.is_snack !== isSnack) return '';
        const alt = e.alternative_meal_id ? mealsById.get(e.alternative_meal_id) : null;
        const altName = alt?.name ?? '';
        return altName ? `${m.name}؛${altName}` : m.name;
      })
      .filter(Boolean)
      .join(' - ');

  const buildFixedStr = (benId: string, type: MealType, isSnack: boolean) => {
    const sectionDefault: ItemCategory = isSnack ? 'snack' : 'hot';
    const map = new Map<string, { name: string; days: number[]; quantity: number; category: ItemCategory }>();
    for (const fm of fixed.filter(f => f.beneficiary_id === benId && f.meal_type === type)) {
      const m = mealsById.get(fm.meal_id);
      if (!m || m.is_snack !== isSnack) continue;
      const cat = (fm.category ?? sectionDefault) as ItemCategory;
      const key = `${fm.meal_id}|${cat}`;
      if (!map.has(key)) {
        map.set(key, { name: m.name, days: [], quantity: fm.quantity ?? 1, category: cat });
      }
      map.get(key)!.days.push(fm.day_of_week);
    }
    return Array.from(map.values())
      .map(({ name, days, quantity, category }) => {
        const nameStr = quantity > 1 ? `${name}×${quantity}` : name;
        const daysStr = days.map(d => DAY_SHORT[d]).join(' ');
        const catSuffix = category !== sectionDefault ? `@${CAT_AR[category]}` : '';
        return `${nameStr}؛${daysStr}${catSuffix}`;
      })
      .join(' - ');
  };

  return filtered.map(b => ({
    'الاسم': b.name,
    'الاسم الإنجليزي': b.english_name ?? '',
    'الكود': b.code,
    'الفئة': b.category ?? '',
    'الفيلا': b.villa ?? '',
    'النظام الغذائي': b.diet_type ?? '',
    'محظورات الفطور':         buildExclStr(b.id, 'breakfast', false),
    'محظورات سناكات الفطور':  buildExclStr(b.id, 'breakfast', true),
    'محظورات الغداء':         buildExclStr(b.id, 'lunch',     false),
    'محظورات سناكات الغداء':  buildExclStr(b.id, 'lunch',     true),
    'محظورات العشاء':         buildExclStr(b.id, 'dinner',    false),
    'محظورات سناكات العشاء':  buildExclStr(b.id, 'dinner',    true),
    'ثابتة الفطور':           buildFixedStr(b.id, 'breakfast', false),
    'ثابتة سناكات الفطور':    buildFixedStr(b.id, 'breakfast', true),
    'ثابتة الغداء':           buildFixedStr(b.id, 'lunch',     false),
    'ثابتة سناكات الغداء':    buildFixedStr(b.id, 'lunch',     true),
    'ثابتة العشاء':           buildFixedStr(b.id, 'dinner',    false),
    'ثابتة سناكات العشاء':    buildFixedStr(b.id, 'dinner',    true),
    'ملاحظات': b.notes ?? '',
  }));
}

function buildMealsSheet(meals: MealRow[], entityType: EntityType): Record<string, string>[] {
  return meals
    .filter(m => (m.entity_type ?? 'beneficiary') === entityType)
    .map(m => ({
      'الاسم': m.name,
      'الاسم الإنجليزي': m.english_name ?? '',
      'نوع الوجبة': MEAL_TYPE_AR[m.type] ?? m.type,
      'سناك': m.is_snack ? 'نعم' : 'لا',
    }));
}

function buildMenuSheets(
  menu: MenuRow[],
  meals: MealRow[],
  entityType: EntityType,
): Array<{ title: string; rows: Record<string, string>[] }> {
  const mealsById = new Map(meals.map(m => [m.id, m] as const));
  const filtered = menu.filter(mi => (mi.entity_type ?? 'beneficiary') === entityType);

  // ورقة لكل أسبوع — جدول مسطّح (أسبوع/يوم/وجبة/تصنيف/صنف/مضاعف)
  // أبسط من إعادة بناء التصميم البصري الشبكي في export الأصلي،
  // لكن مفصّل ويُستورد مرة ثانية يدوياً عند الحاجة.
  const out: Array<{ title: string; rows: Record<string, string>[] }> = [];
  for (const week of [1, 2, 3, 4]) {
    const rows: Record<string, string>[] = [];
    for (const item of filtered.filter(i => i.week_number === week)) {
      const m = mealsById.get(item.meal_id);
      rows.push({
        'الأسبوع': String(week),
        'اليوم': DAY_SHORT[item.day_of_week] ?? String(item.day_of_week),
        'الوجبة': MEAL_TYPE_AR[item.meal_type] ?? item.meal_type,
        'التصنيف': CAT_AR[item.category] ?? item.category,
        'الصنف': m?.name ?? `(محذوف: ${item.meal_id})`,
        'المضاعف': String(item.multiplier ?? 1),
        'الترتيب': String(item.position),
      });
    }
    if (rows.length > 0) {
      out.push({ title: `منيو أسبوع ${week}`, rows });
    }
  }
  return out;
}

function buildOrdersSheet(
  orders: OrderRow[],
  orderItems: OrderItemRow[],
  meals: MealRow[],
): Record<string, string>[] {
  const mealsById = new Map(meals.map(m => [m.id, m] as const));
  const itemsByOrder = new Map<string, OrderItemRow[]>();
  for (const it of orderItems) {
    const list = itemsByOrder.get(it.order_id) ?? [];
    list.push(it);
    itemsByOrder.set(it.order_id, list);
  }
  return orders.map(o => {
    const items = itemsByOrder.get(o.id) ?? [];
    const itemsStr = items.map(it => {
      const m = mealsById.get(it.meal_id);
      const nameRaw = it.display_name || m?.name || '';
      const mult = it.multiplier ?? 1;
      const extra = it.extra_quantity ?? 0;
      const cat = it.category ? CAT_AR[it.category] : '';
      const parts = [nameRaw];
      if (mult > 1) parts.push(`×${mult}`);
      if (extra) parts.push(`+${extra}`);
      if (cat) parts.push(`(${cat})`);
      return parts.join(' ');
    }).join(' | ');
    return {
      'التاريخ': o.date,
      'الوجبة': MEAL_TYPE_AR[o.meal_type] ?? o.meal_type,
      'الفئة': o.entity_type === 'companion' ? 'المرافقون' : 'المستفيدون',
      'الأسبوع': o.week_number != null ? String(o.week_number) : '',
      'اليوم': o.day_of_week != null ? (DAY_SHORT[o.day_of_week] ?? '') : '',
      'الأصناف': itemsStr,
      'تاريخ الإنشاء': o.created_at ?? '',
    };
  });
}

function buildTranslitSheet(t: CustomTranslitRow[]): Record<string, string>[] {
  return t.map(r => ({
    'الكلمة': r.word,
    'الترجمة الحرفية': r.transliteration,
  }));
}

// ─── أوراق منظومة التسليم ──────────────────────────────────────────────────

function buildDeliveryMealsSheet(meals: DeliveryMealRow[]): Record<string, string>[] {
  return meals.map(m => ({
    'الاسم': m.name,
    'نوع الوجبة': MEAL_TYPE_AR[m.meal_type] ?? m.meal_type,
    'سناك': m.is_snack ? 'نعم' : 'لا',
  }));
}

function buildDeliveryLocationsSheet(
  locs: DeliveryLocationRow[],
  cities: CityRow[],
): Record<string, string>[] {
  const cityById = new Map(cities.map(c => [c.id, c.name] as const));
  return locs.map(l => ({
    'الموقع': l.name,
    'المدينة': l.city_id ? (cityById.get(l.city_id) ?? '') : '',
  }));
}

function buildDeliveryOrdersSheet(
  orders: DeliveryOrderRow[],
  items: DeliveryOrderItemRow[],
  locs: DeliveryLocationRow[],
  cities: CityRow[],
): Record<string, string>[] {
  const cityById = new Map(cities.map(c => [c.id, c.name] as const));
  const locById = new Map(locs.map(l => [l.id, l] as const));
  const itemsByOrder = new Map<string, DeliveryOrderItemRow[]>();
  for (const it of items) {
    const arr = itemsByOrder.get(it.delivery_order_id) ?? [];
    arr.push(it);
    itemsByOrder.set(it.delivery_order_id, arr);
  }
  const mealTypeAr = (mt: string) =>
    mt === 'all' ? 'فطور + غداء + عشاء' : (MEAL_TYPE_AR[mt as MealType] ?? mt);

  return orders.map(o => {
    const loc = o.delivery_location_id ? locById.get(o.delivery_location_id) : null;
    const cityName = loc?.city_id ? (cityById.get(loc.city_id) ?? '') : '';
    const ordItems = (itemsByOrder.get(o.id) ?? []).slice().sort((a, b) => a.position - b.position);
    const itemsStr = ordItems.map(it => {
      const mt = mealTypeAr(it.meal_type);
      return `${it.display_name} (${mt}) ×${it.quantity}`;
    }).join(' | ');
    return {
      'رقم الأمر': o.order_number,
      'التاريخ': o.date,
      'نوع الوجبة': mealTypeAr(o.meal_type),
      'موقع التسليم': loc?.name ?? '',
      'المدينة': cityName,
      'الأصناف': itemsStr,
      'الملاحظات': o.notes ?? '',
      'تاريخ الإنشاء': o.created_at ?? '',
    };
  });
}

// ─── التنزيل كـExcel متعدد الأوراق ──────────────────────────────────────────

export async function downloadBackupAsXLSX(
  snapshot: BackupSnapshot,
  filename: string,
): Promise<void> {
  const XLSX = await import('xlsx');
  const wb = XLSX.utils.book_new();
  if (!wb.Workbook) wb.Workbook = {};
  if (!wb.Workbook.Views) wb.Workbook.Views = [];
  wb.Workbook.Views[0] = { RTL: true };

  const t = snapshot.tables as unknown as Record<string, unknown[]>;
  const meals = (t.meals ?? []) as unknown as MealRow[];
  const bens = (t.beneficiaries ?? []) as unknown as BeneficiaryRow[];
  const excls = (t.exclusions ?? []) as unknown as ExclusionRow[];
  const fixed = (t.beneficiary_fixed_meals ?? []) as unknown as FixedMealRow[];
  const menu = (t.menu_items ?? []) as unknown as MenuRow[];
  const orders = (t.daily_orders ?? []) as unknown as OrderRow[];
  const orderItems = (t.order_items ?? []) as unknown as OrderItemRow[];
  const translit = (t.custom_transliterations ?? []) as unknown as CustomTranslitRow[];
  // منظومة أوامر التسليم
  const cities = (t.cities ?? []) as unknown as CityRow[];
  const deliveryLocs = (t.delivery_locations ?? []) as unknown as DeliveryLocationRow[];
  const deliveryMeals = (t.delivery_meals ?? []) as unknown as DeliveryMealRow[];
  const deliveryOrders = (t.delivery_orders ?? []) as unknown as DeliveryOrderRow[];
  const deliveryItems = (t.delivery_order_items ?? []) as unknown as DeliveryOrderItemRow[];

  const addSheet = (title: string, rows: Record<string, string>[]) => {
    if (rows.length === 0) return;
    const ws = XLSX.utils.json_to_sheet(rows);
    // عرض الأعمدة أوتوماتيكياً
    const cols = Object.keys(rows[0] ?? {}).map(key => ({
      wch: Math.max(
        key.length,
        ...rows.map(r => String(r[key] ?? '').length),
        12,
      ) + 2,
    }));
    ws['!cols'] = cols;
    ws['!sheetView'] = [{ rightToLeft: true } as unknown as never];
    // أسماء الأوراق محدودة بـ31 حرف في Excel
    XLSX.utils.book_append_sheet(wb, ws, title.slice(0, 31));
  };

  // 1) المستفيدون والمرافقون
  addSheet('المستفيدون', buildBeneficiariesSheet(bens, meals, excls, fixed, 'beneficiary'));
  addSheet('المرافقون',  buildBeneficiariesSheet(bens, meals, excls, fixed, 'companion'));

  // 2) أصناف كل فئة
  addSheet('أصناف المستفيدين', buildMealsSheet(meals, 'beneficiary'));
  addSheet('أصناف المرافقين',  buildMealsSheet(meals, 'companion'));

  // 3) المنيو لكل فئة (4 أسابيع × فئتين = حتى 8 أوراق)
  for (const sheet of buildMenuSheets(menu, meals, 'beneficiary')) {
    addSheet(`${sheet.title} - مستفيدين`, sheet.rows);
  }
  for (const sheet of buildMenuSheets(menu, meals, 'companion')) {
    addSheet(`${sheet.title} - مرافقين`, sheet.rows);
  }

  // 4) أوامر التشغيل
  addSheet('أوامر التشغيل', buildOrdersSheet(orders, orderItems, meals));

  // 5) منظومة أوامر التسليم
  addSheet('أصناف التسليم',  buildDeliveryMealsSheet(deliveryMeals));
  addSheet('مواقع التسليم',  buildDeliveryLocationsSheet(deliveryLocs, cities));
  addSheet('أوامر التسليم',  buildDeliveryOrdersSheet(deliveryOrders, deliveryItems, deliveryLocs, cities));

  // 6) الترجمة الحرفية المخصصة
  addSheet('الترجمة الحرفية', buildTranslitSheet(translit));

  // ورقة Meta للنسخة
  const metaRows: Record<string, string>[] = [
    { 'الحقل': 'تاريخ النسخة', 'القيمة': snapshot.taken_at },
    { 'الحقل': 'الإصدار', 'القيمة': String(snapshot.version) },
    ...Object.entries(snapshot.tables).map(([table, rows]) => ({
      'الحقل': `عدد ${table}`,
      'القيمة': String(rows.length),
    })),
  ];
  addSheet('Meta', metaRows);

  XLSX.writeFile(wb, filename);
}

// ─── التنزيل كـSQL ──────────────────────────────────────────────────────────

function toSqlLiteral(val: unknown): string {
  if (val === null || val === undefined) return 'NULL';
  if (typeof val === 'boolean') return val ? 'true' : 'false';
  if (typeof val === 'number') return isFinite(val) ? String(val) : 'NULL';
  if (typeof val === 'string') return `'${val.replace(/'/g, "''")}'`;
  return `'${JSON.stringify(val).replace(/'/g, "''")}'`;
}

export function downloadBackupAsSQL(snapshot: BackupSnapshot, filename: string): void {
  const tables = Object.keys(snapshot.tables) as (keyof typeof snapshot.tables)[];
  const lines: string[] = [
    '-- ============================================================',
    '-- نسخة احتياطية — نظام إدارة الوجبات',
    `-- تاريخ النسخة: ${snapshot.taken_at}`,
    `-- الإصدار: ${snapshot.version}`,
    '-- ============================================================',
    '-- للاستخدام: شغّل هذا الملف في Supabase SQL Editor أو psql',
    '-- ============================================================',
    '',
    'BEGIN;',
    '',
    '-- تعطيل قيود المفاتيح الخارجية مؤقتاً لتسهيل الإدراج',
    "SET session_replication_role = replica;",
    '',
    '-- ─── حذف البيانات القديمة (بترتيب عكسي لتجنب تعارض FKs) ───',
  ];

  for (const table of [...tables].reverse()) {
    lines.push(`TRUNCATE TABLE "${table}" RESTART IDENTITY CASCADE;`);
  }
  lines.push('');

  for (const table of tables) {
    const rows = snapshot.tables[table] as Record<string, unknown>[];
    lines.push(`-- ─── جدول: ${table} (${rows.length} صف) ───`);
    if (rows.length === 0) { lines.push(''); continue; }

    const cols = Object.keys(rows[0]);
    const colList = cols.map(c => `"${c}"`).join(', ');
    const valueGroups = rows.map(row => {
      const vals = cols.map(c => toSqlLiteral(row[c])).join(', ');
      return `  (${vals})`;
    });
    lines.push(`INSERT INTO "${table}" (${colList}) VALUES`);
    lines.push(valueGroups.join(',\n') + ';');
    lines.push('');
  }

  lines.push('-- إعادة تفعيل قيود المفاتيح الخارجية');
  lines.push("SET session_replication_role = DEFAULT;");
  lines.push('');
  lines.push('COMMIT;');

  const blob = new Blob([lines.join('\n')], { type: 'application/sql;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ─── التنزيل كـJSON ─────────────────────────────────────────────────────────

export function downloadBackupAsJSON(snapshot: BackupSnapshot, filename: string): void {
  const blob = new Blob([JSON.stringify(snapshot, null, 2)], {
    type: 'application/json;charset=utf-8',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
