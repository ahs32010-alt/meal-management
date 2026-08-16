/**
 * متانة الفهم: صياغات حرّة لنفس المعاني.
 *
 * كل حالة هنا كانت تسقط قبل توسعة المحرّك. الغرض ألّا تعود: الأمر الواحد
 * يُكتب بعشر صيغ مختلفة، وكلها يجب أن تصل لنفس النيّة.
 */
import { describe, expect, it } from 'vitest';
import { interpret, type Interpretation } from '@/lib/assistant/interpret';

const people = [
  { id: 'p1', name: 'أحمد العلي', code: 'B001' },
  { id: 'p2', name: 'سارة المطيري', code: 'B002' },
];

const meals = [
  { id: 'm1', name: 'فول', type: 'breakfast' as const },
  { id: 'm2', name: 'بيض مسلوق', type: 'breakfast' as const },
  { id: 'm3', name: 'أرز بخاري', type: 'lunch' as const },
  { id: 'm4', name: 'سمك مشوي', type: 'dinner' as const },
];

const run = (text: string): Interpretation => interpret({ text, people, meals });

/** نيّة الجملة: نوع الأمر، أو 'ask' عند النقص، أو 'query' لغير الأوامر. */
const intentOf = (text: string): string => {
  const r = run(text);
  return r.kind === 'command' ? r.command.kind : r.kind;
};

const cmdOf = (text: string) => {
  const r = run(text);
  if (r.kind !== 'command') throw new Error(`توقّعنا أمراً فجاء ${r.kind}: ${text}`);
  return r.command;
};

describe('تحمّل المطّ والأخطاء المطبعية', () => {
  // collapse() تعالج التكرار ٣ فأكثر، وضغط التكرار المزدوج يعالج الباقي
  it.each([
    ['شييل الفول عن احمد', 'مطّ قصير في الفعل'],
    ['اححذف الفول من احمد', 'ازدواج ضغط المفتاح'],
    ['امنععع احمد من السمك', 'مطّ طويل'],
    ['خلييييه ياكل بيض بدل الفول لاحمد', 'مطّ في فعل الإسناد'],
  ])('%s — %s', (text) => {
    expect(intentOf(text)).not.toBe('query');
  });

  it('يلقى الصنف رغم التكرار في اسمه', () => {
    expect(cmdOf('امنع احمد من السممك')).toMatchObject({
      kind: 'set_exclusion',
      meal: 'سمك مشوي',
    });
  });
});

describe('النفي العامي = منع', () => {
  it.each([
    ['احمد ما يبي فول', 'نفي مفصول'],
    ['احمد مايحب الفول', 'نفي موصول'],
    ['سارة ما تاكل سمك', 'نفي مفصول بصيغة المؤنث'],
  ])('%s — %s', (text) => {
    expect(intentOf(text)).toBe('set_exclusion');
  });
});

describe('الاستبدال بصيغ مختلفة', () => {
  it.each([
    'خلي احمد ياكل بيض بدل الفول',
    'رتب لاحمد بيض بدل الفول',
    'ابغى احمد ياخذ بيض مكان الفول',
    'ودّ لاحمد بيض بدال الفول',
    'حط لاحمد بيض عوض الفول',
    'عطي احمد بيض بدل الفول',
  ])('%s', (text) => {
    expect(cmdOf(text)).toMatchObject({
      kind: 'set_exclusion',
      person: 'أحمد العلي',
      meal: 'فول',
      alternative: 'بيض مسلوق',
    });
  });

  it('أداة «إلى» تعكس اتجاه الاستبدال كما تفعل «بدل»', () => {
    expect(cmdOf('غيّر فول احمد الى بيض')).toMatchObject({
      kind: 'set_exclusion',
      meal: 'فول',
      alternative: 'بيض مسلوق',
    });
  });
});

describe('عبارات تكرار الأيام', () => {
  const days = (text: string) => {
    const c = cmdOf(text);
    if (c.kind !== 'add_fixed') throw new Error(`توقّعنا add_fixed فجاء ${c.kind}`);
    return [...c.days].sort((a, b) => a - b);
  };

  it('«يومياً» تعني الأيام السبعة', () => {
    expect(days('خلي احمد ياكل بيض يوميا')).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });

  it('«كل يوم» تعني الأيام السبعة', () => {
    expect(days('خلي احمد ياكل بيض كل يوم')).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });

  it('«نهاية الأسبوع» تعني الجمعة والسبت', () => {
    expect(days('خلي احمد ياكل بيض نهاية الاسبوع')).toEqual([5, 6]);
  });

  it('لا تُخلط «عطّله» بعطلة نهاية الأسبوع', () => {
    expect(interpret({ text: 'عطّله', people, meals, context: { personId: 'p1' } })).toMatchObject({
      kind: 'command',
      command: { kind: 'set_person_status', active: false },
    });
  });
});

describe('الإخبار بلا فعل أمر', () => {
  it('«يأخذ ... يوم كذا» تثبيت للصنف', () => {
    expect(cmdOf('احمد ياخذ ارز يوم الاثنين والثلاثاء')).toMatchObject({
      kind: 'add_fixed',
      meal: 'أرز بخاري',
      days: [1, 2],
    });
  });

  it('«ثبت» فعل تثبيت', () => {
    expect(intentOf('ثبت لاحمد بيض كل خميس')).toBe('add_fixed');
  });

  it('«شغال» تفعيل', () => {
    expect(cmdOf('رجع احمد شغال')).toMatchObject({ kind: 'set_person_status', active: true });
  });
});

describe('الاستهداف الجماعي', () => {
  it('«كل المرافقين» مجموعة مقيّدة بالنوع', () => {
    expect(cmdOf('عطل كل المرافقين')).toMatchObject({
      kind: 'bulk_status',
      active: false,
      group: { entityType: 'companion' },
    });
  });

  it('«كل خميس» يوم لا مجموعة', () => {
    const c = cmdOf('ثبت لاحمد بيض كل خميس');
    expect(c).toMatchObject({ kind: 'add_fixed', days: [4] });
  });
});

describe('ما يجب ألّا يتغيّر', () => {
  it.each([
    ['وش ياكل احمد بكرة', 'سؤال عن وجبة'],
    ['كم عدد المستفيدين', 'سؤال عن عدد'],
    ['مين ممنوع عليه السمك', 'سؤال عن ممنوع'],
  ])('%s يبقى استعلاماً لا أمراً — %s', (text) => {
    expect(intentOf(text)).toBe('query');
  });

  it('يسأل عن الشخص بدل أن يخمّنه', () => {
    expect(intentOf('امنعه من الفول')).toBe('ask');
  });

  it('يسأل عن الصنف الثابت بدل أن يخمّنه', () => {
    expect(intentOf('شيل الثابت حق احمد')).toBe('ask');
  });
});
