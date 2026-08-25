import { describe, expect, it } from 'vitest';
import {
  changeDetails,
  diffFields,
  diffLists,
  listDiffDetails,
  updateDetails,
  valueDetails,
} from '@/lib/activity-diff';
import {
  CHANGES_DETAIL_KEY,
  FIELDS_DETAIL_KEY,
  buildDetailRows,
} from '@/lib/activity-describe';

describe('diffFields', () => {
  it('يرصد الحقل المتغيّر فقط ويحمل قيمتيه', () => {
    const out = diffFields({ name: 'أحمد', code: 'A1' }, { name: 'محمد', code: 'A1' });
    expect(Object.keys(out)).toEqual(['name']);
    expect(out.name).toEqual({ before: 'أحمد', after: 'محمد' });
  });

  it('لا يعدّ اختلاف التمثيل تغييراً: فراغ/null، نص رقمي/رقم، false/null', () => {
    const out = diffFields(
      { villa: null, qty: 5, no_fish: null },
      { villa: '', qty: '5', no_fish: false },
    );
    expect(out).toEqual({});
  });

  it('يحصر المقارنة بالحقول المطلوبة فيتجاهل الأعمدة التقنية', () => {
    const out = diffFields(
      { name: 'أحمد', updated_at: '2026-01-01' },
      { name: 'أحمد', updated_at: '2026-08-25' },
      ['name'],
    );
    expect(out).toEqual({});
  });

  it('يقارن الكائنات والمصفوفات بمحتواها', () => {
    expect(diffFields({ tags: ['a', 'b'] }, { tags: ['a', 'b'] })).toEqual({});
    expect(Object.keys(diffFields({ tags: ['a'] }, { tags: ['a', 'b'] }))).toEqual(['tags']);
  });
});

describe('updateDetails', () => {
  it('يخزّن التغييرات تحت المفتاح المحجوز', () => {
    const d = updateDetails({ code: 'A1' }, { code: 'B2' }, ['code']);
    expect(d[CHANGES_DETAIL_KEY]).toEqual({ code: { before: 'A1', after: 'B2' } });
    expect(d.note).toBeUndefined();
  });

  it('يكتب ملاحظة «بلا تغيير» فقط لو ما فيه ولا تفصيل إضافي', () => {
    expect(changeDetails({ code: 'A1' }, { code: 'A1' }, ['code'])).toEqual({
      note: 'حُفظ بدون أي تغيير',
    });
  });

  it('لا يكذب بـ«بلا تغيير» لما يكون التغيير في القوائم المرتبطة وحدها', () => {
    const d = updateDetails({ code: 'A1' }, { code: 'A1' }, ['code'], {
      added_exclusions: ['سمك مشوي'],
    });
    expect(d.note).toBeUndefined();
    expect(d.added_exclusions).toEqual(['سمك مشوي']);
  });

  it('يتجاهل التفاصيل الإضافية الفارغة عند تقرير «بلا تغيير»', () => {
    const d = updateDetails({ code: 'A1' }, { code: 'A1' }, ['code'], { added_exclusions: [] });
    expect(d.note).toBe('حُفظ بدون أي تغيير');
  });
});

describe('valueDetails', () => {
  it('يسقط الحقول الفارغة ويبقي false', () => {
    const d = valueDetails({ name: 'أرز', villa: '', notes: null, is_active: false });
    expect(d[FIELDS_DETAIL_KEY]).toEqual({ name: 'أرز', is_active: false });
  });

  it('يرجع كائناً فاضياً لو ما بقي شيء', () => {
    expect(valueDetails({ villa: '', notes: null })).toEqual({});
  });
});

describe('diffLists / listDiffDetails', () => {
  it('يفصل المُضاف عن المُزال', () => {
    expect(diffLists(['أ', 'ب'], ['ب', 'ج'])).toEqual({ added: ['ج'], removed: ['أ'] });
  });

  it('يحذف المفاتيح الفارغة من التفاصيل', () => {
    expect(listDiffDetails('exclusions', ['أ'], ['أ'])).toEqual({});
    expect(listDiffDetails('exclusions', [], ['أ'])).toEqual({ added_exclusions: ['أ'] });
  });
});

describe('buildDetailRows — المفاتيح الجديدة', () => {
  it('يعرض التغييرات كصفوف مقارنة بأسماء عربية', () => {
    const rows = buildDetailRows(
      updateDetails({ name: 'أحمد', is_active: true }, { name: 'محمد', is_active: false }),
    );
    expect(rows).toEqual([
      { label: 'الاسم', kind: 'change', value: null, before: 'أحمد', after: 'محمد' },
      { label: 'نشط', kind: 'change', value: null, before: 'نعم', after: 'لا' },
    ]);
  });

  it('يعرض لقطة القيم كصفوف مفردة، والقوائم مفصولة عناصر', () => {
    const rows = buildDetailRows({
      ...valueDetails({ name: 'أرز' }),
      added_exclusions: ['سمك', 'دجاج'],
    });
    expect(rows[0]).toMatchObject({ label: 'الاسم', kind: 'value', value: 'أرز' });
    expect(rows[1]).toMatchObject({ label: 'محظورات مُضافة', kind: 'value' });
    expect(rows[1].items).toEqual(['سمك', 'دجاج']);
  });

  it('التغييرات تسبق بقية التفاصيل في الترتيب', () => {
    const rows = buildDetailRows({
      ...updateDetails({ code: 'A1' }, { code: 'B2' }, ['code'], { items_count: 3 }),
    });
    expect(rows.map(r => r.kind)).toEqual(['change', 'value']);
  });

  it('يبقى متوافقاً مع الصيغة القديمة previous_/new_', () => {
    const rows = buildDetailRows({ previous_type: 'lunch', new_type: 'dinner' });
    expect(rows[0]).toMatchObject({ kind: 'change', before: 'غداء', after: 'عشاء' });
  });
});
