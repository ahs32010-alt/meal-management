import { describe, expect, it } from 'vitest';
import { parseCommand, stripLeadingLam, wordVariants } from '@/lib/assistant/commands';
import { parseQuestion } from '@/lib/assistant/parse';

describe('wordVariants', () => {
  it('يقشّر السوابق الملتصقة', () => {
    expect(wordVariants('والثاني')).toContain('الثاني');
    expect(wordVariants('لفطور')).toContain('فطور');
    expect(wordVariants('للسبت')).toContain('السبت');
    expect(wordVariants('بالاسبوع')).toContain('الاسبوع');
  });

  it('لا يقشّر الكلمات القصيرة', () => {
    expect(wordVariants('لي')).toEqual(['لي']);
  });
});

describe('stripLeadingLam', () => {
  it('يشيل لام الجر من أول كلمة فقط', () => {
    expect(stripLeadingLam('لاحمد العلي')).toBe('احمد العلي');
    expect(stripLeadingLam('احمد العلي')).toBe('احمد العلي');
  });
});

describe('parseCommand — الاستبدال', () => {
  it('يفهم «خليه ياكل بيض بدال الفول»', () => {
    expect(parseCommand('اللي اسمه أحمد العلي خليه ياكل بيض بدال الفول')).toEqual({
      kind: 'set_exclusion',
      person: 'احمد العلي',
      meal: 'الفول',
      alternative: 'بيض',
    });
  });

  it('يفهم الصيغة المختصرة بكلمة «بدل»', () => {
    expect(parseCommand('خلّي أحمد العلي ياكل بيض بدل الفول')).toMatchObject({
      kind: 'set_exclusion',
      meal: 'الفول',
      alternative: 'بيض',
    });
  });

  it('يفهم المنع بلا بديل', () => {
    expect(parseCommand('امنع الفول عن أحمد العلي')).toEqual({
      kind: 'set_exclusion',
      person: 'احمد العلي',
      meal: 'الفول',
    });
  });

  it('يميّز رفع المنع عن فرضه', () => {
    expect(parseCommand('احذف منع الفول عن أحمد العلي')).toEqual({
      kind: 'clear_exclusion',
      person: 'احمد العلي',
      meal: 'الفول',
    });
  });
});

describe('parseCommand — الأصناف الثابتة', () => {
  it('يفهم الأمر الكامل مع أيام متعددة', () => {
    expect(parseCommand('حط لأحمد العلي صنف ثابت بيض يوم السبت والثلاثاء فطور')).toEqual({
      kind: 'add_fixed',
      person: 'لاحمد العلي',
      meal: 'بيض',
      days: [6, 2],
      mealType: 'breakfast',
      quantity: 1,
    });
  });

  it('يلتقط الكمية', () => {
    expect(parseCommand('حط لأحمد صنف ثابت بيض يوم السبت فطور عدد 2')).toMatchObject({
      kind: 'add_fixed',
      quantity: 2,
    });
  });

  it('يطلب اسم الشخص لما يكون ضميراً مبهماً', () => {
    expect(parseCommand('حط له صنف ثابت يوم السبت والثلاثاء بيض')).toMatchObject({
      kind: 'gap',
      intended: 'add_fixed',
      missing: 'person',
    });
  });

  it('يطلب الأيام لو ما ذُكرت', () => {
    expect(parseCommand('حط لأحمد العلي صنف ثابت بيض فطور')).toMatchObject({
      kind: 'gap',
      missing: 'days',
    });
  });

  it('يفهم الحذف مع «عن» بالترتيب الصحيح', () => {
    expect(parseCommand('احذف الصنف الثابت بيض عن أحمد العلي')).toMatchObject({
      kind: 'remove_fixed',
      person: 'احمد العلي',
      meal: 'بيض',
    });
  });
});

describe('parseCommand — الحالة والحقول', () => {
  it('يفهم التعطيل والتفعيل', () => {
    expect(parseCommand('عطّل أحمد العلي')).toEqual({
      kind: 'set_person_status',
      person: 'احمد العلي',
      active: false,
    });
    expect(parseCommand('فعّل أحمد العلي')).toMatchObject({ active: true });
  });

  it('يفهم تعديل الفيلا', () => {
    expect(parseCommand('غيّر فيلا أحمد العلي إلى 3')).toEqual({
      kind: 'set_person_field',
      person: 'احمد العلي',
      field: 'villa',
      value: '3',
    });
  });

  it('يفهم تعديل الحمية', () => {
    expect(parseCommand('غيّر حمية أحمد العلي إلى سكري')).toMatchObject({
      field: 'diet_type',
      value: 'سكري',
    });
  });

  it('يطلب القيمة لو ناقصة', () => {
    expect(parseCommand('غيّر فيلا أحمد العلي')).toMatchObject({
      kind: 'gap',
      missing: 'value',
    });
  });
});

describe('parseCommand — قائمة الطعام والأصناف', () => {
  it('يفهم إضافة صنف للقائمة', () => {
    expect(parseCommand('أضف بيض لفطور السبت الأسبوع الثاني')).toEqual({
      kind: 'add_menu_item',
      meal: 'بيض',
      week: 2,
      days: [6],
      mealType: 'breakfast',
      entityType: undefined,
      category: undefined,
    });
  });

  it('يفهم الحذف من القائمة', () => {
    expect(parseCommand('احذف بيض من فطور السبت الأسبوع الثاني')).toMatchObject({
      kind: 'remove_menu_item',
      week: 2,
      days: [6],
    });
  });

  it('يفهم إنشاء صنف جديد', () => {
    expect(parseCommand('أضف صنف جديد اسمه شوربة عدس غداء')).toMatchObject({
      kind: 'create_meal',
      name: 'شوربة عدس',
      mealType: 'lunch',
    });
  });
});

describe('parseCommand — الفصل عن الأسئلة', () => {
  it('يرجّع null للأسئلة الاستعلامية فلا تُعامل كأوامر', () => {
    expect(parseCommand('كم عدد المستفيدين؟')).toBeNull();
    expect(parseCommand('متى يقدم البرتقال')).toBeNull();
    expect(parseCommand('مين ممنوع عليه السمك')).toBeNull();
    expect(parseCommand('توزيع المستفيدين حسب الفيلا')).toBeNull();
    expect(parseCommand('')).toBeNull();
  });

  it('الأسئلة تبقى مفهومة عند محلل الاستعلام', () => {
    expect(parseQuestion('كم عدد المستفيدين؟').kind).toBe('entity_count');
  });
});
