import { describe, expect, it } from 'vitest';
import { escapeHtml, mdToHtml, renderPlan, splitMessage } from '@/lib/telegram/format';

describe('escapeHtml', () => {
  it('neutralises the three characters that break HTML mode', () => {
    expect(escapeHtml('<b>x</b> & y')).toBe('&lt;b&gt;x&lt;/b&gt; &amp; y');
  });

  it('leaves Arabic text untouched', () => {
    expect(escapeHtml('كم عدد المستفيدين؟')).toBe('كم عدد المستفيدين؟');
  });
});

describe('mdToHtml', () => {
  it('converts bold and inline code', () => {
    expect(mdToHtml('**العدد** هو `42`')).toBe('<b>العدد</b> هو <code>42</code>');
  });

  it('turns markdown lists into bullets', () => {
    expect(mdToHtml('- أحمد\n- محمد')).toBe('• أحمد\n• محمد');
  });

  it('turns headings into bold lines', () => {
    expect(mdToHtml('## التقرير')).toBe('<b>التقرير</b>');
  });

  it('escapes user-supplied angle brackets so they cannot inject tags', () => {
    expect(mdToHtml('اسم <script>alert(1)</script>')).toContain('&lt;script&gt;');
  });

  it('keeps fenced code literal instead of formatting inside it', () => {
    const out = mdToHtml('```\n**not bold** <x>\n```');
    expect(out).toBe('<pre>**not bold** &lt;x&gt;</pre>');
  });

  // الحارس ضد عودة الخطأ القديم: كان الحاجز رقماً بين مسافتين، فأي رقم في
  // نصّ عربي عادي ("عندنا 0 مستفيدين") كان يُبتلع كأنه حاجز كتلة برمجية.
  it('does not mistake a bare number in prose for a code placeholder', () => {
    expect(mdToHtml('عندنا 0 مستفيدين اليوم')).toBe('عندنا 0 مستفيدين اليوم');
  });
});

describe('splitMessage', () => {
  it('leaves a short message as one part', () => {
    expect(splitMessage('قصيرة')).toEqual(['قصيرة']);
  });

  it('splits on paragraph boundaries when it can', () => {
    const text = `${'أ'.repeat(60)}\n\n${'ب'.repeat(60)}`;
    const parts = splitMessage(text, 100);
    expect(parts).toHaveLength(2);
    expect(parts[0]).toBe('أ'.repeat(60));
    expect(parts[1]).toBe('ب'.repeat(60));
  });

  it('never emits a part longer than the limit', () => {
    const parts = splitMessage('x'.repeat(1000), 100);
    expect(parts.every((p) => p.length <= 100)).toBe(true);
    expect(parts.join('').length).toBe(1000);
  });
});

describe('renderPlan', () => {
  const base = {
    title: 'إضافة مستفيد',
    summary: 'إضافة فهد إلى الغرفة ٢٠٤',
    steps: [{ text: 'إنشاء سجل فهد', tone: 'add' }],
    warnings: [] as string[],
  };

  it('renders title, summary and a step marker', () => {
    const out = renderPlan(base);
    expect(out).toContain('إضافة مستفيد');
    expect(out).toContain('➕ إنشاء سجل فهد');
  });

  it('always states that nothing has run yet', () => {
    expect(renderPlan(base)).toContain('لم يُنفَّذ شيء بعد');
  });

  it('summarises the tail instead of listing a hundred steps', () => {
    const many = {
      ...base,
      steps: Array.from({ length: 40 }, (_, i) => ({ text: `خطوة ${i}`, tone: 'change' })),
    };
    const out = renderPlan(many);
    expect(out).toContain('و15 خطوة أخرى');
  });

  it('escapes hostile data coming from the database', () => {
    const out = renderPlan({ ...base, title: '<img src=x>' });
    expect(out).toContain('&lt;img src=x&gt;');
    expect(out).not.toContain('<img');
  });

  it('lists warnings when the plan has them', () => {
    const out = renderPlan({ ...base, warnings: ['يوجد مستفيد بنفس الاسم'] });
    expect(out).toContain('يوجد مستفيد بنفس الاسم');
  });
});
