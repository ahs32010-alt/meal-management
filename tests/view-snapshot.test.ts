/**
 * لقطة العرض الفورية.
 *
 * تعاقدها البسيط: تعطي آخر ما عُرض ليُرسم فوراً بدل شاشة فاضية. لا تمنع طلباً
 * ولا تؤجّله — فالبيانات تبقى طازجة، والذي اختفى هو الانتظار وحده.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { readSnapshot, writeSnapshot, clearSnapshots } from '@/lib/view-snapshot';

beforeEach(() => clearSnapshots());

describe('لقطة العرض', () => {
  it('ترجع null قبل أول حفظ — فتظهر شاشة التحميل كالمعتاد', () => {
    expect(readSnapshot('meals:beneficiary')).toBeNull();
  });

  it('ترجع آخر ما حُفظ', () => {
    writeSnapshot('meals:beneficiary', [{ id: 'm1' }]);
    expect(readSnapshot('meals:beneficiary')).toEqual([{ id: 'm1' }]);
  });

  it('الكتابة الأحدث تدهس الأقدم — لا تتراكم لقطات قديمة', () => {
    writeSnapshot('k', [1]);
    writeSnapshot('k', [1, 2]);
    expect(readSnapshot('k')).toEqual([1, 2]);
  });

  it('المفاتيح معزولة — المستفيدون لا يظهرون مكان المرافقين', () => {
    writeSnapshot('bens:beneficiary', ['أحمد']);
    writeSnapshot('bens:companion', ['سالم']);
    expect(readSnapshot('bens:beneficiary')).toEqual(['أحمد']);
    expect(readSnapshot('bens:companion')).toEqual(['سالم']);
  });

  it('تُميّز القيمة المحفوظة undefined عن غير الموجودة', () => {
    writeSnapshot('k', undefined);
    expect(readSnapshot('k')).toBeUndefined();
    expect(readSnapshot('غير-موجود')).toBeNull();
  });

  it('clearSnapshots ببادئة يمسح ما يخصّها وحده', () => {
    writeSnapshot('bens:a', [1]);
    writeSnapshot('meals:a', [2]);
    clearSnapshots('bens:');
    expect(readSnapshot('bens:a')).toBeNull();
    expect(readSnapshot('meals:a')).toEqual([2]);
  });

  it('clearSnapshots بلا وسيط يمسح الكل — لتسجيل الخروج', () => {
    writeSnapshot('bens:a', [1]);
    writeSnapshot('meals:a', [2]);
    clearSnapshots();
    expect(readSnapshot('bens:a')).toBeNull();
    expect(readSnapshot('meals:a')).toBeNull();
  });
});
