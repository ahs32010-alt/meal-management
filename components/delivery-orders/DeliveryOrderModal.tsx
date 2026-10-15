'use client';

import { Fragment, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase-client';
import { logActivity } from '@/lib/activity-log';
import { updateDetails, valueDetails, listDiffDetails } from '@/lib/activity-diff';
import type { City, DailyOrder, DeliveryLocation, DeliveryMeal, DeliveryMealType, DeliveryOrder, EntityType, MealType } from '@/lib/types';
import {
  DELIVERY_MEAL_TYPE_LABELS,
  ENTITY_BADGE_STYLES,
  ENTITY_TYPE_LABELS_PLURAL,
  MEAL_TYPE_LABELS,
} from '@/lib/types';
import { todayISO } from '@/lib/date-utils';
import { DELIVERY_MEAL_ORDER, EXTRA_ITEM_PREFIX, groupByMeal, isExtraItemName, stripExtraPrefix } from '@/lib/delivery-order-sheet';

const ENTITY_ICON: Record<EntityType, string> = {
  beneficiary: '👥',
  companion: '🧑‍🤝‍🧑',
};

interface SourceMode {
  type: 'manual' | 'from_order';
}

interface DraftItem {
  display_name: string;
  meal_type: DeliveryMealType;
  quantity: number;
  receiver_signature_url?: string | null;
  /** من «الأصناف اليومية الإضافية» — يُعرض في قسمه المضغوط ويُحفظ ببادئة */
  is_extra?: boolean;
}

/** الاسم كما يُحفظ: الإضافي يحمل بادئته */
const MEAL_SECTION_STYLE: Record<DeliveryMealType, string> = {
  breakfast: 'bg-amber-50 text-amber-800',
  lunch:     'bg-emerald-50 text-emerald-800',
  dinner:    'bg-indigo-50 text-indigo-800',
  all:       'bg-slate-100 text-slate-700',
};
const MEAL_ICON: Record<DeliveryMealType, string> = { breakfast: '🌅', lunch: '☀️', dinner: '🌙', all: '🍽' };

const savedItemName = (it: Pick<DraftItem, 'display_name' | 'is_extra'>) =>
  it.is_extra ? `${EXTRA_ITEM_PREFIX}${it.display_name.trim()}` : it.display_name.trim();

interface Props {
  editingOrder?: DeliveryOrder | null;
  onClose: () => void;
  onSaved: () => void;
}

interface ReportItem {
  meal: { id: string; name: string };
  gets?: number;
  qty?: number;
  quantity?: number;
}

interface ReportPayload {
  order: { id: string; date: string; meal_type: MealType };
  mainMealsSummary: ReportItem[];
  snackMealsSummary: ReportItem[];
  altSummary: ReportItem[];
  snackAltSummary: ReportItem[];
  fixedSummary: ReportItem[];
}

export default function DeliveryOrderModal({ editingOrder, onClose, onSaved }: Props) {
  const isEdit = !!editingOrder;

  // Mode: لو تعديل وعنده source_order_id نخش بـfrom_order، وإلا manual
  const [mode, setMode] = useState<SourceMode['type']>(
    isEdit ? (editingOrder?.source_order_id ? 'from_order' : 'manual') : 'manual'
  );
  // الفئة تسبق طريقة الإنشاء: أمر التشغيل الذي نجلب منه يخص فئة بعينها،
  // فاختيارها أولاً هو ما يجعل قائمة الأوامر المعروضة صحيحة أصلاً.
  // الأوامر القديمة (قبل الترقية) بلا عمود → تُعامَل كمستفيدين.
  const [entityType, setEntityType] = useState<EntityType>(
    editingOrder?.entity_type === 'companion' ? 'companion' : 'beneficiary'
  );
  const [step, setStep] = useState<'pick_entity' | 'pick_mode' | 'edit'>(
    isEdit ? 'edit' : 'pick_entity'
  );

  // Header fields
  const [date, setDate] = useState(editingOrder?.date ?? new Date().toISOString().split('T')[0]);
  const [mealType, setMealType] = useState<DeliveryMealType>(editingOrder?.meal_type ?? 'lunch');
  const [locationId, setLocationId] = useState<string>(editingOrder?.delivery_location_id ?? '');
  const [cityId, setCityId] = useState<string>(editingOrder?.delivery_locations?.city_id ?? '');
  const [notes, setNotes] = useState(editingOrder?.notes ?? '');
  const [creatorSignature, setCreatorSignature] = useState<string | null>(editingOrder?.creator_signature_url ?? null);
  const [receiverSignature, setReceiverSignature] = useState<string | null>(editingOrder?.receiver_signature_url ?? null);

  // Items
  const [items, setItems] = useState<DraftItem[]>(() =>
    (editingOrder?.delivery_order_items ?? []).map(it => ({
      display_name: stripExtraPrefix(it.display_name),
      is_extra: isExtraItemName(it.display_name),
      meal_type: it.meal_type,
      quantity: it.quantity,
      receiver_signature_url: it.receiver_signature_url,
    }))
  );
  const [sourceOrderId, setSourceOrderId] = useState<string | null>(editingOrder?.source_order_id ?? null);

  // Lookups
  const [cities, setCities] = useState<City[]>([]);
  const [locations, setLocations] = useState<DeliveryLocation[]>([]);
  const [deliveryMeals, setDeliveryMeals] = useState<DeliveryMeal[]>([]);
  const [productionOrders, setProductionOrders] = useState<DailyOrder[]>([]);

  // UI state
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [showAddCity, setShowAddCity] = useState(false);
  const [newCityName, setNewCityName] = useState('');
  const [savingCity, setSavingCity] = useState(false);
  const [showAddLocation, setShowAddLocation] = useState(false);
  const [newLocationName, setNewLocationName] = useState('');
  const [savingLocation, setSavingLocation] = useState(false);
  const [uploadingSig, setUploadingSig] = useState<'creator' | 'receiver' | null>(null);
  const [loadingFromOrder, setLoadingFromOrder] = useState(false);
  const [extrasMeal, setExtrasMeal] = useState<MealType>(
    editingOrder?.meal_type && editingOrder.meal_type !== 'all' ? editingOrder.meal_type : 'lunch'
  );
  const [loadingExtras, setLoadingExtras] = useState(false);
  const [extrasSource, setExtrasSource] = useState('');

  // Picker for adding a meal to the items table
  const [pickerMealId, setPickerMealId] = useState<string>('');
  const [showAddDeliveryMeal, setShowAddDeliveryMeal] = useState(false);
  const [newMealName, setNewMealName] = useState('');
  const [newMealType, setNewMealType] = useState<MealType>('lunch');
  const [newMealIsSnack, setNewMealIsSnack] = useState(false);
  const [savingDeliveryMeal, setSavingDeliveryMeal] = useState(false);

  // Manage saved meals (edit/delete)
  const [showManageMeals, setShowManageMeals] = useState(false);
  const [editingMealId, setEditingMealId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editMealType, setEditMealType] = useState<MealType>('lunch');
  const [editIsSnack, setEditIsSnack] = useState(false);
  const [savingEditMeal, setSavingEditMeal] = useState(false);
  const [deletingMealId, setDeletingMealId] = useState<string | null>(null);

  // Initial load
  useEffect(() => {
    (async () => {
      const [citiesRes, locsRes, mealsRes] = await Promise.all([
        fetch('/api/cities').then(r => r.ok ? r.json() : []),
        fetch('/api/delivery-locations').then(r => r.ok ? r.json() : []),
        fetch('/api/delivery-meals').then(r => r.ok ? r.json() : []),
      ]);
      setCities(citiesRes ?? []);
      setLocations(locsRes ?? []);
      setDeliveryMeals(mealsRes ?? []);
    })();
  }, []);

  /**
   * أوامر التشغيل تُجلب مفلترة بالفئة من القاعدة لا بعد القراءة: السقف ١٠٠
   * صف، ولو فلترنا محلياً بعد جلب المختلط قد لا يبقى ولا أمر مرافقين في
   * القائمة رغم وجودها فعلاً. ولو عمود entity_type غير موجود (الترقية ما
   * اتشغّلت) نرجع للقائمة كاملة بدل ما تطلع فاضية.
   */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const columns = 'id, date, meal_type, week_number, day_of_week, entity_type, created_at';
      let res = await supabase.from('daily_orders')
        .select(columns)
        .eq('entity_type', entityType)
        .order('date', { ascending: false })
        .limit(100);
      if (res.error && /entity_type|column/i.test(res.error.message)) {
        res = await supabase.from('daily_orders')
          .select('id, date, meal_type, week_number, day_of_week, created_at')
          .order('date', { ascending: false })
          .limit(100) as typeof res;
      }
      if (cancelled) return;
      setProductionOrders((res.data ?? []) as unknown as DailyOrder[]);
    })();
    return () => { cancelled = true; };
  }, [entityType]);

  // Group delivery meals by (meal_type, is_snack) for the dropdown
  const groupedMeals = useMemo(() => {
    const groups: { key: string; label: string; items: DeliveryMeal[] }[] = [];
    const order: { mealType: MealType; isSnack: boolean; label: string }[] = [
      { mealType: 'breakfast', isSnack: false, label: 'وجبات الفطور' },
      { mealType: 'breakfast', isSnack: true,  label: 'سناكات الفطور' },
      { mealType: 'lunch',     isSnack: false, label: 'وجبات الغداء' },
      { mealType: 'lunch',     isSnack: true,  label: 'سناكات الغداء' },
      { mealType: 'dinner',    isSnack: false, label: 'وجبات العشاء' },
      { mealType: 'dinner',    isSnack: true,  label: 'سناكات العشاء' },
    ];
    for (const g of order) {
      const list = deliveryMeals.filter(m => m.meal_type === g.mealType && m.is_snack === g.isSnack);
      if (list.length > 0) groups.push({ key: `${g.mealType}-${g.isSnack}`, label: g.label, items: list });
    }
    return groups;
  }, [deliveryMeals]);

  const addItemFromMealId = (mealId: string) => {
    const m = deliveryMeals.find(x => x.id === mealId);
    if (!m) return;
    setItems(prev => [...prev, {
      display_name: m.name,
      meal_type: m.meal_type,
      quantity: 0,
    }]);
    setPickerMealId('');
  };

  const startEditMeal = (m: DeliveryMeal) => {
    setEditingMealId(m.id);
    setEditName(m.name);
    setEditMealType(m.meal_type);
    setEditIsSnack(m.is_snack);
  };

  const cancelEditMeal = () => {
    setEditingMealId(null);
    setEditName('');
    setEditIsSnack(false);
  };

  const handleSaveEditMeal = async () => {
    if (!editingMealId) return;
    const name = editName.trim();
    if (!name) return;
    setSavingEditMeal(true);
    try {
      const res = await fetch(`/api/delivery-meals/${editingMealId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, meal_type: editMealType, is_snack: editIsSnack }),
      });
      const j = await res.json();
      if (!res.ok) { alert(j.error ?? 'تعذّر حفظ التعديل'); return; }
      setDeliveryMeals(prev => prev.map(m => m.id === editingMealId ? j : m).sort((a, b) => {
        if (a.meal_type !== b.meal_type) return a.meal_type.localeCompare(b.meal_type);
        if (a.is_snack !== b.is_snack) return a.is_snack ? 1 : -1;
        return a.name.localeCompare(b.name);
      }));
      cancelEditMeal();
    } finally {
      setSavingEditMeal(false);
    }
  };

  const handleDeleteMeal = async (m: DeliveryMeal) => {
    if (!confirm(`حذف الصنف "${m.name}"؟ الأوامر السابقة لن تتأثر، لكنه ينحذف من قائمة الأصناف.`)) return;
    setDeletingMealId(m.id);
    try {
      const res = await fetch(`/api/delivery-meals/${m.id}`, { method: 'DELETE' });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        alert(j.error ?? 'تعذّر الحذف');
        return;
      }
      setDeliveryMeals(prev => prev.filter(x => x.id !== m.id));
      if (editingMealId === m.id) cancelEditMeal();
    } finally {
      setDeletingMealId(null);
    }
  };

  const handleAddDeliveryMeal = async () => {
    const name = newMealName.trim();
    if (!name) return;
    setSavingDeliveryMeal(true);
    try {
      const res = await fetch('/api/delivery-meals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, meal_type: newMealType, is_snack: newMealIsSnack }),
      });
      const j = await res.json();
      if (!res.ok) { alert(j.error ?? 'تعذّر إضافة الصنف'); return; }
      setDeliveryMeals(prev => [...prev, j].sort((a, b) => {
        if (a.meal_type !== b.meal_type) return a.meal_type.localeCompare(b.meal_type);
        if (a.is_snack !== b.is_snack) return a.is_snack ? 1 : -1;
        return a.name.localeCompare(b.name);
      }));
      // أضفه فوراً للجدول
      setItems(prev => [...prev, {
        display_name: j.name,
        meal_type: j.meal_type,
        quantity: 0,
      }]);
      setShowAddDeliveryMeal(false);
      setNewMealName('');
      setNewMealIsSnack(false);
    } finally {
      setSavingDeliveryMeal(false);
    }
  };

  const filteredLocations = useMemo(
    () => cityId ? locations.filter(l => l.city_id === cityId) : locations,
    [locations, cityId]
  );

  // Sync cityId مع location المختار
  useEffect(() => {
    if (locationId) {
      const loc = locations.find(l => l.id === locationId);
      if (loc?.city_id && loc.city_id !== cityId) setCityId(loc.city_id);
    }
  }, [locationId, locations, cityId]);

  const loadFromProductionOrder = async (orderId: string) => {
    setLoadingFromOrder(true);
    setError('');
    try {
      const res = await fetch(`/api/orders/${orderId}/report`);
      if (!res.ok) {
        setError('تعذّر جلب بيانات أمر التشغيل');
        return;
      }
      const report: ReportPayload = await res.json();

      // ندمج الأصناف الرئيسية + السناكات + البدائل + الثابتة في صفوف
      const drafted: DraftItem[] = [];
      for (const it of report.mainMealsSummary ?? []) {
        if ((it.gets ?? 0) > 0) drafted.push({ display_name: it.meal.name, meal_type: report.order.meal_type, quantity: it.gets ?? 0 });
      }
      for (const it of report.snackMealsSummary ?? []) {
        if ((it.gets ?? 0) > 0) drafted.push({ display_name: it.meal.name, meal_type: report.order.meal_type, quantity: it.gets ?? 0 });
      }
      for (const it of report.altSummary ?? []) {
        if ((it.qty ?? 0) > 0) drafted.push({ display_name: `بديل: ${it.meal.name}`, meal_type: report.order.meal_type, quantity: it.qty ?? 0 });
      }
      for (const it of report.snackAltSummary ?? []) {
        if ((it.qty ?? 0) > 0) drafted.push({ display_name: `بديل سناك: ${it.meal.name}`, meal_type: report.order.meal_type, quantity: it.qty ?? 0 });
      }
      for (const it of report.fixedSummary ?? []) {
        if ((it.qty ?? 0) > 0) drafted.push({ display_name: it.meal.name, meal_type: report.order.meal_type, quantity: it.qty ?? 0, is_extra: true });
      }

      setItems(drafted);
      setSourceOrderId(orderId);
      setMealType(report.order.meal_type);
      setDate(report.order.date);
      setStep('edit');
    } finally {
      setLoadingFromOrder(false);
    }
  };

  const addEmptyItem = (is_extra = false) => {
    setItems(prev => [...prev, { display_name: '', meal_type: is_extra ? extrasMeal : mealType, quantity: 0, is_extra }]);
  };

  /**
   * يسحب «الأصناف اليومية الإضافية» لتاريخ الأمر والوجبة المختارة، بنفس
   * أرقام أمر التشغيل حرفياً:
   *  ١) لو فيه أمر تشغيل لنفس (التاريخ + الوجبة + الفئة) → من تقريره. التقرير
   *     يُحسب حيّاً للأيام القادمة (آخر تعديل على المستفيد ينعكس)، ومجمّداً
   *     للأيام الماضية (اللقطة وقت الحفظ) — فإضافة سُجّلت بعد اليوم ما تدخل
   *     أمراً قبلها، والمحذوفة بعده تبقى في أمره.
   *  ٢) وإلا → من المسجّل حالياً على المستفيدين حسب يوم الأسبوع. التسجيل ما
   *     يحفظ تاريخ إضافة موثوقاً (الحفظ يحذف ويعيد إدراج الأصناف)، فلو
   *     التاريخ ماضٍ ننبّه إن الأرقام بوضع اليوم.
   * السحب يستبدل إضافات نفس الوجبة فقط عشان إعادة السحب ما تكرّر الأصناف.
   */
  const pullExtras = async () => {
    setLoadingExtras(true);
    setError('');
    setExtrasSource('');
    try {
      let src = await supabase.from('daily_orders')
        .select('id').eq('date', date).eq('meal_type', extrasMeal).eq('entity_type', entityType)
        .order('created_at', { ascending: false }).limit(1);
      if (src.error && /entity_type|column/i.test(src.error.message)) {
        src = await supabase.from('daily_orders')
          .select('id').eq('date', date).eq('meal_type', extrasMeal)
          .order('created_at', { ascending: false }).limit(1);
      }
      const opOrderId = (src.data?.[0] as { id: string } | undefined)?.id;

      let rows: { name: string; qty: number }[];
      if (opOrderId) {
        const res = await fetch(`/api/orders/${opOrderId}/report`);
        const j = await res.json().catch(() => ({}));
        if (!res.ok) { setError(j.error ?? 'تعذّر جلب تقرير أمر التشغيل'); return; }
        rows = ((j as ReportPayload).fixedSummary ?? []).map(r => ({ name: r.meal.name, qty: r.qty ?? 0 }));
        setExtrasSource(`من أمر تشغيل ${MEAL_TYPE_LABELS[extrasMeal]} ${date}`);
      } else {
        const res = await fetch('/api/reports/fixed-extras', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ from: date, to: date, meal_types: [extrasMeal], entity_type: entityType }),
        });
        const j = await res.json().catch(() => ({}));
        if (!res.ok) { setError(j.error ?? 'تعذّر جلب الإضافات'); return; }
        rows = ((j.rows ?? []) as { meal: { name: string }; total: number }[]).map(r => ({ name: r.meal.name, qty: r.total }));
        setExtrasSource(date < todayISO()
          ? `⚠ ما فيه أمر تشغيل لهذا اليوم — الأرقام من تسجيل المستفيدين الحالي (قد يختلف عمّا كان يوم ${date})`
          : 'ما فيه أمر تشغيل لهذا اليوم — من تسجيل المستفيدين الحالي');
      }

      rows = rows.filter(r => r.qty > 0);
      if (rows.length === 0) {
        alert(`ما فيه أصناف إضافية لـ${ENTITY_TYPE_LABELS_PLURAL[entityType]} في ${MEAL_TYPE_LABELS[extrasMeal]} بتاريخ ${date}`);
        return;
      }
      setItems(prev => [
        ...prev.filter(it => !(it.is_extra && it.meal_type === extrasMeal)),
        ...rows.map(r => ({ display_name: r.name, meal_type: extrasMeal as DeliveryMealType, quantity: r.qty, is_extra: true })),
      ]);
    } finally {
      setLoadingExtras(false);
    }
  };

  // القسمان يتشاركان مصفوفة واحدة — نحفظ الفهرس الأصلي لكل بند
  const indexed = items.map((it, idx) => ({ it, idx }));
  const mainItems = indexed.filter(x => !x.it.is_extra);
  const extraItems = indexed.filter(x => x.it.is_extra);

  const updateItem = (idx: number, patch: Partial<DraftItem>) => {
    setItems(prev => prev.map((it, i) => i === idx ? { ...it, ...patch } : it));
  };

  const removeItem = (idx: number) => {
    setItems(prev => prev.filter((_, i) => i !== idx));
  };

  // City/Location creation (inline)
  const handleAddCity = async () => {
    const name = newCityName.trim();
    if (!name) return;
    setSavingCity(true);
    try {
      const res = await fetch('/api/cities', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      const j = await res.json();
      if (!res.ok) { alert(j.error ?? 'تعذّر إضافة المدينة'); return; }
      setCities(prev => [...prev, j].sort((a, b) => a.name.localeCompare(b.name)));
      setCityId(j.id);
      setShowAddCity(false);
      setNewCityName('');
    } finally {
      setSavingCity(false);
    }
  };

  const handleAddLocation = async () => {
    const name = newLocationName.trim();
    if (!name) return;
    setSavingLocation(true);
    try {
      const res = await fetch('/api/delivery-locations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, city_id: cityId || null }),
      });
      const j = await res.json();
      if (!res.ok) { alert(j.error ?? 'تعذّر إضافة الموقع'); return; }
      setLocations(prev => [...prev, j].sort((a, b) => a.name.localeCompare(b.name)));
      setLocationId(j.id);
      setShowAddLocation(false);
      setNewLocationName('');
    } finally {
      setSavingLocation(false);
    }
  };

  // Signature upload
  const uploadSignature = async (
    file: File,
    target: 'creator' | 'receiver',
  ) => {
    setUploadingSig(target);
    try {
      const ext = (file.name.split('.').pop() ?? 'png').toLowerCase();
      const path = `delivery-orders/${target}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
      const { error: upErr } = await supabase.storage
        .from('signatures')
        .upload(path, file, { contentType: file.type, upsert: false });
      if (upErr) { alert(`تعذّر رفع التوقيع: ${upErr.message}`); return; }
      const { data: pub } = supabase.storage.from('signatures').getPublicUrl(path);
      const url = pub.publicUrl;
      if (target === 'creator') setCreatorSignature(url);
      else setReceiverSignature(url);
    } finally {
      setUploadingSig(null);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!locationId) { setError('اختر موقع التسليم'); return; }
    if (items.length === 0) { setError('يرجى إضافة صنف واحد على الأقل'); return; }

    // Validate each item
    for (const it of items) {
      if (!it.display_name.trim()) { setError('كل صنف لازم يكون له اسم'); return; }
    }

    setSaving(true);
    try {
      const payload = {
        source_order_id: sourceOrderId,
        entity_type: entityType,
        date,
        meal_type: mealType,
        delivery_location_id: locationId,
        creator_id: null,
        created_by_name: null,
        created_by_phone: null,
        delivery_date: null,
        delivery_time: null,
        notes: notes.trim() || null,
        creator_signature_url: creatorSignature,
        receiver_signature_url: receiverSignature,
        items: [...items]
          .sort((a, b) =>
            Number(!!a.is_extra) - Number(!!b.is_extra)
            || DELIVERY_MEAL_ORDER.indexOf(a.meal_type) - DELIVERY_MEAL_ORDER.indexOf(b.meal_type))
          .map(it => ({
          display_name: savedItemName(it),
          meal_type: it.meal_type,
          quantity: it.quantity,
          receiver_signature_url: it.receiver_signature_url ?? null,
        })),
      };

      const url = isEdit ? `/api/delivery-orders/${editingOrder!.id}` : '/api/delivery-orders';
      const method = isEdit ? 'PUT' : 'POST';
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const j = await res.json();
      if (!res.ok) { setError(j.error ?? 'تعذّر الحفظ'); return; }

      void logActivity({
        action: isEdit ? 'update' : 'create',
        entity_type: 'order',
        entity_id: j.id ?? editingOrder?.id ?? null,
        entity_name: `أمر تسليم ${j.order_number ?? editingOrder?.order_number ?? ''} — ${ENTITY_TYPE_LABELS_PLURAL[entityType]}`,
        details: (() => {
          // البنود تُوصف «الاسم ×الكمية» فيظهر تغيير الكمية سطراً مُزالاً وآخر مُضافاً
          const describeItem = (it: { display_name: string; quantity: number; is_extra?: boolean }) =>
            `${savedItemName(it)} ×${it.quantity}`;
          const after = {
            date, meal_type: mealType, notes: notes.trim() || null,
            entity_type: entityType,
          };
          if (!isEdit) {
            return {
              ...valueDetails(after),
              items: items.map(describeItem),
              items_count: items.length,
            };
          }
          return updateDetails(
            {
              date: editingOrder?.date,
              meal_type: editingOrder?.meal_type,
              notes: editingOrder?.notes ?? null,
              entity_type: editingOrder?.entity_type ?? 'beneficiary',
            },
            after,
            ['date', 'meal_type', 'notes', 'entity_type'],
            {
              ...listDiffDetails(
                'items',
                (editingOrder?.delivery_order_items ?? []).map(describeItem),
                items.map(describeItem),
              ),
              items_count: items.length,
            },
          );
        })(),
      });

      onSaved();
    } finally {
      setSaving(false);
    }
  };

  // ── Entity picker step ────────────────────────────────────────────────────
  // الخطوة الأولى في الإنشاء: لمن هذا الأمر؟ نفس ترتيب صفحة أوامر التشغيل.
  if (step === 'pick_entity') {
    return (
      <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl w-full max-w-sm shadow-2xl overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-100 flex items-start justify-between gap-3">
            <div>
              <h3 className="font-bold text-slate-800">أمر تسليم لمن؟</h3>
              <p className="text-xs text-slate-500 mt-0.5">
                اختَر الفئة أولاً — تُعرض بعدها أوامر التشغيل الخاصة بها فقط.
              </p>
            </div>
            <button
              onClick={onClose}
              className="w-8 h-8 shrink-0 flex items-center justify-center text-slate-400 hover:bg-slate-100 rounded-lg"
            >
              ✕
            </button>
          </div>
          <div className="p-4 grid grid-cols-2 gap-3">
            {(['beneficiary', 'companion'] as EntityType[]).map(t => (
              <button
                key={t}
                type="button"
                onClick={() => { setEntityType(t); setStep('pick_mode'); }}
                className={`flex flex-col items-center gap-2 py-5 rounded-xl border-2 transition-all hover:shadow-md ${
                  t === 'beneficiary'
                    ? 'border-emerald-200 bg-emerald-50 hover:bg-emerald-100 text-emerald-800'
                    : 'border-indigo-200 bg-indigo-50 hover:bg-indigo-100 text-indigo-800'
                }`}
              >
                <span className="text-3xl">{ENTITY_ICON[t]}</span>
                <span className="font-bold text-sm">{ENTITY_TYPE_LABELS_PLURAL[t]}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    );
  }

  // ── Mode picker step ──────────────────────────────────────────────────────
  if (step === 'pick_mode') {
    return (
      <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="font-bold text-slate-800">إنشاء أمر تسليم</h3>
              <span className={`badge ${ENTITY_BADGE_STYLES[entityType]}`}>
                {ENTITY_ICON[entityType]} {ENTITY_TYPE_LABELS_PLURAL[entityType]}
              </span>
            </div>
            <button onClick={onClose} className="w-8 h-8 shrink-0 flex items-center justify-center text-slate-400 hover:bg-slate-100 rounded-lg">✕</button>
          </div>
          <div className="p-5 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm text-slate-500">اختر طريقة إنشاء الأمر:</p>
              {/* الرجوع للفئة يعيد ضبط الاختيار قبل ما يُبنى الأمر — بعد
                  الدخول لشاشة التحرير الفئة تتبع الأمر نفسه */}
              <button
                type="button"
                onClick={() => { setStep('pick_entity'); setSourceOrderId(null); }}
                className="text-xs font-semibold text-slate-500 hover:text-slate-700 px-2 py-1 rounded-lg hover:bg-slate-100"
              >
                ← تغيير الفئة
              </button>
            </div>
            <button
              type="button"
              onClick={() => { setMode('from_order'); }}
              className={`w-full text-right p-4 rounded-xl border-2 transition-all hover:shadow-md ${
                mode === 'from_order'
                  ? 'border-emerald-300 bg-emerald-50'
                  : 'border-slate-200 hover:border-emerald-200'
              }`}
            >
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-emerald-100 flex items-center justify-center text-2xl">📋</div>
                <div className="flex-1">
                  <div className="font-bold text-slate-800">جلب من أمر تشغيل</div>
                  <div className="text-xs text-slate-500 mt-0.5">تجلب الأصناف والكميات من أمر تشغيل موجود</div>
                </div>
              </div>
            </button>

            <button
              type="button"
              onClick={() => { setMode('manual'); setStep('edit'); }}
              className={`w-full text-right p-4 rounded-xl border-2 transition-all hover:shadow-md ${
                mode === 'manual'
                  ? 'border-blue-300 bg-blue-50'
                  : 'border-slate-200 hover:border-blue-200'
              }`}
            >
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-blue-100 flex items-center justify-center text-2xl">✍️</div>
                <div className="flex-1">
                  <div className="font-bold text-slate-800">إنشاء يدوي</div>
                  <div className="text-xs text-slate-500 mt-0.5">تضيف الأصناف والكميات بنفسك</div>
                </div>
              </div>
            </button>

            {mode === 'from_order' && (
              <div className="pt-2 space-y-2">
                <label className="label">
                  اختر أمر التشغيل ({ENTITY_TYPE_LABELS_PLURAL[entityType]})
                </label>
                <select
                  className="input-field"
                  defaultValue=""
                  onChange={(e) => { if (e.target.value) loadFromProductionOrder(e.target.value); }}
                  disabled={loadingFromOrder}
                >
                  <option value="">— اختر أمر تشغيل —</option>
                  {productionOrders.map(o => (
                    <option key={o.id} value={o.id}>
                      {o.date} — {DELIVERY_MEAL_TYPE_LABELS[o.meal_type]}
                    </option>
                  ))}
                </select>
                {loadingFromOrder && (
                  <p className="text-xs text-slate-500">جاري جلب بيانات الأمر...</p>
                )}
                {!loadingFromOrder && productionOrders.length === 0 && (
                  <p className="text-xs text-amber-600">
                    ما فيه أوامر تشغيل لـ{ENTITY_TYPE_LABELS_PLURAL[entityType]} —
                    أنشئ أمر تشغيل أولاً، أو اختر «إنشاء يدوي».
                  </p>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  // ── Edit step ─────────────────────────────────────────────────────────────
  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl w-full max-w-4xl shadow-2xl max-h-[92vh] overflow-hidden flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 shrink-0">
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-bold text-slate-800">
              {isEdit ? `تعديل أمر التسليم — ${editingOrder!.order_number}` : 'إنشاء أمر تسليم جديد'}
            </h2>
            <span className={`badge ${ENTITY_BADGE_STYLES[entityType]}`}>
              {ENTITY_ICON[entityType]} {ENTITY_TYPE_LABELS_PLURAL[entityType]}
            </span>
            {sourceOrderId && (
              <span className="badge bg-emerald-100 text-emerald-700">من أمر تشغيل</span>
            )}
          </div>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center text-slate-400 hover:bg-slate-100 rounded-lg">✕</button>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col flex-1 overflow-hidden">
          <div className="p-6 space-y-5 overflow-y-auto flex-1">

            {/* الصف الأول: نوع الوجبة + التاريخ */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="label">نوع الوجبة <span className="text-red-500">*</span></label>
                <select
                  value={mealType}
                  onChange={e => setMealType(e.target.value as DeliveryMealType)}
                  className="input-field"
                  required
                >
                  {Object.entries(DELIVERY_MEAL_TYPE_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              </div>
              <div>
                <label className="label">التاريخ <span className="text-red-500">*</span></label>
                <input type="date" value={date} onChange={e => setDate(e.target.value)} className="input-field" required />
              </div>
            </div>

            {/* المدينة + موقع التسليم */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="label">المدينة</label>
                <div className="flex gap-2">
                  <select
                    value={cityId}
                    onChange={e => { setCityId(e.target.value); setLocationId(''); }}
                    className="input-field flex-1"
                  >
                    <option value="">— كل المدن —</option>
                    {cities.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                  <button
                    type="button"
                    onClick={() => setShowAddCity(true)}
                    className="px-3 py-2 bg-emerald-50 text-emerald-700 rounded-lg hover:bg-emerald-100 text-sm font-semibold"
                    title="إضافة مدينة"
                  >
                    +
                  </button>
                </div>
                {showAddCity && (
                  <div className="mt-2 p-2 border border-emerald-200 bg-emerald-50 rounded-lg flex gap-2">
                    <input
                      type="text"
                      value={newCityName}
                      onChange={e => setNewCityName(e.target.value)}
                      placeholder="اسم المدينة الجديدة"
                      className="input-field flex-1 py-1.5 text-sm"
                      autoFocus
                    />
                    <button
                      type="button"
                      disabled={savingCity}
                      onClick={handleAddCity}
                      className="px-3 py-1.5 bg-emerald-600 text-white rounded-lg text-sm font-semibold disabled:opacity-50"
                    >
                      {savingCity ? '...' : 'حفظ'}
                    </button>
                    <button
                      type="button"
                      onClick={() => { setShowAddCity(false); setNewCityName(''); }}
                      className="px-3 py-1.5 bg-white border border-slate-200 rounded-lg text-sm"
                    >
                      إلغاء
                    </button>
                  </div>
                )}
              </div>

              <div>
                <label className="label">موقع التسليم <span className="text-red-500">*</span></label>
                <div className="flex gap-2">
                  <select
                    value={locationId}
                    onChange={e => setLocationId(e.target.value)}
                    className="input-field flex-1"
                    required
                  >
                    <option value="">— اختر الموقع —</option>
                    {filteredLocations.map(l => (
                      <option key={l.id} value={l.id}>
                        {l.name}{l.cities?.name ? ` — ${l.cities.name}` : ''}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={() => setShowAddLocation(true)}
                    className="px-3 py-2 bg-emerald-50 text-emerald-700 rounded-lg hover:bg-emerald-100 text-sm font-semibold"
                    title="إضافة موقع"
                  >
                    +
                  </button>
                </div>
                {showAddLocation && (
                  <div className="mt-2 p-2 border border-emerald-200 bg-emerald-50 rounded-lg flex gap-2">
                    <input
                      type="text"
                      value={newLocationName}
                      onChange={e => setNewLocationName(e.target.value)}
                      placeholder={`اسم الموقع${cityId ? ` في ${cities.find(c => c.id === cityId)?.name ?? ''}` : ''}`}
                      className="input-field flex-1 py-1.5 text-sm"
                      autoFocus
                    />
                    <button
                      type="button"
                      disabled={savingLocation}
                      onClick={handleAddLocation}
                      className="px-3 py-1.5 bg-emerald-600 text-white rounded-lg text-sm font-semibold disabled:opacity-50"
                    >
                      {savingLocation ? '...' : 'حفظ'}
                    </button>
                    <button
                      type="button"
                      onClick={() => { setShowAddLocation(false); setNewLocationName(''); }}
                      className="px-3 py-1.5 bg-white border border-slate-200 rounded-lg text-sm"
                    >
                      إلغاء
                    </button>
                  </div>
                )}
              </div>
            </div>

            {/* جدول الأصناف */}
            <div>
              <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
                <p className="label mb-0">الأصناف</p>
                <div className="flex items-center gap-2 flex-wrap">
                  <select
                    value={pickerMealId}
                    onChange={e => { if (e.target.value) addItemFromMealId(e.target.value); }}
                    className="text-xs px-2 py-1.5 border border-slate-200 rounded-lg focus:outline-none focus:border-emerald-400 bg-white"
                  >
                    <option value="">— اختر صنف من القائمة —</option>
                    {groupedMeals.map(g => (
                      <optgroup key={g.key} label={g.label}>
                        {g.items.map(m => (
                          <option key={m.id} value={m.id}>{m.name}</option>
                        ))}
                      </optgroup>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={() => setShowAddDeliveryMeal(true)}
                    className="text-xs px-3 py-1.5 bg-emerald-50 text-emerald-700 rounded-lg font-semibold hover:bg-emerald-100"
                  >
                    + صنف جديد
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowManageMeals(v => !v)}
                    className={`text-xs px-3 py-1.5 rounded-lg font-semibold border ${
                      showManageMeals
                        ? 'bg-violet-100 text-violet-800 border-violet-300'
                        : 'bg-violet-50 text-violet-700 border-violet-200 hover:bg-violet-100'
                    }`}
                    title="تعديل/حذف الأصناف المحفوظة"
                  >
                    ⚙ إدارة الأصناف
                  </button>
                  <button
                    type="button"
                    onClick={() => addEmptyItem()}
                    className="text-xs px-3 py-1.5 bg-slate-50 text-slate-700 rounded-lg font-semibold hover:bg-slate-100 border border-slate-200"
                    title="صنف يدوي بدون حفظ في القائمة"
                  >
                    + صف يدوي
                  </button>
                </div>
              </div>

              {showManageMeals && (
                <div className="mb-2 p-3 border border-violet-200 bg-violet-50/40 rounded-lg space-y-2 max-h-72 overflow-y-auto">
                  <p className="text-xs font-semibold text-violet-900">إدارة الأصناف المحفوظة</p>
                  {deliveryMeals.length === 0 ? (
                    <p className="text-xs text-slate-500 py-3 text-center">لا توجد أصناف محفوظة بعد</p>
                  ) : (
                    groupedMeals.map(g => (
                      <div key={g.key} className="space-y-1">
                        <p className="text-[11px] font-bold text-slate-500 uppercase">{g.label}</p>
                        <div className="space-y-1">
                          {g.items.map(m => (
                            editingMealId === m.id ? (
                              <div key={m.id} className="p-2 bg-white border border-emerald-300 rounded-lg space-y-2">
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                                  <input
                                    type="text"
                                    value={editName}
                                    onChange={e => setEditName(e.target.value)}
                                    placeholder="اسم الصنف"
                                    className="input-field py-1 text-sm"
                                    autoFocus
                                  />
                                  <select
                                    value={editMealType}
                                    onChange={e => setEditMealType(e.target.value as MealType)}
                                    className="input-field py-1 text-sm"
                                  >
                                    {Object.entries(MEAL_TYPE_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                                  </select>
                                </div>
                                <label className="flex items-center gap-2 text-xs text-slate-700 cursor-pointer">
                                  <input
                                    type="checkbox"
                                    checked={editIsSnack}
                                    onChange={e => setEditIsSnack(e.target.checked)}
                                    className="w-4 h-4 accent-emerald-600"
                                  />
                                  سناك
                                </label>
                                <div className="flex justify-end gap-2">
                                  <button
                                    type="button"
                                    disabled={savingEditMeal}
                                    onClick={handleSaveEditMeal}
                                    className="px-3 py-1 bg-emerald-600 text-white rounded-lg text-xs font-semibold disabled:opacity-50"
                                  >
                                    {savingEditMeal ? '...' : 'حفظ'}
                                  </button>
                                  <button
                                    type="button"
                                    onClick={cancelEditMeal}
                                    className="px-3 py-1 bg-white border border-slate-200 rounded-lg text-xs"
                                  >
                                    إلغاء
                                  </button>
                                </div>
                              </div>
                            ) : (
                              <div key={m.id} className="flex items-center gap-2 px-2 py-1 bg-white border border-slate-200 rounded-lg">
                                <span className="flex-1 text-sm text-slate-700 truncate">{m.name}</span>
                                <button
                                  type="button"
                                  onClick={() => startEditMeal(m)}
                                  className="p-1 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded"
                                  title="تعديل"
                                >
                                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                                  </svg>
                                </button>
                                <button
                                  type="button"
                                  disabled={deletingMealId === m.id}
                                  onClick={() => handleDeleteMeal(m)}
                                  className="p-1 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded disabled:opacity-40"
                                  title="حذف"
                                >
                                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                  </svg>
                                </button>
                              </div>
                            )
                          ))}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              )}

              {showAddDeliveryMeal && (
                <div className="mb-2 p-3 border border-emerald-200 bg-emerald-50 rounded-lg space-y-2">
                  <p className="text-xs font-semibold text-emerald-900">إضافة صنف جديد لقائمة أصناف التسليم</p>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                    <input
                      type="text"
                      value={newMealName}
                      onChange={e => setNewMealName(e.target.value)}
                      placeholder="اسم الصنف"
                      className="input-field py-1.5 text-sm"
                      autoFocus
                    />
                    <select
                      value={newMealType}
                      onChange={e => setNewMealType(e.target.value as MealType)}
                      className="input-field py-1.5 text-sm"
                    >
                      {Object.entries(MEAL_TYPE_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                    </select>
                  </div>
                  <label className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={newMealIsSnack}
                      onChange={e => setNewMealIsSnack(e.target.checked)}
                      className="w-4 h-4 accent-emerald-600"
                    />
                    سناك (وليس وجبة رئيسية)
                  </label>
                  <div className="flex justify-end gap-2">
                    <button
                      type="button"
                      disabled={savingDeliveryMeal}
                      onClick={handleAddDeliveryMeal}
                      className="px-3 py-1.5 bg-emerald-600 text-white rounded-lg text-sm font-semibold disabled:opacity-50"
                    >
                      {savingDeliveryMeal ? '...' : 'حفظ وأضف للأمر'}
                    </button>
                    <button
                      type="button"
                      onClick={() => { setShowAddDeliveryMeal(false); setNewMealName(''); setNewMealIsSnack(false); }}
                      className="px-3 py-1.5 bg-white border border-slate-200 rounded-lg text-sm"
                    >
                      إلغاء
                    </button>
                  </div>
                </div>
              )}

              {mainItems.length === 0 ? (
                <div className="border border-dashed border-slate-200 rounded-xl p-6 text-center text-slate-400 text-sm">
                  لا توجد أصناف بعد — اضغط &quot;+ إضافة صنف&quot;
                </div>
              ) : (
                <div className="overflow-x-auto border border-slate-200 rounded-xl">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-slate-50">
                        <th className="px-2 py-2 text-center font-semibold text-slate-600 w-12">#</th>
                        <th className="px-2 py-2 text-right font-semibold text-slate-600">وصف الصنف</th>
                        <th className="px-2 py-2 text-right font-semibold text-slate-600 w-32">نوع الوجبة</th>
                        <th className="px-2 py-2 text-center font-semibold text-slate-600 w-24">العدد</th>
                        <th className="px-2 py-2 text-center w-12"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {groupByMeal(mainItems, x => x.it.meal_type).map(g => (
                        <Fragment key={g.mealType}>
                        <tr className={`border-t border-slate-200 ${MEAL_SECTION_STYLE[g.mealType]}`}>
                          <td colSpan={5} className="px-3 py-1.5 text-xs font-bold">
                            {MEAL_ICON[g.mealType]} {DELIVERY_MEAL_TYPE_LABELS[g.mealType]}
                            <span className="font-semibold opacity-70"> — {g.items.length} صنف، المجموع {g.items.reduce((a, x) => a + x.it.quantity, 0)}</span>
                          </td>
                        </tr>
                        {g.items.map(({ it, idx }, n) => (
                        <tr key={idx} className="border-t border-slate-100">
                          <td className="px-2 py-1.5 text-center text-slate-400">{n + 1}</td>
                          <td className="px-2 py-1.5">
                            <input
                              type="text"
                              value={it.display_name}
                              onChange={e => updateItem(idx, { display_name: e.target.value })}
                              placeholder="اسم الصنف"
                              className="w-full px-2 py-1.5 border border-slate-200 rounded-lg focus:outline-none focus:border-emerald-400"
                              required
                            />
                          </td>
                          <td className="px-2 py-1.5">
                            <select
                              value={it.meal_type}
                              onChange={e => updateItem(idx, { meal_type: e.target.value as DeliveryMealType })}
                              className="w-full px-2 py-1.5 border border-slate-200 rounded-lg focus:outline-none focus:border-emerald-400 text-xs"
                            >
                              {Object.entries(DELIVERY_MEAL_TYPE_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                            </select>
                          </td>
                          <td className="px-2 py-1.5">
                            <input
                              type="number"
                              min={0}
                              value={it.quantity}
                              onChange={e => updateItem(idx, { quantity: parseInt(e.target.value) || 0 })}
                              className="w-full text-center px-2 py-1.5 border border-slate-200 rounded-lg focus:outline-none focus:border-emerald-400 font-bold text-emerald-700"
                            />
                          </td>
                          <td className="px-2 py-1.5 text-center">
                            <button
                              type="button"
                              onClick={() => removeItem(idx)}
                              className="text-slate-400 hover:text-red-600 p-1"
                              title="حذف"
                            >
                              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                              </svg>
                            </button>
                          </td>
                        </tr>
                        ))}
                        </Fragment>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {/* الأصناف اليومية الإضافية — قسم مضغوط: سطر واحد لو فاضي */}
              <div className="mt-3 border border-violet-200 bg-violet-50/40 rounded-xl p-2">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs font-bold text-violet-900">
                    الأصناف اليومية الإضافية
                    {extraItems.length > 0 && (
                      <span className="font-semibold text-violet-600">
                        {' '}({extraItems.length} — المجموع {extraItems.reduce((a, x) => a + x.it.quantity, 0)})
                      </span>
                    )}
                  </p>
                  <div className="flex items-center gap-1.5">
                    <select
                      value={extrasMeal}
                      onChange={e => setExtrasMeal(e.target.value as MealType)}
                      className="text-xs px-1.5 py-1 border border-violet-200 rounded-lg bg-white focus:outline-none"
                    >
                      {Object.entries(MEAL_TYPE_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                    </select>
                    <button
                      type="button"
                      onClick={pullExtras}
                      disabled={loadingExtras}
                      className="text-xs px-2 py-1 bg-violet-600 text-white rounded-lg font-semibold hover:bg-violet-700 disabled:opacity-50"
                      title="يجلب الأصناف الإضافية المسجّلة على المستفيدين لتاريخ الأمر والوجبة المختارة"
                    >
                      {loadingExtras ? '...' : '⬇ ضيف الإضافات'}
                    </button>
                    <button
                      type="button"
                      onClick={() => addEmptyItem(true)}
                      className="text-xs px-2 py-1 bg-white text-violet-700 rounded-lg font-semibold hover:bg-violet-100 border border-violet-200"
                      title="صنف إضافي يدوي"
                    >
                      +
                    </button>
                  </div>
                </div>
                {extrasSource && (
                  <p className={`mt-1 text-[11px] ${extrasSource.startsWith('⚠') ? 'text-amber-700' : 'text-violet-500'}`}>{extrasSource}</p>
                )}
                {extraItems.length > 0 && (
                  <div className="mt-2 space-y-1.5">
                  {groupByMeal(extraItems, x => x.it.meal_type).map(g => (
                  <div key={g.mealType} className="flex items-start gap-1.5">
                    <span className={`shrink-0 w-20 text-center text-[11px] font-bold rounded-lg px-1 py-1.5 ${MEAL_SECTION_STYLE[g.mealType]}`}>
                      {MEAL_ICON[g.mealType]} {DELIVERY_MEAL_TYPE_LABELS[g.mealType]}
                      <span className="block font-semibold opacity-70">{g.items.reduce((a, x) => a + x.it.quantity, 0)}</span>
                    </span>
                  <div className="flex-1 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-1.5">
                    {g.items.map(({ it, idx }) => (
                      <div key={idx} className="flex items-center gap-1 bg-white border border-violet-100 rounded-lg px-1.5 py-1">
                        <input
                          type="text"
                          value={it.display_name}
                          onChange={e => updateItem(idx, { display_name: e.target.value })}
                          placeholder="اسم الصنف"
                          className="flex-1 min-w-0 px-1.5 py-1 text-xs border border-transparent rounded focus:outline-none focus:border-violet-300"
                          required
                        />
                        <input
                          type="number"
                          min={0}
                          value={it.quantity}
                          onChange={e => updateItem(idx, { quantity: parseInt(e.target.value) || 0 })}
                          className="w-12 text-center px-1 py-1 text-xs border border-slate-200 rounded focus:outline-none focus:border-violet-300 font-bold text-violet-700"
                        />
                        <button
                          type="button"
                          onClick={() => removeItem(idx)}
                          className="text-slate-300 hover:text-red-600 px-0.5"
                          title="حذف"
                        >
                          ✕
                        </button>
                      </div>
                    ))}
                  </div>
                  </div>
                  ))}
                  </div>
                )}
              </div>
            </div>

            {/* الملاحظات */}
            <div>
              <label className="label">الملاحظات</label>
              <textarea
                value={notes}
                onChange={e => setNotes(e.target.value)}
                rows={3}
                placeholder="أي ملاحظات على التسليم..."
                className="input-field"
              />
            </div>

            {/* التواقيع */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <SignatureField
                label="توقيع المنشئ"
                value={creatorSignature}
                uploading={uploadingSig === 'creator'}
                onUpload={(f) => uploadSignature(f, 'creator')}
                onClear={() => setCreatorSignature(null)}
              />
              <SignatureField
                label="توقيع المستلم"
                value={receiverSignature}
                uploading={uploadingSig === 'receiver'}
                onUpload={(f) => uploadSignature(f, 'receiver')}
                onClear={() => setReceiverSignature(null)}
              />
            </div>

            {error && <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">{error}</div>}
          </div>

          <div className="flex gap-3 px-6 py-4 border-t border-slate-100 shrink-0">
            <button type="submit" disabled={saving} className="btn-primary flex-1 justify-center">
              {saving ? (isEdit ? 'جاري الحفظ...' : 'جاري الإنشاء...') : (isEdit ? 'حفظ التعديلات' : 'إنشاء أمر التسليم')}
            </button>
            <button type="button" onClick={onClose} className="btn-secondary">إلغاء</button>
          </div>
        </form>
      </div>
    </div>
  );
}

function SignatureField({
  label, value, uploading, onUpload, onClear,
}: {
  label: string;
  value: string | null;
  uploading: boolean;
  onUpload: (f: File) => void;
  onClear: () => void;
}) {
  return (
    <div>
      <label className="label">{label}</label>
      <div className="border border-slate-200 rounded-xl p-3 bg-white">
        {value ? (
          <div className="space-y-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={value} alt={label} className="max-h-24 mx-auto rounded border border-slate-100" />
            <div className="flex gap-2">
              <label className="flex-1 cursor-pointer text-center text-xs px-2 py-1.5 bg-slate-50 text-slate-700 rounded-lg hover:bg-slate-100">
                استبدال
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={e => { const f = e.target.files?.[0]; if (f) onUpload(f); }}
                />
              </label>
              <button
                type="button"
                onClick={onClear}
                className="text-xs px-2 py-1.5 bg-red-50 text-red-700 rounded-lg hover:bg-red-100"
              >
                حذف
              </button>
            </div>
          </div>
        ) : (
          <label className="flex flex-col items-center gap-2 py-4 cursor-pointer">
            <svg className="w-8 h-8 text-slate-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
            </svg>
            <span className="text-xs text-slate-500">
              {uploading ? 'جاري الرفع...' : 'اضغط لرفع صورة التوقيع'}
            </span>
            <input
              type="file"
              accept="image/*"
              className="hidden"
              disabled={uploading}
              onChange={e => { const f = e.target.files?.[0]; if (f) onUpload(f); }}
            />
          </label>
        )}
      </div>
      <p className="text-[11px] text-slate-400 mt-1">يمكن أيضاً ترك التوقيع فارغاً لتوقيعه يدوياً على الورقة المطبوعة</p>
    </div>
  );
}
