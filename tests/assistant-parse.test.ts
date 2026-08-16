import { describe, expect, it } from 'vitest';
import { lightNorm, parseQuestion } from '@/lib/assistant/parse';

describe('lightNorm', () => {
  it('keeps hamza so غداء (lunch) stays distinct from غدا (tomorrow)', () => {
    expect(lightNorm('الغداء')).toBe('الغداء');
    expect(lightNorm('غداً')).toBe('غدا');
  });

  it('converts Arabic-Indic digits before stripping diacritics', () => {
    expect(lightNorm('الأسبوع ٣')).toBe('الاسبوع 3');
  });
});

describe('parseQuestion — الأسئلة الأساسية', () => {
  it('يفهم "متى اليوم اللي فيه الصنف الفلاني"', () => {
    const i = parseQuestion('متى اليوم اللي فيه صنف البرتقال');
    expect(i.kind).toBe('meal_schedule');
    if (i.kind === 'meal_schedule') expect(i.subject).toBe('البرتقال');
  });

  it('يفهم سؤال الكميات مع الأسبوع القادم ونوع الكيان', () => {
    const i = parseQuestion('كم عدد المستفيدين اللي بياكلون برتقال الاسبوع الجاي كامل');
    expect(i.kind).toBe('meal_consumption');
    if (i.kind === 'meal_consumption') {
      expect(i.subject).toBe('برتقال');
      expect(i.weeks).toEqual({ mode: 'next' });
      expect(i.entityType).toBe('beneficiary');
    }
  });

  it('يفهم الأسبوع الصريح بالترتيب', () => {
    const i = parseQuestion('كم حصة من الأرز في الأسبوع الثالث؟');
    expect(i.kind).toBe('meal_consumption');
    if (i.kind === 'meal_consumption') expect(i.weeks).toEqual({ mode: 'explicit', weeks: [3] });
  });

  it('يفهم الأسبوع بالرقم', () => {
    const i = parseQuestion('كم حصة من الأرز في الأسبوع 2؟');
    if (i.kind === 'meal_consumption') expect(i.weeks).toEqual({ mode: 'explicit', weeks: [2] });
    else throw new Error(`expected meal_consumption, got ${i.kind}`);
  });

  it('يجمع أكثر من أسبوع', () => {
    const i = parseQuestion('كم عدد حصص السمك في الاسبوع الاول والثاني');
    if (i.kind === 'meal_consumption') expect(i.weeks).toEqual({ mode: 'explicit', weeks: [1, 2] });
    else throw new Error(`expected meal_consumption, got ${i.kind}`);
  });

  it('يفهم سؤال الممنوعات', () => {
    const i = parseQuestion('مين ممنوع عليه السمك؟');
    expect(i.kind).toBe('meal_exclusions');
    if (i.kind === 'meal_exclusions') expect(i.subject).toBe('السمك');
  });

  it('يفهم البدائل كسؤال ممنوعات', () => {
    const i = parseQuestion('وش بدائل الفول؟');
    expect(i.kind).toBe('meal_exclusions');
    if (i.kind === 'meal_exclusions') expect(i.subject).toBe('الفول');
  });

  it('يفهم قائمة يوم معيّن مع الأسبوع', () => {
    const i = parseQuestion('وش القائمة يوم الثلاثاء الاسبوع الثاني');
    expect(i.kind).toBe('menu_day');
    if (i.kind === 'menu_day') {
      expect(i.days).toEqual([2]);
      expect(i.weeks).toEqual({ mode: 'explicit', weeks: [2] });
    }
  });

  it('يميّز الغداء (وجبة) عن بكرة (تاريخ)', () => {
    const lunch = parseQuestion('وش الغداء يوم الخميس');
    expect(lunch.kind).toBe('menu_day');
    if (lunch.kind === 'menu_day') {
      expect(lunch.mealType).toBe('lunch');
      expect(lunch.days).toEqual([4]);
    }

    const tomorrow = parseQuestion('وش القائمة بكرة');
    expect(tomorrow.kind).toBe('menu_day');
    if (tomorrow.kind === 'menu_day') expect(tomorrow.date).toBe('tomorrow');
  });

  it('يفهم عدّ الكيانات بلا موضوع', () => {
    const i = parseQuestion('كم عدد المستفيدين؟');
    expect(i.kind).toBe('entity_count');
    if (i.kind === 'entity_count') {
      expect(i.entityType).toBe('beneficiary');
      expect(i.activeOnly).toBeNull();
    }
  });

  it('يفهم فلتر الحالة والفيلا', () => {
    const i = parseQuestion('كم عدد المرافقين النشطين في فيلا 3');
    expect(i.kind).toBe('entity_count');
    if (i.kind === 'entity_count') {
      expect(i.entityType).toBe('companion');
      expect(i.activeOnly).toBe(true);
      expect(i.villa).toBe('3');
    }
  });

  it('يفهم التوزيع الإحصائي', () => {
    expect(parseQuestion('توزيع المستفيدين حسب الفيلا')).toMatchObject({
      kind: 'entity_breakdown',
      by: 'villa',
    });
    expect(parseQuestion('توزيع المستفيدين حسب الحمية')).toMatchObject({
      kind: 'entity_breakdown',
      by: 'diet',
    });
  });

  it('يفهم أكثر الأصناف استهلاكاً', () => {
    const i = parseQuestion('أكثر 5 أصناف استهلاكاً هذا الأسبوع');
    expect(i.kind).toBe('top_meals');
    if (i.kind === 'top_meals') {
      expect(i.limit).toBe(5);
      expect(i.weeks).toEqual({ mode: 'current' });
    }
  });

  it('يفهم طلب بطاقة شخص', () => {
    const i = parseQuestion('معلومات أحمد العلي');
    expect(i.kind).toBe('entity_profile');
    if (i.kind === 'entity_profile') expect(i.subject).toBe('احمد العلي');
  });

  it('يعتبر الاسم المجرّد استكشافاً', () => {
    const i = parseQuestion('برتقال');
    expect(i.kind).toBe('lookup');
    if (i.kind === 'lookup') expect(i.subject).toBe('برتقال');
  });

  it('يرجّع مساعدة للسؤال الفارغ أو غير المفهوم', () => {
    expect(parseQuestion('')).toEqual({ kind: 'help', reason: 'empty' });
    expect(parseQuestion('؟؟؟')).toEqual({ kind: 'help', reason: 'empty' });
    expect(parseQuestion('هل')).toEqual({ kind: 'help', reason: 'unknown' });
  });
});

describe('parseQuestion — الصمود أمام صيغ الكتابة', () => {
  it('يتجاهل غياب الهمزات', () => {
    const a = parseQuestion('متى يقدم الارز');
    const b = parseQuestion('متى يُقدَّم الأرز');
    expect(a.kind).toBe('meal_schedule');
    expect(b.kind).toBe('meal_schedule');
    if (a.kind === 'meal_schedule' && b.kind === 'meal_schedule') {
      expect(a.subject).toBe(b.subject);
    }
  });

  it('يقبل الأرقام الهندية في رقم الأسبوع', () => {
    const i = parseQuestion('كم حصة من السمك في الأسبوع ٤');
    if (i.kind === 'meal_consumption') expect(i.weeks).toEqual({ mode: 'explicit', weeks: [4] });
    else throw new Error(`expected meal_consumption, got ${i.kind}`);
  });

  it('لا يعتبر "اليوم" تاريخاً داخل سؤال جدولة', () => {
    const i = parseQuestion('متى اليوم اللي فيه السمك');
    expect(i.kind).toBe('meal_schedule');
    if (i.kind === 'meal_schedule') expect(i.subject).toBe('السمك');
  });

  it('يفهم الوجبة مع سؤال الكميات', () => {
    const i = parseQuestion('كم حصة عشاء من الدجاج الأسبوع الحالي');
    expect(i.kind).toBe('meal_consumption');
    if (i.kind === 'meal_consumption') {
      expect(i.mealType).toBe('dinner');
      expect(i.weeks).toEqual({ mode: 'current' });
      expect(i.subject).toBe('الدجاج');
    }
  });
});
