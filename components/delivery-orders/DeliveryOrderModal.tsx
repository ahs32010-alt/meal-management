'use client';

import { useEffect, useMemo, useState } from 'react';
import { createClient } from '@/lib/supabase-client';
import { logActivity } from '@/lib/activity-log';
import type { City, DailyOrder, DeliveryLocation, DeliveryMeal, DeliveryMealType, DeliveryOrder, MealType } from '@/lib/types';
import { DELIVERY_MEAL_TYPE_LABELS, MEAL_TYPE_LABELS } from '@/lib/types';

interface SourceMode {
  type: 'manual' | 'from_order';
}

interface DraftItem {
  display_name: string;
  meal_type: DeliveryMealType;
  quantity: number;
  receiver_signature_url?: string | null;
}

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
  const supabase = useMemo(() => createClient(), []);

  // Mode: لو تعديل وعنده source_order_id نخش بـfrom_order، وإلا manual
  const [mode, setMode] = useState<SourceMode['type']>(
    isEdit ? (editingOrder?.source_order_id ? 'from_order' : 'manual') : 'manual'
  );
  const [step, setStep] = useState<'pick_mode' | 'edit'>(isEdit ? 'edit' : 'pick_mode');

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
      display_name: it.display_name,
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
      const [citiesRes, locsRes, mealsRes, ordersRes] = await Promise.all([
        fetch('/api/cities').then(r => r.ok ? r.json() : []),
        fetch('/api/delivery-locations').then(r => r.ok ? r.json() : []),
        fetch('/api/delivery-meals').then(r => r.ok ? r.json() : []),
        supabase.from('daily_orders')
          .select('id, date, meal_type, week_number, day_of_week, entity_type, created_at')
          .order('date', { ascending: false })
          .limit(100),
      ]);
      setCities(citiesRes ?? []);
      setLocations(locsRes ?? []);
      setDeliveryMeals(mealsRes ?? []);
      setProductionOrders((ordersRes.data ?? []) as unknown as DailyOrder[]);
    })();
  }, [supabase]);

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
        if ((it.qty ?? 0) > 0) drafted.push({ display_name: `ثابت: ${it.meal.name}`, meal_type: report.order.meal_type, quantity: it.qty ?? 0 });
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

  const addEmptyItem = () => {
    setItems(prev => [...prev, { display_name: '', meal_type: mealType, quantity: 0 }]);
  };

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
        items: items.map(it => ({
          display_name: it.display_name.trim(),
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
        entity_name: `أمر تسليم ${j.order_number ?? editingOrder?.order_number ?? ''}`,
        details: { items_count: items.length, meal_type: mealType, date },
      });

      onSaved();
    } finally {
      setSaving(false);
    }
  };

  // ── Mode picker step ──────────────────────────────────────────────────────
  if (step === 'pick_mode') {
    return (
      <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
            <h3 className="font-bold text-slate-800">إنشاء أمر تسليم</h3>
            <button onClick={onClose} className="w-8 h-8 flex items-center justify-center text-slate-400 hover:bg-slate-100 rounded-lg">✕</button>
          </div>
          <div className="p-5 space-y-3">
            <p className="text-sm text-slate-500">اختر طريقة إنشاء الأمر:</p>
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
                <label className="label">اختر أمر التشغيل</label>
                <select
                  className="input-field"
                  defaultValue=""
                  onChange={(e) => { if (e.target.value) loadFromProductionOrder(e.target.value); }}
                  disabled={loadingFromOrder}
                >
                  <option value="">— اختر أمر تشغيل —</option>
                  {productionOrders.map(o => (
                    <option key={o.id} value={o.id}>
                      {o.date} — {DELIVERY_MEAL_TYPE_LABELS[o.meal_type]} ({o.entity_type === 'companion' ? 'مرافقين' : 'مستفيدين'})
                    </option>
                  ))}
                </select>
                {loadingFromOrder && (
                  <p className="text-xs text-slate-500">جاري جلب بيانات الأمر...</p>
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
                    onClick={addEmptyItem}
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

              {items.length === 0 ? (
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
                      {items.map((it, idx) => (
                        <tr key={idx} className="border-t border-slate-100">
                          <td className="px-2 py-1.5 text-center text-slate-400">{idx + 1}</td>
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
                    </tbody>
                  </table>
                </div>
              )}
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
