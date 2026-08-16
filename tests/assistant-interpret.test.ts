import { describe, expect, it } from 'vitest';
import { interpret, type DialogContext, type Interpretation, type Pending } from '@/lib/assistant/interpret';
import { buildIndex, scanMentions } from '@/lib/assistant/lexicon';
import { lightNorm } from '@/lib/assistant/parse';

const people = [
  { id: 'p1', name: 'أحمد العلي', code: 'B001' },
  { id: 'p2', name: 'سارة المطيري', code: 'B002' },
  { id: 'p3', name: 'عبدالله الشمري', code: 'B003' },
];

const meals = [
  { id: 'm1', name: 'فول', type: 'breakfast' as const },
  { id: 'm2', name: 'بيض مسلوق', type: 'breakfast' as const },
  { id: 'm3', name: 'أرز بخاري', type: 'lunch' as const },
  { id: 'm4', name: 'سمك مشوي', type: 'dinner' as const },
];

const run = (text: string, context?: DialogContext, pending?: Pending): Interpretation =>
  interpret({ text, people, meals, context, pending });

const cmd = (r: Interpretation) => {
  if (r.kind !== 'command') throw new Error(`expected command, got ${r.kind}`);
  return r.command;
};
const askOf = (r: Interpretation) => {
  if (r.kind !== 'ask') throw new Error(`expected ask, got ${r.kind}`);
  return r;
};

// ── مسح الكيانات ───────────────────────────────────────────────────────────

describe('scanMentions — إيجاد الأسماء داخل جملة حرّة', () => {
  const idx = buildIndex(meals, (m) => [m.name]);
  const words = (t: string) => lightNorm(t).split(' ').filter(Boolean);

  it('يلقى الاسم المركّب كاملاً لا مجزّأً', () => {
    const found = scanMentions(words('حط بيض مسلوق يوم السبت'), idx);
    expect(found.map((f) => f.item.id)).toEqual(['m2']);
    expect(found[0].text).toBe('بيض مسلوق');
  });

  it('يلقى اسمين في جملة واحدة بالترتيب', () => {
    const found = scanMentions(words('بيض مسلوق بدل الفول'), idx);
    expect(found.map((f) => f.item.id)).toEqual(['m2', 'm1']);
  });

  it('لا يخلط سلسلة فرعية بكلمة مستقلة', () => {
    // «اول» ترد داخل «يتناول» لكنها ليست كلمة فيها
    const noise = buildIndex([{ id: 'x', name: 'اول' }], (m) => [m.name]);
    expect(scanMentions(words('يتناول الطعام'), noise)).toHaveLength(0);
  });
});

// ── الاستبدال ──────────────────────────────────────────────────────────────

describe('interpret — الاستبدال بصياغات مختلفة', () => {
  const expected = { kind: 'set_exclusion', person: 'أحمد العلي', meal: 'فول', alternative: 'بيض مسلوق' };

  it('الصيغة المباشرة', () => {
    expect(cmd(run('خلّي أحمد العلي ياكل بيض مسلوق بدل الفول'))).toEqual(expected);
  });

  it('الشخص أولاً ثم الصنفان بعد «بدل»', () => {
    expect(cmd(run('أحمد العلي بدل الفول حط له بيض مسلوق'))).toEqual(expected);
  });

  it('الصنف أولاً والشخص آخراً بلام الجر', () => {
    expect(cmd(run('بيض مسلوق بدال الفول لاحمد العلي'))).toEqual(expected);
  });

  it('يحتمل المدّ الكتابي ويستعين بالسياق للضمير', () => {
    const r = run('خلييييه ياكل بيض بدل الفول', { personId: 'p1' });
    expect(cmd(r)).toEqual(expected);
    if (r.kind === 'command') expect(r.usedContext.join()).toContain('أحمد العلي');
  });

  it('يسأل عن البديل لو ذُكر الممنوع وحده', () => {
    // ما بعد «بدل» هو الممنوع، فالبديل ناقص
    const a = askOf(run('خلّي أحمد العلي ياكل بدل الفول'));
    expect(a.field).toBe('altMeal');
    expect(a.question).toContain('فول');
  });

  it('يكمل البديل من جواب السؤال', () => {
    const a = askOf(run('خلّي أحمد العلي ياكل بدل الفول'));
    expect(cmd(run('بيض مسلوق', undefined, a.pending))).toEqual({
      kind: 'set_exclusion',
      person: 'أحمد العلي',
      meal: 'فول',
      alternative: 'بيض مسلوق',
    });
  });
});

// ── المنع ──────────────────────────────────────────────────────────────────

describe('interpret — المنع بصياغات مختلفة', () => {
  it('صيغة الأمر مع «عن»', () => {
    expect(cmd(run('امنع السمك المشوي عن سارة'))).toMatchObject({
      kind: 'set_exclusion',
      person: 'سارة المطيري',
      meal: 'سمك مشوي',
    });
  });

  it('صيغة الوصف «ممنوعة من»', () => {
    expect(cmd(run('سارة المطيري ممنوعة من الأرز'))).toMatchObject({
      kind: 'set_exclusion',
      person: 'سارة المطيري',
      meal: 'أرز بخاري',
    });
  });

  it('صيغة عامية «ما ياكل»', () => {
    expect(cmd(run('ابي احمد ما ياكل فول'))).toMatchObject({
      kind: 'set_exclusion',
      person: 'أحمد العلي',
      meal: 'فول',
    });
  });
});

// ── الأصناف الثابتة ────────────────────────────────────────────────────────

describe('interpret — الأصناف الثابتة', () => {
  it('الصيغة الكاملة مع لام الجر وأيام متعددة', () => {
    expect(cmd(run('حط لعبدالله صنف ثابت أرز بخاري السبت والاثنين'))).toMatchObject({
      kind: 'add_fixed',
      person: 'عبدالله الشمري',
      meal: 'أرز بخاري',
      days: [6, 1],
    });
  });

  it('صيغة عامية بلا كلمة «صنف»', () => {
    expect(cmd(run('عبدالله يبي أرز ثابت كل سبت'))).toMatchObject({
      kind: 'add_fixed',
      days: [6],
    });
  });

  it('يستنتج الصنف الثابت من شخص + صنف + يوم بلا كلمة «ثابت»', () => {
    expect(cmd(run('حط له بيض مسلوق السبت', { personId: 'p1' }))).toMatchObject({
      kind: 'add_fixed',
      person: 'أحمد العلي',
      meal: 'بيض مسلوق',
      days: [6],
    });
  });

  it('يسأل عن الأيام لو ما ذُكرت', () => {
    const a = askOf(run('حط لعبدالله صنف ثابت أرز بخاري'));
    expect(a.field).toBe('days');
    expect(a.options.length).toBe(7);
  });
});

// ── قائمة الطعام ───────────────────────────────────────────────────────────

describe('interpret — قائمة الطعام', () => {
  it('الصيغة المباشرة', () => {
    expect(cmd(run('اضف بيض مسلوق لفطور الخميس الاسبوع الثالث'))).toMatchObject({
      kind: 'add_menu_item',
      meal: 'بيض مسلوق',
      week: 3,
      days: [4],
      mealType: 'breakfast',
    });
  });

  it('صياغة حرّة بلا فعل أمر صريح', () => {
    expect(cmd(run('بيض مسلوق يدخل قائمة الخميس فطور اسبوع 3'))).toMatchObject({
      kind: 'add_menu_item',
      week: 3,
      days: [4],
    });
  });

  it('الحذف مع الترتيب المعكوس', () => {
    expect(cmd(run('شيل السمك من عشاء الجمعة الاسبوع الاول'))).toMatchObject({
      kind: 'remove_menu_item',
      meal: 'سمك مشوي',
      week: 1,
      days: [5],
    });
  });
});

// ── الحالة والحقول ─────────────────────────────────────────────────────────

describe('interpret — الحالة والحقول', () => {
  it('التعطيل بالاسم', () => {
    expect(cmd(run('عطل سارة'))).toMatchObject({ kind: 'set_person_status', active: false });
  });

  it('التعطيل بالضمير المتصل من السياق', () => {
    const r = run('عطّله', { personId: 'p1' });
    expect(cmd(r)).toMatchObject({ kind: 'set_person_status', person: 'أحمد العلي', active: false });
  });

  it('تعديل الفيلا بصيغة «إلى»', () => {
    expect(cmd(run('غير فيلا احمد الى 5'))).toMatchObject({ field: 'villa', value: '5' });
  });

  it('تعديل الفيلا بصيغة مختصرة بلا «إلى»', () => {
    expect(cmd(run('خل فيلا سارة 7'))).toMatchObject({ field: 'villa', value: '7' });
  });
});

// ── الفصل عن الأسئلة ───────────────────────────────────────────────────────

describe('interpret — لا يخلط السؤال بالأمر', () => {
  it('الأسئلة تُحال لمحرّك الاستعلام', () => {
    for (const q of [
      'كم عدد المستفيدين',
      'متى يقدم الفول',
      'مين ممنوع عليه السمك',
      'وش القائمة يوم الخميس',
      'توزيع المستفيدين حسب الفيلا',
    ]) {
      expect(run(q).kind, q).toBe('query');
    }
  });
});

// ── الحوار متعدد الخطوات ───────────────────────────────────────────────────

describe('interpret — الحوار', () => {
  it('يكمل الأمر من جواب السؤال السابق', () => {
    const first = askOf(run('حط لعبدالله صنف ثابت أرز بخاري'));
    expect(first.field).toBe('days');

    const second = run('السبت', undefined, first.pending);
    expect(cmd(second)).toMatchObject({
      kind: 'add_fixed',
      person: 'عبدالله الشمري',
      meal: 'أرز بخاري',
      days: [6],
    });
  });

  it('يتسلسل عبر أكثر من سؤال حتى يكتمل', () => {
    const q1 = askOf(run('اضف بيض مسلوق للقائمة'));
    expect(q1.field).toBe('days');

    const q2 = askOf(run('الخميس', undefined, q1.pending));
    expect(q2.field).toBe('mealType');

    const q3 = askOf(run('فطور', undefined, q2.pending));
    expect(q3.field).toBe('week');

    expect(cmd(run('الأسبوع الثاني', undefined, q3.pending))).toMatchObject({
      kind: 'add_menu_item',
      meal: 'بيض مسلوق',
      days: [4],
      mealType: 'breakfast',
      week: 2,
    });
  });

  it('يحدّث ذاكرة السياق بعد كل دور', () => {
    const r = run('عطل سارة');
    if (r.kind !== 'command') throw new Error('expected command');
    expect(r.context.personId).toBe('p2');
  });
});
