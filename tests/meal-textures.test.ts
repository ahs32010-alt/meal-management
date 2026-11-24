import { describe, expect, it } from 'vitest';
import type { Meal } from '@/lib/types';
import { formatTextures, parseTextures, textureMealName } from '@/lib/meal-textures';
import { MEAL_COL_TEXTURES, MEAL_HEADERS, buildMealRow, parseMealRow } from '@/lib/meal-sheet';
import { BACKUP_TABLES, rowsForClientInsert, type BackupSnapshot } from '@/lib/backup-snapshot';
import { buildBackupSheets } from '@/lib/backup-export';

const meal = (p: Partial<Meal>): Meal => ({
  id: 'm', name: 'بيض تركي', english_name: '', type: 'breakfast', is_snack: false, category: 'hot', entity_type: 'beneficiary', created_at: '', ...p,
});

describe('الحالات الغذائية — صيغة الخانة', () => {
  it('اسم الحالة يُبنى من الأصل', () => {
    expect(textureMealName('بيض تركي', 'مهروس')).toBe('بيض تركي (مهروس)');
  });

  it('تنسيق ثم قراءة يرجّع نفس الحالات', () => {
    const list = [{ name: 'مهروس', diet: 'شبه المهروس' }, { name: 'خلاط', diet: null }];
    const text = formatTextures(list);
    expect(text).toBe('مهروس = شبه المهروس، خلاط');
    expect(parseTextures(text)).toEqual({ textures: list, error: null });
  });

  it('يقبل الفواصل المختلفة ويتجاهل الفراغات', () => {
    expect(parseTextures(' مهروس=شبه  المهروس ; خلاط = الخلاط ,\nمقطع ').textures).toEqual([
      { name: 'مهروس', diet: 'شبه المهروس' },
      { name: 'خلاط', diet: 'الخلاط' },
      { name: 'مقطع', diet: null },
    ]);
  });

  it('خانة فاضية = بلا حالات', () => {
    expect(parseTextures('')).toEqual({ textures: [], error: null });
  });

  it('حالة مكررة أو بلا اسم → خطأ', () => {
    expect(parseTextures('مهروس، مهروس = س').error).toContain('مكررة');
    expect(parseTextures('= شبه المهروس').error).toContain('بلا اسم');
  });
});

describe('الحالات الغذائية — ملف الأصناف', () => {
  it('عمود الحالات ضمن رؤوس الملف', () => {
    expect(MEAL_HEADERS).toContain(MEAL_COL_TEXTURES);
    expect(Object.keys(buildMealRow(meal({})))).toEqual(MEAL_HEADERS);
  });

  it('تصدير ثم استيراد يرجّع الحالات', () => {
    const row = buildMealRow(meal({}), [{ name: 'مهروس', diet: 'شبه المهروس' }]);
    expect(row[MEAL_COL_TEXTURES]).toBe('مهروس = شبه المهروس');
    const r = parseMealRow(row, 'beneficiary', 'صف 2');
    expect(r.error).toBeNull();
    expect(r.textures).toEqual([{ name: 'مهروس', diet: 'شبه المهروس' }]);
  });

  it('ملف قديم بلا عمود الحالات → ما نلمس الحالات', () => {
    const { [MEAL_COL_TEXTURES]: _omit, ...old } = buildMealRow(meal({}));
    void _omit;
    expect(parseMealRow(old, 'beneficiary', 'صف 2').textures).toBeUndefined();
  });

  it('خطأ في خانة الحالات يرفض الصف', () => {
    const row = { ...buildMealRow(meal({})), [MEAL_COL_TEXTURES]: 'مهروس، مهروس' };
    expect(parseMealRow(row, 'beneficiary', 'صف 3').error).toContain('صف 3 (بيض تركي): الحالات الغذائية');
  });
});

describe('الحالات الغذائية — النسخ الاحتياطي', () => {
  const parent = { id: 'p1', name: 'بيض تركي', type: 'breakfast', is_snack: false, category: 'hot', entity_type: 'beneficiary' };
  const variant = {
    id: 'v1', name: 'بيض تركي (مهروس)', type: 'breakfast', is_snack: false, category: 'hot', entity_type: 'beneficiary',
    texture_of: 'p1', texture_name: 'مهروس', texture_diet_id: 'd1',
  };

  it('الاستعادة من المتصفح تدرج الصنف الأصلي قبل حالاته', () => {
    const rows = rowsForClientInsert('meals', [variant, parent]);
    expect(rows.map(r => r.id)).toEqual(['p1', 'v1']);
  });

  it('ورقة الأصناف في النسخة: الحالة في خانة أصلها لا صفاً مستقلاً', () => {
    const tables = Object.fromEntries(BACKUP_TABLES.map(t => [t, []])) as unknown as BackupSnapshot['tables'];
    const t = tables as unknown as Record<string, unknown[]>;
    t.meals = [parent, variant];
    t.diet_systems = [{ id: 'd1', name: 'شبه المهروس' }];
    const sheets = buildBackupSheets({ version: 1, taken_at: '2026-11-23T00:00:00Z', tables });
    const rows = sheets.find(s => s.title === 'أصناف المستفيدين')?.rows ?? [];
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ 'الاسم': 'بيض تركي', [MEAL_COL_TEXTURES]: 'مهروس = شبه المهروس' });
  });
});
