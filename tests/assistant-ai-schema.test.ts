import { describe, expect, it } from 'vitest';
import { validateToolInput, MAX_COMMAND_LENGTH } from '@/lib/assistant/ai/schema';
import { TOOL_DEFS } from '@/lib/assistant/ai/tools';

/**
 * بوّابة التحقّق من مخرجات النموذج.
 *
 * القاعدة: متساهلة حيث لا ضرر (النماذج ترسل «15» بدل 15)، صارمة حيث يهمّ
 * (المعرّفات والقوائم المغلقة والتواريخ) — لأن قيمة خاطئة هناك تعني استعلاماً
 * على بيانات غير التي قصدها المستخدم، لا مجرد شكل رديء.
 */

describe('التحقّق — تغطية الأدوات', () => {
  it('كل أداة معلَنة للنموذج لها مخطط تحقّق', () => {
    // أداة بلا مخطط تمر بلا فحص — وهذا بالضبط ما تمنعه هذه الطبقة.
    for (const tool of TOOL_DEFS) {
      const result = validateToolInput(tool.name, {});
      expect(result, `الأداة ${tool.name} بلا مخطط`).not.toEqual({
        ok: false,
        error: `أداة غير معروفة: ${tool.name}`,
      });
    }
  });

  it('يرفض أداة غير معروفة', () => {
    const r = validateToolInput('drop_all_tables', {});
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('أداة غير معروفة');
  });
});

describe('التحقّق — متساهل حيث لا ضرر', () => {
  it('يقبل الأرقام كنص ويحوّلها', () => {
    const r = validateToolInput('search_people', { limit: '15' });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.args.limit).toBe(15);
  });

  it('يقبل المنطقي كنص', () => {
    const r = validateToolInput('search_people', { active_only: 'true' });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.args.active_only).toBe(true);
  });

  it('يقصّ الحد داخل المدى المسموح بدل رفضه', () => {
    const big = validateToolInput('search_meals', { limit: 9999 });
    expect(big.ok).toBe(true);
    if (big.ok) expect(big.args.limit).toBe(40);

    const small = validateToolInput('search_meals', { limit: 0 });
    expect(small.ok).toBe(true);
    if (small.ok) expect(small.args.limit).toBe(1);
  });

  it('النص الفارغ يعني «غير محدّد» لا بحثاً عن فراغ', () => {
    const r = validateToolInput('search_people', { query: '   ' });
    expect(r.ok).toBe(true);
    // نفس سلوك str() السابق حرفياً — فما ينكسر بحث كان يعمل.
    if (r.ok) expect('query' in r.args).toBe(false);
  });

  it('يتجاهل المعاملات الزائدة بدل أن يفشل', () => {
    const r = validateToolInput('count_people', { entity_type: 'companion', nonsense: 1 });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.args.entity_type).toBe('companion');
      expect('nonsense' in r.args).toBe(false);
    }
  });

  it('المعاملات المفقودة أو غير الكائنية تُقرأ كائناً فارغاً', () => {
    for (const raw of [undefined, null, 'نص', 42, []]) {
      expect(validateToolInput('list_pages', raw).ok).toBe(true);
    }
  });
});

describe('التحقّق — صارم حيث يهمّ', () => {
  it('يرفض معرّفاً ليس UUID', () => {
    const r = validateToolInput('get_person', { id: 'أحمد' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('UUID');
  });

  it('يقبل معرّفاً صحيحاً', () => {
    const r = validateToolInput('get_person', { id: '3f7c1a20-0b6e-4c2a-9d4e-8f1b2c3d4e5f' });
    expect(r.ok).toBe(true);
  });

  it('يرفض المعرّف الغائب — الأداة بلا معرّف تقرأ لا شيء', () => {
    expect(validateToolInput('get_order', {}).ok).toBe(false);
  });

  it('يرفض نوع وجبة خارج القائمة', () => {
    expect(validateToolInput('get_menu', { meal_type: 'سناك' }).ok).toBe(false);
    expect(validateToolInput('get_menu', { meal_type: 'lunch' }).ok).toBe(true);
  });

  it('يرفض تاريخاً بغير صيغة ISO — يوم خاطئ يعني أرقام يوم آخر', () => {
    expect(validateToolInput('order_summary', { date: '19/08/2026' }).ok).toBe(false);
    expect(validateToolInput('order_summary', { date: '2026-08-19' }).ok).toBe(true);
  });

  it('يرفض رقم أسبوع خارج الدورة (١–٤) ويوماً خارج الأسبوع (٠–٦)', () => {
    expect(validateToolInput('get_menu', { week_number: 7 }).ok).toBe(false);
    expect(validateToolInput('get_menu', { week_number: 4 }).ok).toBe(true);
    expect(validateToolInput('get_menu', { day_of_week: 9 }).ok).toBe(false);
    expect(validateToolInput('get_menu', { day_of_week: 0 }).ok).toBe(true);
  });

  it('يرفض نوع كيان مخترعاً', () => {
    expect(validateToolInput('count_people', { entity_type: 'زائر' }).ok).toBe(false);
  });
});

describe('التحقّق — أداة اقتراح التعديل', () => {
  it('يرفض أمراً فارغاً', () => {
    expect(validateToolInput('propose_change', { command: '   ' }).ok).toBe(false);
    expect(validateToolInput('propose_change', {}).ok).toBe(false);
  });

  it('يقبل أمراً عربياً قياسياً', () => {
    const r = validateToolInput('propose_change', { command: 'امنع أحمد من الفول' });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.args.command).toBe('امنع أحمد من الفول');
  });

  it('يسقّف طول الأمر — مدخل المحلّل ليس مفتوحاً', () => {
    const r = validateToolInput('propose_change', { command: 'ا'.repeat(MAX_COMMAND_LENGTH + 1) });
    expect(r.ok).toBe(false);
  });
});

describe('التحقّق — رسالة الفشل تُعيد النموذج للصواب', () => {
  it('تذكر اسم الأداة والحقل والسبب بالعربية', () => {
    const r = validateToolInput('get_person', { id: 'x' });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      // النموذج يقرأ هذه الرسالة ويصحّح نداءه — فالغموض فيها يكلّف دورة كاملة.
      expect(r.error).toContain('get_person');
      expect(r.error).toContain('id');
    }
  });
});
