import { describe, expect, it } from 'vitest';
import { canonicalDietList, isSameDiet, matchDiet, normalizeDietKey } from '@/lib/diet-types';

describe('normalizeDietKey', () => {
  it('يوحّد التاء المربوطة والهاء', () => {
    expect(normalizeDietKey('حمية')).toBe(normalizeDietKey('حميه'));
  });

  it('يوحّد صور الألف', () => {
    expect(normalizeDietKey('أملاح')).toBe(normalizeDietKey('املاح'));
    expect(normalizeDietKey('إفطار')).toBe(normalizeDietKey('افطار'));
  });

  it('يوحّد الألف المقصورة والياء', () => {
    expect(normalizeDietKey('مصفى')).toBe(normalizeDietKey('مصفي'));
  });

  it('يسقط التشكيل والتطويل', () => {
    expect(normalizeDietKey('حِمْيَة')).toBe(normalizeDietKey('حمية'));
    expect(normalizeDietKey('حــمية')).toBe(normalizeDietKey('حمية'));
  });

  it('يسقط «ال» التعريف فيجمع «قليل الملح» مع «قليل ملح»', () => {
    expect(normalizeDietKey('قليل الملح')).toBe(normalizeDietKey('قليل ملح'));
    expect(normalizeDietKey('حمية السكري')).toBe(normalizeDietKey('حمية سكري'));
  });

  it('لا يمسخ الكلمات القصيرة عند إسقاط «ال»', () => {
    // «الم» أقصر من أن تُقشَّر — تبقى كما هي فلا تتصادم مع «م»
    expect(normalizeDietKey('الم')).not.toBe(normalizeDietKey('م'));
  });

  it('يتجاهل المسافات الزائدة والترقيم وحالة الأحرف', () => {
    expect(normalizeDietKey('  قليل   الملح  ')).toBe(normalizeDietKey('قليل الملح'));
    expect(normalizeDietKey('قليل-الملح')).toBe(normalizeDietKey('قليل الملح'));
    expect(normalizeDietKey('Low Carb')).toBe(normalizeDietKey('low carb'));
  });

  it('يرجّع نصاً فارغاً للقيم الفارغة', () => {
    expect(normalizeDietKey('')).toBe('');
    expect(normalizeDietKey(null)).toBe('');
    expect(normalizeDietKey(undefined)).toBe('');
    expect(normalizeDietKey('   ')).toBe('');
  });

  it('لا يخلط نظامين مختلفين فعلاً', () => {
    expect(normalizeDietKey('سكري')).not.toBe(normalizeDietKey('كلوي'));
  });
});

describe('isSameDiet', () => {
  it('يطابق الإملاءات المتكافئة', () => {
    expect(isSameDiet('حمية', 'حميه')).toBe(true);
    expect(isSameDiet('قليل الملح', 'قليل  الملح')).toBe(true);
  });

  it('لا يعتبر الفارغ مطابقاً للفارغ', () => {
    expect(isSameDiet('', '')).toBe(false);
    expect(isSameDiet(null, undefined)).toBe(false);
  });

  it('يفرّق بين نظامين مختلفين', () => {
    expect(isSameDiet('سكري', 'ضغط')).toBe(false);
  });
});

describe('canonicalDietList', () => {
  it('يجمع الإملاءات المتكافئة في اسم واحد', () => {
    const list = canonicalDietList(['حمية', 'حميه', 'حمية', 'سكري']);
    expect(list).toHaveLength(2);
    expect(list).toContain('سكري');
    expect(list).toContain('حمية'); // الأكثر تكراراً
  });

  it('يختار الإملاء الأكثر تكراراً ممثّلاً', () => {
    expect(canonicalDietList(['حميه', 'حميه', 'حميه', 'حمية'])).toEqual(['حميه']);
  });

  it('عند تساوي التكرار يختار الأطول', () => {
    expect(canonicalDietList(['قليل الملح', 'قليل ملح'])).toEqual(['قليل الملح']);
  });

  it('عند تساوي التكرار والطول يحسم الترتيب الأبجدي', () => {
    // «حمية» و«حميه» بنفس الطول والتكرار — الاختيار ثابت لا عشوائي
    expect(canonicalDietList(['حميه', 'حمية'])).toEqual(canonicalDietList(['حمية', 'حميه']));
    expect(canonicalDietList(['حميه', 'حمية'])).toHaveLength(1);
  });

  it('يتجاهل الفراغات والقيم الفارغة', () => {
    expect(canonicalDietList(['', '   ', null, undefined, 'سكري'])).toEqual(['سكري']);
  });

  it('يرتّب عربياً', () => {
    const list = canonicalDietList(['كلوي', 'سكري', 'ضغط']);
    expect(list).toEqual([...list].sort((a, b) => a.localeCompare(b, 'ar')));
  });

  it('يرجّع قائمة فارغة لمدخلات فارغة', () => {
    expect(canonicalDietList([])).toEqual([]);
    expect(canonicalDietList([null, ''])).toEqual([]);
  });
});

describe('matchDiet', () => {
  const existing = ['حمية', 'سكري', 'قليل الملح'];

  it('يستخدم المسجَّل بدل إنشاء نسخة بإملاء مختلف', () => {
    expect(matchDiet('حميه', existing)).toBe('حمية');
    expect(matchDiet('  حِمْيَة ', existing)).toBe('حمية');
    expect(matchDiet('قليل  الملح', existing)).toBe('قليل الملح');
  });

  it('يرجّع الجديد منظّفاً لو ما كان مسجّلاً', () => {
    expect(matchDiet('  كلوي  ', existing)).toBe('كلوي');
  });

  it('يرجّع فارغاً للمدخل الفارغ', () => {
    expect(matchDiet('   ', existing)).toBe('');
  });
});
