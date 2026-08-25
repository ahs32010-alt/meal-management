/**
 * صياغة رسائل تليقرام.
 *
 * نستعمل وضع HTML لا Markdown: نصوص المساعد عربية فيها نجوم وشرطات وأقواس،
 * وMarkdown-V2 يوجب هروب ثمانية عشر محرفاً وأي واحد منسيّ يرفض الرسالة كلها.
 * مع HTML نهرب ثلاثة محارف فقط ثم نعيد بناء التنسيق الذي نريده بأنفسنا.
 */

/** أقصى طول رسالة عند تليقرام ٤٠٩٦؛ نترك هامشاً لعلامات HTML. */
const MAX_LEN = 3800;

export function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * يحوّل ما يستعمله النموذج فعلاً من Markdown إلى HTML، ويهرب ما عداه.
 *
 * الترتيب مقصود: نهرب أولاً ثم نحوّل، وإلا صارت الوسوم التي نولّدها نحن
 * عرضةً للهروب. والكتل البرمجية تُحجز قبل ذلك كله حتى لا يُفسَّر ما بداخلها.
 */
export function mdToHtml(input: string): string {
  const blocks: string[] = [];
  let text = input.replace(/```(?:[\w-]*)\n?([\s\S]*?)```/g, (_m, code: string) => {
    blocks.push(`<pre>${escapeHtml(code.replace(/\n$/, ''))}</pre>`);
    return `[[CODE${blocks.length - 1}]]`;
  });

  text = escapeHtml(text);

  text = text
    .replace(/`([^`\n]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*\n]+)\*\*/g, '<b>$1</b>')
    // العنوان بأي مستوى يصير سطراً عريضاً — تليقرام بلا عناوين.
    .replace(/^#{1,6}\s+(.+)$/gm, '<b>$1</b>')
    // قائمة بشرطة أو نجمة في أول السطر تصير نقطة مرتّبة
    .replace(/^[-*]\s+/gm, '• ');

  return text.replace(/\[\[CODE(\d+)\]\]/g, (_m, i: string) => blocks[Number(i)] ?? '');
}

/**
 * يقسّم نصاً طويلاً إلى رسائل.
 *
 * نقطع عند حدود الفقرات ثم الأسطر ثم — مضطرين — عند الحرف. والقطع وسط وسم
 * HTML يكسر الرسالة، فنفضّل أسطراً جديدة ما دام ذلك ممكناً؛ ووسومنا كلها
 * داخل سطر واحد فلا تنقسم.
 */
export function splitMessage(text: string, max = MAX_LEN): string[] {
  if (text.length <= max) return [text];

  const parts: string[] = [];
  let rest = text;

  while (rest.length > max) {
    const window = rest.slice(0, max);
    let cut = window.lastIndexOf('\n\n');
    if (cut < max * 0.4) cut = window.lastIndexOf('\n');
    if (cut < max * 0.4) cut = max;
    parts.push(rest.slice(0, cut).trimEnd());
    rest = rest.slice(cut).trimStart();
  }

  if (rest.trim()) parts.push(rest);
  return parts;
}

const TONE_MARK: Record<string, string> = {
  add: '➕',
  remove: '➖',
  change: '✏️',
};

export interface PlanView {
  title: string;
  summary: string;
  steps: Array<{ text: string; tone: string }>;
  warnings: string[];
}

/** بطاقة الخطة كما تظهر في تليقرام — مقابل PlanCard في الويب. */
export function renderPlan(plan: PlanView): string {
  const lines: string[] = [`<b>📋 ${escapeHtml(plan.title)}</b>`, escapeHtml(plan.summary)];

  if (plan.steps.length) {
    lines.push('', '<b>التفاصيل:</b>');
    // خطة تلمس مئة صف لا تُقرأ سطراً سطراً — نعرض رأسها ونذكر بقيّتها.
    const shown = plan.steps.slice(0, 25);
    for (const step of shown) {
      lines.push(`${TONE_MARK[step.tone] ?? '•'} ${escapeHtml(step.text)}`);
    }
    if (plan.steps.length > shown.length) {
      lines.push(`… و${plan.steps.length - shown.length} خطوة أخرى`);
    }
  }

  if (plan.warnings.length) {
    lines.push('', '<b>⚠️ تنبيهات:</b>');
    for (const w of plan.warnings) lines.push(`• ${escapeHtml(w)}`);
  }

  lines.push('', '<i>لم يُنفَّذ شيء بعد — اضغط «تأكيد» للتنفيذ.</i>');
  return lines.join('\n');
}
