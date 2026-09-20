/**
 * اختبارات سلوك البوت من طرفه إلى طرفه.
 *
 * ندفع تحديثاً كما يرسله تليقرام، ونفتّش ما كان البوت سيرسله. المزوّد ومحرّك
 * الخطط مستبدَلان — ليس لأنهما غير مهمّين، بل لأن ما نختبره هنا هو الوصل
 * بينهما: من يُسمح له بالكلام، ومتى تُبنى أزرار التأكيد، وماذا يحدث حين يعيد
 * تليقرام إرسال الرسالة نفسها.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { makeClient, captureTelegram, sentText, TEST_USER, type Row, type TgCall } from './telegram-support';

// ── البدائل ────────────────────────────────────────────────────────────────
//
// `vi.mock` يُرفع إلى أعلى الملف قبل أي متغيّر، فما تحتاجه مصانعه يُعلَن عبر
// `vi.hoisted` ليُرفع معها. والعميل يُمرَّر بمرجع لأنه يُبنى من جديد كل اختبار.

const mocks = vi.hoisted(() => ({
  clientRef: { current: null as unknown },
  providerRun: vi.fn(),
  runTurn: vi.fn(),
  executePlan: vi.fn(),
}));

vi.mock('@/lib/supabase-admin', () => ({
  createAdminClient: () => mocks.clientRef.current,
}));

vi.mock('@/lib/assistant/ai/provider', () => ({
  resolveProvider: async () => ({
    ok: true,
    fellBack: false,
    requested: null,
    provider: {
      id: 'claude',
      label: 'Claude',
      isConfigured: () => true,
      modelName: () => 'test-model',
      run: mocks.providerRun,
    },
  }),
}));

vi.mock('@/lib/assistant/plan', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/assistant/plan')>()),
  runTurn: mocks.runTurn,
}));

vi.mock('@/lib/assistant/execute', () => ({
  executePlan: mocks.executePlan,
  executeUndo: vi.fn(),
}));

const { providerRun, runTurn, executePlan } = mocks;

let db: Record<string, Row[]>;
let client: SupabaseClient;

import { handleUpdate } from '@/lib/telegram/handle';
import { issueLinkCode, loadSession, redeemLinkCode } from '@/lib/telegram/store';

// ── تجهيز ──────────────────────────────────────────────────────────────────

const CHAT = 555;
let calls: TgCall[];
let restore: () => void;

/** تحديث رسالة نصية كما يبعثه تليقرام. */
function message(text: string, updateId = Math.floor(Math.random() * 1e9)) {
  return {
    update_id: updateId,
    message: {
      message_id: 1,
      chat: { id: CHAT, type: 'private' as const },
      from: { id: 42, first_name: 'أحمد', username: 'ahmad' },
      date: 0,
      text,
    },
  };
}

/** ضغطة زر. */
function callback(data: string, updateId = Math.floor(Math.random() * 1e9)) {
  return {
    update_id: updateId,
    callback_query: {
      id: 'cb1',
      from: { id: 42, first_name: 'أحمد' },
      data,
      message: { message_id: 9, chat: { id: CHAT, type: 'private' as const }, date: 0 },
    },
  };
}

async function link(user: Partial<typeof TEST_USER> = {}) {
  db.app_users = [{ ...TEST_USER, ...user }];
  const { code } = await issueLinkCode(client, String(db.app_users[0].id));
  await redeemLinkCode(client, code, { id: CHAT });
  calls.length = 0;
}

/** مستخدم يقدر يستعمل المساعد ويعدّل المستفيدين. */
const EDITOR = {
  permissions: {
    assistant: { view: true, add: false, edit: false, delete: false },
    beneficiaries: { view: true, add: true, edit: true, delete: true },
  },
};

beforeEach(() => {
  process.env.TELEGRAM_BOT_TOKEN = 'test-token';
  db = { app_users: [{ ...TEST_USER }] };
  client = makeClient(db);
  mocks.clientRef.current = client;
  ({ calls, restore } = captureTelegram());
  providerRun.mockReset();
  runTurn.mockReset();
  executePlan.mockReset();
});

afterEach(() => restore());

// ── قبل الربط ──────────────────────────────────────────────────────────────

describe('محادثة غير مربوطة', () => {
  it('لا تصل النموذج أصلاً — ولا تُسرَّب لها بيانات', async () => {
    await handleUpdate(message('كم عدد المستفيدين؟'));
    expect(providerRun).not.toHaveBeenCalled();
    expect(sentText(calls)).toContain('غير مربوطة بحساب');
  });

  it('/start يشرح طريقة الربط', async () => {
    await handleUpdate(message('/start'));
    expect(sentText(calls)).toContain('إنشاء كود ربط');
  });

  it('كود صحيح يربطها ويرحّب باسم صاحبه', async () => {
    const { code } = await issueLinkCode(client, 'u1');
    await handleUpdate(message(code));
    expect(sentText(calls)).toContain('تم الربط');
    expect(sentText(calls)).toContain('أحمد');
  });

  it('/start مع كود يربط مباشرة — رابط البوت العميق', async () => {
    const { code } = await issueLinkCode(client, 'u1');
    await handleUpdate(message(`/start ${code}`));
    expect(sentText(calls)).toContain('تم الربط');
  });

  it('كود خاطئ يُرفض وتبقى المحادثة مغلقة', async () => {
    await handleUpdate(message('ZZZZZZZZ'));
    expect(sentText(calls)).toContain('كود غير معروف');

    await handleUpdate(message('كم عدد المستفيدين؟'));
    expect(providerRun).not.toHaveBeenCalled();
  });
});

// ── الصلاحيات ──────────────────────────────────────────────────────────────

describe('الصلاحيات', () => {
  it('من لا يملك صلاحية المساعد لا يُسأل عنه النموذج', async () => {
    await link(); // TEST_USER بلا صلاحيات
    await handleUpdate(message('كم عدد المستفيدين؟'));

    expect(providerRun).not.toHaveBeenCalled();
    expect(sentText(calls)).toContain('ما عنده صلاحية استخدام المساعد');
  });

  it('خطة تمسّ صفحة ممنوعة تُرفض قبل أن تُعرض أزرارها', async () => {
    await link({ permissions: { assistant: { view: true, add: false, edit: false, delete: false } } });

    providerRun.mockResolvedValue({
      messages: [],
      text: '',
      toolsUsed: ['propose_change'],
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      plan: {
        commandText: 'احذف المستفيد فهد',
        plan: {
          title: 'حذف مستفيد',
          summary: 'حذف فهد',
          steps: [],
          warnings: [],
          signature: 'sig',
          permission: { page: 'beneficiaries', action: 'delete' },
        },
      },
    });

    await handleUpdate(message('احذف المستفيد فهد'));

    expect(sentText(calls)).toContain('ما عندك صلاحية');
    expect(calls.some((c) => JSON.stringify(c.body).includes('callback_data'))).toBe(false);
  });
});

// ── السؤال العادي ──────────────────────────────────────────────────────────

describe('الأسئلة', () => {
  beforeEach(() => link(EDITOR));

  it('يمرّر السؤال للنموذج ويرسل جوابه', async () => {
    providerRun.mockResolvedValue({
      messages: [{ role: 'user', content: 'كم عدد المستفيدين؟' }],
      text: 'عندنا **٤٢** مستفيداً نشطاً.',
      toolsUsed: ['count_people'],
      usage: { input: 10, output: 5, cacheRead: 0, cacheWrite: 0 },
    });

    await handleUpdate(message('كم عدد المستفيدين؟'));

    expect(providerRun).toHaveBeenCalledOnce();
    expect(providerRun.mock.calls[0][0]).toMatchObject({ question: 'كم عدد المستفيدين؟' });
    // Markdown النموذج يصير HTML يفهمه تليقرام
    expect(sentText(calls)).toContain('<b>٤٢</b>');
  });

  it('يراكم الحوار بين الأدوار فيفهم «وكم منهم في الغرفة الأولى؟»', async () => {
    providerRun.mockResolvedValue({
      messages: [{ role: 'user', content: 'س' }, { role: 'assistant', content: 'ج' }],
      text: 'جواب',
      toolsUsed: [],
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    });

    await handleUpdate(message('السؤال الأول'));
    await handleUpdate(message('والثاني؟'));

    // الدور الثاني وصله ما حُفظ من الأول
    expect(providerRun.mock.calls[1][0].history).toHaveLength(2);
    expect((await loadSession(client, CHAT)).history).toHaveLength(4);
  });

  it('/new ينسى الحوار', async () => {
    providerRun.mockResolvedValue({
      messages: [{ role: 'user', content: 'س' }],
      text: 'جواب',
      toolsUsed: [],
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    });

    await handleUpdate(message('سؤال'));
    await handleUpdate(message('/new'));

    expect((await loadSession(client, CHAT)).history).toEqual([]);
    expect(sentText(calls)).toContain('حواراً جديداً');
  });

  it('/whoami يقول بأي حساب يتكلم', async () => {
    await handleUpdate(message('/whoami'));
    const text = sentText(calls);
    expect(text).toContain('ahmad@example.com');
    expect(providerRun).not.toHaveBeenCalled();
  });

  it('/unlink يغلق المحادثة فعلاً', async () => {
    await handleUpdate(message('/unlink'));
    calls.length = 0;

    await handleUpdate(message('كم عدد المستفيدين؟'));
    expect(providerRun).not.toHaveBeenCalled();
    expect(sentText(calls)).toContain('غير مربوطة بحساب');
  });
});

// ── التكرار ────────────────────────────────────────────────────────────────

describe('التحديث المعاد من تليقرام', () => {
  beforeEach(() => link(EDITOR));

  it('لا يُسأل النموذج مرتين عن رسالة واحدة', async () => {
    providerRun.mockResolvedValue({
      messages: [],
      text: 'جواب',
      toolsUsed: [],
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    });

    await handleUpdate(message('سؤال', 777));
    await handleUpdate(message('سؤال', 777));

    expect(providerRun).toHaveBeenCalledOnce();
    expect(calls.filter((c) => c.method === 'sendMessage')).toHaveLength(1);
  });
});

// ── التأكيد والتنفيذ ───────────────────────────────────────────────────────

describe('خطة تنتظر تأكيداً', () => {
  const PLAN = {
    title: 'إضافة مستفيد',
    summary: 'إضافة فهد',
    steps: [{ text: 'إنشاء سجل فهد', tone: 'add' }],
    warnings: [],
    signature: 'sig-1',
    permission: { page: 'beneficiaries', action: 'add' },
    ops: [],
    activity: [],
  };

  beforeEach(async () => {
    await link(EDITOR);
    providerRun.mockResolvedValue({
      messages: [],
      text: 'راح أضيف فهد.',
      toolsUsed: ['propose_change'],
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      plan: { commandText: 'أضف مستفيد فهد', plan: PLAN },
    });
  });

  function buttons(): Array<{ text: string; callback_data?: string }> {
    const withKeyboard = calls.find((c) => JSON.stringify(c.body).includes('callback_data'));
    const markup = withKeyboard?.body.reply_markup as { inline_keyboard: Array<Array<{ text: string; callback_data?: string }>> };
    return markup.inline_keyboard.flat();
  }

  it('يعرض المعاينة وزرّي تأكيد وإلغاء ولا ينفّذ شيئاً', async () => {
    await handleUpdate(message('أضف مستفيد فهد'));

    const text = sentText(calls);
    expect(text).toContain('إضافة مستفيد');
    expect(text).toContain('لم يُنفَّذ شيء بعد');
    expect(executePlan).not.toHaveBeenCalled();

    const labels = buttons().map((b) => b.text);
    expect(labels[0]).toContain('تأكيد');
    expect(labels[1]).toContain('إلغاء');
  });

  it('معرّف الزر يتّسع في حدّ تليقرام (٦٤ بايت)', async () => {
    await handleUpdate(message('أضف مستفيد فهد'));
    for (const b of buttons()) {
      expect(Buffer.byteLength(b.callback_data ?? '')).toBeLessThanOrEqual(64);
    }
  });

  it('التأكيد يعيد بناء الخطة ثم ينفّذها ويعرض زرّ تراجع', async () => {
    await handleUpdate(message('أضف مستفيد فهد'));
    const confirm = buttons()[0].callback_data!;
    calls.length = 0;

    runTurn.mockResolvedValue({ kind: 'plan', plan: PLAN, context: null });
    executePlan.mockResolvedValue({ ok: true, applied: 1, total: 1, undoToken: 'tok.sig' });

    await handleUpdate(callback(confirm));

    // أُعيد الاشتقاق من نصّ الأمر لا من حمولة الزر
    expect(runTurn).toHaveBeenCalledWith(expect.anything(), { text: 'أضف مستفيد فهد' });
    expect(executePlan).toHaveBeenCalledOnce();
    expect(sentText(calls)).toContain('تم التنفيذ');
    expect(buttons()[0].text).toContain('تراجع');
  });

  it('تغيّر التوقيع بين المعاينة والتأكيد يوقف التنفيذ', async () => {
    await handleUpdate(message('أضف مستفيد فهد'));
    const confirm = buttons()[0].callback_data!;
    calls.length = 0;

    // البيانات تغيّرت — الخطة المعاد بناؤها لم تعد هي نفسها
    runTurn.mockResolvedValue({
      kind: 'plan',
      plan: { ...PLAN, signature: 'sig-2' },
      context: null,
    });

    await handleUpdate(callback(confirm));

    expect(executePlan).not.toHaveBeenCalled();
    expect(sentText(calls)).toContain('تغيّرت البيانات');
  });

  it('الضغط على «تأكيد» مرتين ينفّذ مرة واحدة', async () => {
    await handleUpdate(message('أضف مستفيد فهد'));
    const confirm = buttons()[0].callback_data!;

    runTurn.mockResolvedValue({ kind: 'plan', plan: PLAN, context: null });
    executePlan.mockResolvedValue({ ok: true, applied: 1, total: 1, undoToken: null });

    await handleUpdate(callback(confirm, 1001));
    await handleUpdate(callback(confirm, 1002));

    expect(executePlan).toHaveBeenCalledOnce();
  });

  it('الإلغاء يحرق الخطة فلا تُنفَّذ بعده', async () => {
    await handleUpdate(message('أضف مستفيد فهد'));
    const all = buttons();
    const cancel = all[1].callback_data!;
    const confirm = all[0].callback_data!;
    calls.length = 0;

    await handleUpdate(callback(cancel, 2001));
    expect(sentText(calls)).toContain('ما تغيّر شيء');

    runTurn.mockResolvedValue({ kind: 'plan', plan: PLAN, context: null });
    await handleUpdate(callback(confirm, 2002));
    expect(executePlan).not.toHaveBeenCalled();
  });

  it('فشل التنفيذ يُقال كما هو لا يُبتلع', async () => {
    await handleUpdate(message('أضف مستفيد فهد'));
    const confirm = buttons()[0].callback_data!;
    calls.length = 0;

    runTurn.mockResolvedValue({ kind: 'plan', plan: PLAN, context: null });
    executePlan.mockResolvedValue({ ok: false, applied: 0, total: 1, error: 'تعذّر التنفيذ: عمود ناقص' });

    await handleUpdate(callback(confirm));
    expect(sentText(calls)).toContain('عمود ناقص');
  });
});
