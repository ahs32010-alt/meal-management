import { describe, expect, it } from 'vitest';
import type { DeliveryOrder } from '@/lib/types';
import {
  COL_CITY,
  COL_CREATOR,
  COL_DATE,
  COL_ITEMS,
  COL_LOCATION,
  COL_MEAL_TYPE,
  COL_NOTES,
  COL_ORDER_NO,
  COL_PHONE,
  DELIVERY_ORDER_HEADERS,
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
