import { describe, expect, it } from 'vitest';
import type { DeliveryOrder } from '@/lib/types';
import {
  COL_CITY,
  COL_CREATOR,
  COL_DATE,
  COL_ENTITY,
  COL_ITEMS,
  COL_LOCATION,
  COL_MEAL_TYPE,
  COL_NOTES,
  COL_ORDER_NO,
  COL_PHONE,
  COL_DEL_TIME,
  DELIVERY_ORDER_HEADERS,
  DELIVERY_ORDER_TEMPLATE_ROW,
  buildDeliveryUpdateBody,
  creatorRefKey,
  normalizeDate,
  normalizeTime,
  DELIVERY_ORDER_REQUIRED_HEADERS,
  buildDeliveryOrderRow,
  formatDeliveryItems,
  parseDeliveryItems,
  parseDeliveryOrderRow,
  type DeliveryImportRefs,
} from '@/lib/delivery-order-sheet';

const REFS: DeliveryImportRefs = {
  locationIdByName: new Map([['مقر الشركة', 'loc-1'], ['فرع الخبر', 'loc-2']]),
  creatorIdByName: new Map([['أحمد', 'cr-1']]),
};

const ORDER = {
  id: 'o1',
  order_number: 'DO-0007',
  date: '2026-08-17',
  meal_type: 'lunch',
  delivery_location_id: 'loc-1',
  created_by_name: null,
  created_by_phone: null,
  delivery_date: '2026-08-18',
  delivery_time: '12:30',
  notes: 'يُسلّم للبوابة',
  created_at: '2026-08-17T09:00:00Z',
  updated_at: '2026-08-17T09:00:00Z',
  delivery_locations: { id: 'loc-1', name: 'مقر الشركة', created_at: '', cities: { id: 'c1', name: 'الدمام', created_at: '' } },
  delivery_creators: { id: 'cr-1', name: 'أحمد', phone: '0500000000', created_at: '' },
  delivery_order_items: [
    { id: 'i2', delivery_order_id: 'o1', display_name: 'سلطة', meal_type: 'lunch', quantity: 20, position: 1, created_at: '' },
    { id: 'i1', delivery_order_id: 'o1', display_name: 'كبسة', meal_type: 'lunch', quantity: 30, position: 0, created_at: '' },
  ],
} as unknown as DeliveryOrder;

describe('ورقة أوامر التسليم', () => {
  it('الأعمدة الإلزامية كلها من ضمن رؤوس الملف', () => {
    for (const h of DELIVERY_ORDER_REQUIRED_HEADERS) expect(DELIVERY_ORDER_HEADERS).toContain(h);
  });

  it('يبني الصف بكل ما تعرضه الصفحة', () => {
    const row = buildDeliveryOrderRow(ORDER);
    expect(row[COL_ORDER_NO]).toBe('DO-0007');
    expect(row[COL_DATE]).toBe('2026-08-17');
    expect(row[COL_MEAL_TYPE]).toBe('غداء');
    expect(row[COL_LOCATION]).toBe('مقر الشركة');
    expect(row[COL_CITY]).toBe('الدمام');
    expect(row[COL_CREATOR]).toBe('أحمد');
    expect(row[COL_PHONE]).toBe('0500000000');
    expect(row[COL_NOTES]).toBe('يُسلّم للبوابة');
  });

  it('يرتّب البنود بـposition لا بترتيب وصولها', () => {
    expect(buildDeliveryOrderRow(ORDER)[COL_ITEMS]).toBe('كبسة (غداء) ×30 | سلطة (غداء) ×20');
  });
});

describe('دورة تصدير ← استيراد', () => {
  it('الصف المُصدَّر يُقرأ بنفس قيمه', () => {
    const row = buildDeliveryOrderRow(ORDER);
    const { payload, errors } = parseDeliveryOrderRow(row, REFS, 'صف 2');
    expect(errors).toEqual([]);
    expect(payload).toMatchObject({
      date: '2026-08-17',
      meal_type: 'lunch',
      delivery_location_id: 'loc-1',
      creator_id: 'cr-1',
      delivery_date: '2026-08-18',
      delivery_time: '12:30',
      notes: 'يُسلّم للبوابة',
    });
    expect(payload!.items).toEqual([
      { display_name: 'كبسة', meal_type: 'lunch', quantity: 30 },
      { display_name: 'سلطة', meal_type: 'lunch', quantity: 20 },
    ]);
  });

  it('لا يستورد رقم الأمر — النظام يولّده فلا يتعارض', () => {
    const row = buildDeliveryOrderRow(ORDER);
    const { payload } = parseDeliveryOrderRow(row, REFS, 'صف 2');
    expect(payload).not.toHaveProperty('order_number');
  });

  it('المُنشئ غير المسجّل يُحفظ كنص مع جواله', () => {
    const row = { ...buildDeliveryOrderRow(ORDER), [COL_CREATOR]: 'خالد', [COL_PHONE]: '0555555555' };
    const { payload, errors } = parseDeliveryOrderRow(row, REFS, 'صف 2');
    expect(errors).toEqual([]);
    expect(payload).toMatchObject({ creator_id: null, created_by_name: 'خالد', created_by_phone: '0555555555' });
  });

  it('نوع «فطور + غداء + عشاء» يعبر الدورة', () => {
    const order = { ...ORDER, meal_type: 'all' } as unknown as DeliveryOrder;
    const row = buildDeliveryOrderRow(order);
    expect(row[COL_MEAL_TYPE]).toBe('فطور + غداء + عشاء');
    expect(parseDeliveryOrderRow(row, REFS, 'صف 2').payload).toMatchObject({ meal_type: 'all' });
  });
});

describe('فئة أمر التسليم', () => {
  it('أمر المرافقين يُصدَّر ويُستورد بفئته', () => {
    const order = { ...ORDER, entity_type: 'companion' } as unknown as DeliveryOrder;
    const row = buildDeliveryOrderRow(order);
    expect(row[COL_ENTITY]).toBe('المرافقون');
    expect(parseDeliveryOrderRow(row, REFS, 'صف 2').payload).toMatchObject({ entity_type: 'companion' });
  });

  it('أمر بلا فئة (نسخة قديمة) يُقرأ كمستفيدين', () => {
    const order = { ...ORDER } as unknown as DeliveryOrder;
    delete (order as { entity_type?: unknown }).entity_type;
    expect(buildDeliveryOrderRow(order)[COL_ENTITY]).toBe('المستفيدون');
  });

  it('ملف قديم بلا عمود الفئة يُستورد كمستفيدين بلا خطأ', () => {
    const row = buildDeliveryOrderRow(ORDER);
    delete row[COL_ENTITY];
    const { payload, errors } = parseDeliveryOrderRow(row, REFS, 'صف 2');
    expect(errors).toEqual([]);
    expect(payload).toMatchObject({ entity_type: 'beneficiary' });
  });

  it('يقبل المفرد والإنجليزي كما يكتبهما المستخدم يدوياً', () => {
    for (const [written, expected] of [['مرافقين', 'companion'], ['مستفيد', 'beneficiary'], ['companion', 'companion']]) {
      const row = { ...buildDeliveryOrderRow(ORDER), [COL_ENTITY]: written };
      expect(parseDeliveryOrderRow(row, REFS, 'صف 2').payload).toMatchObject({ entity_type: expected });
    }
  });

  it('يرفض فئة غير معروفة برسالة تشرح المقبول', () => {
    const row = { ...buildDeliveryOrderRow(ORDER), [COL_ENTITY]: 'زوار' };
    const { payload, errors } = parseDeliveryOrderRow(row, REFS, 'صف 2');
    expect(payload).toBeNull();
    expect(errors.join(' ')).toContain('الفئة "زوار" غير معروفة');
  });
});

describe('قراءة البنود', () => {
  const parse = (raw: string) => parseDeliveryItems(raw, 'lunch');

  it('يقرأ الاسم والوجبة والكمية', () => {
    expect(parse('كبسة (غداء) ×30').items).toEqual([{ display_name: 'كبسة', meal_type: 'lunch', quantity: 30 }]);
  });

  it('اسم فيه أقواس أو أرقام يبقى كما هو', () => {
    expect(parse('عصير (طبيعي) 100% (غداء) ×5').items).toEqual([
      { display_name: 'عصير (طبيعي) 100%', meal_type: 'lunch', quantity: 5 },
    ]);
  });

  it('بند بلا كمية = واحد، وبلا وجبة = وجبة الأمر', () => {
    expect(parse('خبز').items).toEqual([{ display_name: 'خبز', meal_type: 'lunch', quantity: 1 }]);
    expect(parse('خبز ×4').items).toEqual([{ display_name: 'خبز', meal_type: 'lunch', quantity: 4 }]);
    expect(parse('خبز (عشاء)').items).toEqual([{ display_name: 'خبز', meal_type: 'dinner', quantity: 1 }]);
  });

  it('يبلّغ عن نوع وجبة غير معروف بدل تخمينه', () => {
    const r = parse('كبسة (سحور) ×3');
    expect(r.items).toEqual([]);
    expect(r.errors[0]).toContain('سحور');
  });

  it('formatDeliveryItems و parseDeliveryItems متعاكستان', () => {
    const items = [
      { display_name: 'كبسة', meal_type: 'lunch' as const, quantity: 30, position: 0 },
      { display_name: 'تمر', meal_type: 'dinner' as const, quantity: 7, position: 1 },
    ];
    expect(parse(formatDeliveryItems(items)).items).toEqual([
      { display_name: 'كبسة', meal_type: 'lunch', quantity: 30 },
      { display_name: 'تمر', meal_type: 'dinner', quantity: 7 },
    ]);
  });
});

describe('رفض الصفوف المعطوبة', () => {
  const base = () => buildDeliveryOrderRow(ORDER);

  it('تاريخ مفقود', () => {
    const { payload, errors } = parseDeliveryOrderRow({ ...base(), [COL_DATE]: '' }, REFS, 'صف 3');
    expect(payload).toBeNull();
    expect(errors.some(e => e.includes('التاريخ'))).toBe(true);
  });

  it('يقبل صيغة dd/mm/yyyy التي يكتبها Excel', () => {
    const { payload } = parseDeliveryOrderRow({ ...base(), [COL_DATE]: '17/08/2026' }, REFS, 'صف 3');
    expect(payload?.date).toBe('2026-08-17');
  });

  it('موقع غير موجود يُبلَّغ عنه بدل إنشاء أمر بلا موقع', () => {
    const { payload, errors } = parseDeliveryOrderRow({ ...base(), [COL_LOCATION]: 'فرع وهمي' }, REFS, 'صف 3');
    expect(payload).toBeNull();
    expect(errors.some(e => e.includes('فرع وهمي'))).toBe(true);
  });

  it('أمر بلا بنود مرفوض', () => {
    const { payload, errors } = parseDeliveryOrderRow({ ...base(), [COL_ITEMS]: '' }, REFS, 'صف 3');
    expect(payload).toBeNull();
    expect(errors.some(e => e.includes(COL_ITEMS))).toBe(true);
  });
});

describe('القالب ووضع التحديث', () => {
  it('صف القالب بطول الرؤوس وكل قيمة تحت عمودها', () => {
    expect(DELIVERY_ORDER_TEMPLATE_ROW).toHaveLength(DELIVERY_ORDER_HEADERS.length);
    const row = Object.fromEntries(DELIVERY_ORDER_HEADERS.map((h, i) => [h, DELIVERY_ORDER_TEMPLATE_ROW[i]]));
    expect(row[COL_ENTITY]).toBe('المستفيدون');
    expect(row[COL_MEAL_TYPE]).toBe('غداء');
    expect(row[COL_LOCATION]).toBe('مقر الشركة');
  });

  it('القالب نفسه يُستورد بلا أخطاء وبلا رقم أمر', () => {
    const row = Object.fromEntries(DELIVERY_ORDER_HEADERS.map((h, i) => [h, DELIVERY_ORDER_TEMPLATE_ROW[i]]));
    const { payload, errors, orderNumber } = parseDeliveryOrderRow(row, REFS, 'صف 2');
    expect(errors).toEqual([]);
    expect(orderNumber).toBeNull();
    expect(payload!.items).toHaveLength(2);
  });

  it('يُرجع رقم الأمر منفصلاً عن الحِمل لمطابقة «تحديث الموجود»', () => {
    const { payload, orderNumber } = parseDeliveryOrderRow(buildDeliveryOrderRow(ORDER), REFS, 'صف 2');
    expect(orderNumber).toBe('DO-0007');
    expect(payload).not.toHaveProperty('order_number');
  });

  it('الكمية صفر تعبر الدورة (النافذة تسمح بها)', () => {
    const order = { ...ORDER, delivery_order_items: [{ ...ORDER.delivery_order_items![0], quantity: 0 }] } as unknown as DeliveryOrder;
    const { payload, errors } = parseDeliveryOrderRow(buildDeliveryOrderRow(order), REFS, 'صف 2');
    expect(errors).toEqual([]);
    expect(payload!.items[0].quantity).toBe(0);
  });

  it('وقت القاعدة HH:MM:SS يعبر، ووقت غير مفهوم يُرفض برسالة عربية', () => {
    const ok = parseDeliveryOrderRow({ ...buildDeliveryOrderRow(ORDER), [COL_DEL_TIME]: '12:30:00' }, REFS, 'صف 2');
    expect(ok.payload!.delivery_time).toBe('12:30:00');
    const bad = parseDeliveryOrderRow({ ...buildDeliveryOrderRow(ORDER), [COL_DEL_TIME]: 'الظهر' }, REFS, 'صف 2');
    expect(bad.payload).toBeNull();
    expect(bad.errors[0]).toContain('وقت التسليم');
  });

  it('normalizeTime يقبل الساعة برقم واحد وص/م', () => {
    expect(normalizeTime('9:05')).toBe('09:05');
    expect(normalizeTime('1:30 م')).toBe('13:30');
    expect(normalizeTime('12:00 AM')).toBe('00:00');
    expect(normalizeTime('')).toBeNull();
    expect(normalizeTime('25:00')).toBeUndefined();
  });

  it('normalizeDate لا يزيح اليوم بسبب التوقيت', () => {
    expect(normalizeDate('2026-08-17')).toBe('2026-08-17');
    expect(normalizeDate('17/08/2026')).toBe('2026-08-17');
    expect(normalizeDate('Aug 17, 2026')).toBe('2026-08-17');
  });

  it('المُنشئ يُطابق بالاسم والجوال معاً عند تكرار الاسم', () => {
    const refs: DeliveryImportRefs = {
      ...REFS,
      creatorIdByName: new Map([['أحمد', 'cr-1']]),
      creatorIdByNameAndPhone: new Map([[creatorRefKey('أحمد', '0500000000'), 'cr-1'], [creatorRefKey('أحمد', '0511111111'), 'cr-2']]),
    };
    const row = { ...buildDeliveryOrderRow(ORDER), [COL_PHONE]: '0511111111' };
    expect(parseDeliveryOrderRow(row, refs, 'صف 2').payload).toMatchObject({ creator_id: 'cr-2' });
  });

  it('حِمل التحديث يحفظ التوقيعات وربط أمر التشغيل', () => {
    const existing = {
      ...ORDER,
      source_order_id: 'src-1',
      creator_signature_url: 'https://x/c.png',
      receiver_signature_url: 'https://x/r.png',
      delivery_order_items: [
        { ...ORDER.delivery_order_items![1], receiver_signature_url: 'https://x/i1.png' },
        { ...ORDER.delivery_order_items![0], receiver_signature_url: 'https://x/i2.png' },
      ],
    } as unknown as DeliveryOrder;
    const { payload } = parseDeliveryOrderRow(buildDeliveryOrderRow(existing), REFS, 'صف 2');
    const body = buildDeliveryUpdateBody(existing, payload!);
    expect(body).toMatchObject({ source_order_id: 'src-1', creator_signature_url: 'https://x/c.png', receiver_signature_url: 'https://x/r.png' });
    expect(body.items.map(i => i.receiver_signature_url)).toEqual(['https://x/i1.png', 'https://x/i2.png']);
  });
});

describe('توافق ورقة النسخة الاحتياطية', () => {
  it('يقرأ رأسَي المُنشئ بلا ضمّة كما تكتبهما النسخة الاحتياطية', () => {
    const row = buildDeliveryOrderRow(ORDER);
    delete row[COL_CREATOR];
    delete row[COL_PHONE];
    const { payload } = parseDeliveryOrderRow({ ...row, 'المنشئ': 'خالد', 'جوال المنشئ': '0555555555' }, REFS, 'صف 2');
    expect(payload).toMatchObject({ created_by_name: 'خالد', created_by_phone: '0555555555' });
  });
});
