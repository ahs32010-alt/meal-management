import { afterEach, describe, expect, it } from 'vitest';
import { dietLines } from '@/components/lunch-dinner-stickers/ld-sticker-card';
import { dietEnglishNames } from '@/components/lunch-dinner-stickers/ld-types';

describe('ستيكر الغداء والعشاء — الاسم الإنجليزي للنظام', () => {
  afterEach(() => dietEnglishNames.clear());

  it('اسم صفحة الأنظمة يغلب جدول الترجمة الثابت', () => {
    expect(dietLines('سكري').en).toBe('Diabetic diet');
    dietEnglishNames.set('سكري', 'Diabetes');
    expect(dietLines('سكري')).toEqual({ ar: 'سكري', en: 'Diabetes' });
  });

  it('أكثر من نظام: كل جزء من مصدره، وجزء بلا ترجمة = سطر فاضي', () => {
    dietEnglishNames.set('حمية خاصة', 'Special diet');
    expect(dietLines('سكري - حمية خاصة').en).toBe('Diabetic diet - Special diet');
    expect(dietLines('سكري - نظام مجهول').en).toBe('');
  });
});
