/**
 * فصل ستيكرات الغداء/العشاء بالتصنيف.
 *
 * المطلوب حرفياً: «نفس آلية الفطور بالضبط — الحار مع الحار، البارد مع البارد،
 * السناك مع السناك». فهذي الاختبارات تثبّت القواعد الأربع التي يطبّقها
 * `displayDetails` في صفحة الفطور، حتى لا تنجرف الصفحتان عن بعض بمرور الوقت.
 */

import { describe, it, expect } from 'vitest';
import { splitDetailByCategory } from '@/components/lunch-dinner-stickers/ld-split';
import type { BeneficiaryReportDetail, ItemCategory, Meal } from '@/lib/types';

const meal = (name: string, is_snack = false): Meal => ({
  id: name, name, type: 'lunch', is_snack, created_at: '',
});

function detail(opts: {
  excluded?: { name: string; category: ItemCategory; alt?: string; altSnack?: boolean }[];
  fixed?: { name: string; category: ItemCategory }[];
}): BeneficiaryReportDetail {
  return {
    beneficiary: { id: 'b1', name: 'مستفيد', code: '1', category: '', created_at: '' },
    excludedItems: (opts.excluded ?? []).map(e => ({
      meal: meal(e.name),
      alternative: e.alt ? meal(e.alt, e.altSnack) : null,
      category: e.category,
    })),
    fixedItems: (opts.fixed ?? []).map(f => ({
      meal: meal(f.name), quantity: 1, category: f.category,
    })),
  };
}

const cats = (groups: ReturnType<typeof splitDetailByCategory>) => groups.map(g => g.category);
const names = (g: ReturnType<typeof splitDetailByCategory>[number]) => ({
  excluded: g.excluded.map(e => e.meal.name),
  alternatives: [
    ...g.excluded.filter(e => e.alternative).map(e => e.alternative!.name),
    ...g.fixed.map(f => f.meal.name),
  ],
});

describe('فصل ستيكرات الغداء/العشاء بالتصنيف', () => {
  it('بلا تخصيصات → ستيكر واحد بلا وسم تصنيف', () => {
    const groups = splitDetailByCategory(detail({}));
    expect(groups).toHaveLength(1);
    expect(groups[0].category).toBeNull();
  });

  it('تصنيف واحد → ستيكر واحد موسوم به', () => {
    const groups = splitDetailByCategory(detail({
      excluded: [{ name: 'رز', category: 'hot', alt: 'معكرونة' }],
    }));
    expect(cats(groups)).toEqual(['hot']);
    expect(names(groups[0])).toEqual({ excluded: ['رز'], alternatives: ['معكرونة'] });
  });

  it('ثلاثة تصنيفات → ثلاثة ستيكرات بترتيب حار ← بارد ← سناك', () => {
    const groups = splitDetailByCategory(detail({
      excluded: [
        { name: 'عصير', category: 'snack', alt: 'ماء' },
        { name: 'رز',   category: 'hot',   alt: 'معكرونة' },
        { name: 'سلطة', category: 'cold',  alt: 'خيار' },
      ],
    }));
    expect(cats(groups)).toEqual(['hot', 'cold', 'snack']);
    expect(names(groups[0])).toEqual({ excluded: ['رز'],   alternatives: ['معكرونة'] });
    expect(names(groups[1])).toEqual({ excluded: ['سلطة'], alternatives: ['خيار'] });
    expect(names(groups[2])).toEqual({ excluded: ['عصير'], alternatives: ['ماء'] });
  });

  it('محظوران في نفس التصنيف يجتمعان في ستيكر واحد — الحار مع الحار', () => {
    const groups = splitDetailByCategory(detail({
      excluded: [
        { name: 'رز',   category: 'hot', alt: 'معكرونة' },
        { name: 'دجاج', category: 'hot', alt: 'لحم' },
        { name: 'سلطة', category: 'cold' },
      ],
    }));
    expect(cats(groups)).toEqual(['hot', 'cold']);
    expect(names(groups[0])).toEqual({
      excluded: ['رز', 'دجاج'], alternatives: ['معكرونة', 'لحم'],
    });
  });

  it('الصنف الثابت يقود ستيكراً مثل المحظور — وإلا اختلط سناك ثابت بكيس حار', () => {
    const groups = splitDetailByCategory(detail({
      excluded: [{ name: 'رز', category: 'hot', alt: 'معكرونة' }],
      fixed:    [{ name: 'تمر', category: 'snack' }],
    }));
    expect(cats(groups)).toEqual(['hot', 'snack']);
    expect(names(groups[0])).toEqual({ excluded: ['رز'], alternatives: ['معكرونة'] });
    expect(names(groups[1])).toEqual({ excluded: [],     alternatives: ['تمر'] });
  });

  it('صنف ثابت وحده بلا أي محظور → ستيكر واحد موسوم بتصنيفه', () => {
    const groups = splitDetailByCategory(detail({ fixed: [{ name: 'تمر', category: 'snack' }] }));
    expect(cats(groups)).toEqual(['snack']);
    expect(names(groups[0])).toEqual({ excluded: [], alternatives: ['تمر'] });
  });

  it('البديل يركب مع تصنيف الصنف المحظور لا مع تصنيفه هو', () => {
    // بديل سناك لصنف حار: الكيس يُبنى على ما يُستبدل، فيبقى في ستيكر الحار
    // ولا يفتح ستيكر سناك ثالثاً.
    const groups = splitDetailByCategory(detail({
      excluded: [
        { name: 'رز',   category: 'hot', alt: 'بسكوت', altSnack: true },
        { name: 'سلطة', category: 'cold' },
      ],
    }));
    expect(cats(groups)).toEqual(['hot', 'cold']);
    expect(names(groups[0])).toEqual({ excluded: ['رز'], alternatives: ['بسكوت'] });
  });

  it('يتجاهل الأصناف بلا اسم — لا تفتح ستيكراً فاضياً', () => {
    const d = detail({ excluded: [{ name: 'رز', category: 'hot' }] });
    d.excludedItems.push({ meal: meal('   '), alternative: null, category: 'cold' });
    const groups = splitDetailByCategory(d);
    expect(cats(groups)).toEqual(['hot']);
  });
});
