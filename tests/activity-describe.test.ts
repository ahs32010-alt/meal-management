import { describe, expect, it } from 'vitest';
import {
  PAGE_DETAIL_KEY,
  buildDetailRows,
  describeOperation,
  operationLabel,
  pageLabel,
  pageOf,
  formatDetailValue,
  type ActivityLike,
} from '@/lib/activity-describe';

function row(over: Partial<ActivityLike> = {}): ActivityLike {
  return {
    action: 'update',
    entity_type: 'meal',
    entity_name: 'أرز بخاري',
    user_name: 'أحمد',
    user_email: 'a@x.com',
    details: null,
    ...over,
  };
}

describe('pageLabel', () => {
  it('maps a known route to its Arabic name', () => {
    expect(pageLabel('/meals')).toBe('الأصناف');
    expect(pageLabel('/')).toBe('الرئيسية');
  });

  it('prefers the longest matching prefix', () => {
    // /beneficiaries/bulk must not resolve to /beneficiaries
    expect(pageLabel('/beneficiaries/bulk')).toBe('المستفيدون — التخصيص الجماعي');
    expect(pageLabel('/beneficiaries')).toBe('المستفيدون');
  });

  it('does not match a route that merely shares a prefix string', () => {
    expect(pageLabel('/mealsomething')).toBe('/mealsomething');
  });

  it('returns null for a missing path', () => {
    expect(pageLabel(null)).toBeNull();
  });
});

describe('pageOf', () => {
  it('reads the reserved page key out of details', () => {
    expect(pageOf({ [PAGE_DETAIL_KEY]: '/menu' })).toBe('/menu');
  });

  it('returns null when absent or not a string', () => {
    expect(pageOf(null)).toBeNull();
    expect(pageOf({ [PAGE_DETAIL_KEY]: 3 })).toBeNull();
  });
});

describe('operationLabel', () => {
  it('sharpens a vague action using the source', () => {
    expect(operationLabel(row({ details: { source: 'menu_multiplier' } }), 'تعديل'))
      .toBe('تعديل مضاعِف الصنف');
  });

  it('falls back to the plain action when there is no source', () => {
    expect(operationLabel(row(), 'تعديل')).toBe('تعديل');
  });

  it('falls back for an unrecognised source', () => {
    expect(operationLabel(row({ details: { source: 'something_new' } }), 'تعديل')).toBe('تعديل');
  });
});

describe('describeOperation', () => {
  it('names the user, the verb, the item and the page', () => {
    const s = describeOperation(row({
      action: 'create',
      entity_type: 'beneficiary',
      entity_name: 'خالد',
      details: { [PAGE_DETAIL_KEY]: '/beneficiaries' },
    }));
    expect(s).toBe('أحمد أضاف مستفيداً «خالد» — صفحة «المستفيدون»');
  });

  it('includes the precise operation when a source is present', () => {
    const s = describeOperation(row({
      action: 'update',
      details: { source: 'excel_import', [PAGE_DETAIL_KEY]: '/meals' },
    }));
    expect(s).toContain('عن طريق استيراد من ملف Excel');
    expect(s).toContain('صفحة «الأصناف»');
  });

  it('falls back to the email when the name is missing', () => {
    expect(describeOperation(row({ user_name: null }))).toContain('a@x.com');
  });

  it('omits the page clause when the page is unknown', () => {
    expect(describeOperation(row())).not.toContain('صفحة');
  });
});

describe('buildDetailRows', () => {
  it('pairs previous_x with new_x into one before/after row', () => {
    const rows = buildDetailRows({ previous_type: 'hot', new_type: 'cold' });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ label: 'النوع', before: 'ساخن', after: 'بارد', value: null });
  });

  it('pairs the bare previous/new keys', () => {
    const rows = buildDetailRows({ previous: 'Rice', new: 'Ruz' });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ label: 'القيمة', before: 'Rice', after: 'Ruz' });
  });

  it('hides the source and page keys', () => {
    const rows = buildDetailRows({ source: 'menu_edit', [PAGE_DETAIL_KEY]: '/menu' });
    expect(rows).toEqual([]);
  });

  it('translates keys to Arabic and drops empty values', () => {
    const rows = buildDetailRows({ items_count: 4, villa: '', code: null, is_snack: true });
    expect(rows.map(r => r.label)).toEqual(['عدد البنود', 'سناك']);
    expect(rows[1].value).toBe('نعم');
  });

  it('returns nothing for null details', () => {
    expect(buildDetailRows(null)).toEqual([]);
  });
});

describe('formatDetailValue', () => {
  it('renders booleans in Arabic', () => {
    expect(formatDetailValue(true)).toBe('نعم');
    expect(formatDetailValue(false)).toBe('لا');
  });

  it('summarises long lists instead of dumping them', () => {
    const out = formatDetailValue(Array.from({ length: 30 }, (_, i) => `id-${i}`));
    expect(out).toContain('(30 إجمالاً)');
    expect(out).not.toContain('id-9');
  });

  it('lists short arrays in full', () => {
    expect(formatDetailValue(['hot', 'cold'])).toBe('ساخن، بارد');
  });

  it('flattens nested objects with Arabic keys', () => {
    expect(formatDetailValue({ items_count: 2 })).toBe('عدد البنود: 2');
  });

  it('handles empties', () => {
    expect(formatDetailValue(null)).toBe('—');
    expect(formatDetailValue([])).toBe('لا شيء');
  });
});
