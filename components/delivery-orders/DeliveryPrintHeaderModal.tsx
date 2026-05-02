'use client';

import { useEffect, useMemo, useState } from 'react';
import { createClient } from '@/lib/supabase-client';
import type { DeliveryPrintHeader } from '@/lib/types';

interface Props {
  onClose: () => void;
}

export default function DeliveryPrintHeaderModal({ onClose }: Props) {
  const supabase = useMemo(() => createClient(), []);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [error, setError] = useState('');

  const [data, setData] = useState<Partial<DeliveryPrintHeader>>({});

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const res = await fetch('/api/delivery-print-header');
        if (res.ok) setData(await res.json());
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const set = <K extends keyof DeliveryPrintHeader>(key: K, value: DeliveryPrintHeader[K] | null) =>
    setData(prev => ({ ...prev, [key]: value }));

  const uploadLogo = async (file: File) => {
    setUploadingLogo(true);
    try {
      const ext = (file.name.split('.').pop() ?? 'png').toLowerCase();
      const path = `branding/logo-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
      const { error: upErr } = await supabase.storage
        .from('signatures')
        .upload(path, file, { contentType: file.type, upsert: false });
      if (upErr) { alert(`تعذّر رفع الشعار: ${upErr.message}`); return; }
      const { data: pub } = supabase.storage.from('signatures').getPublicUrl(path);
      set('logo_url', pub.publicUrl);
    } finally {
      setUploadingLogo(false);
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      const res = await fetch('/api/delivery-print-header', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          company_name_en: data.company_name_en ?? null,
          company_name_ar: data.company_name_ar ?? null,
          address_line1:   data.address_line1 ?? null,
          address_line2:   data.address_line2 ?? null,
          cr_number:       data.cr_number ?? null,
          vat_number:      data.vat_number ?? null,
          logo_url:        data.logo_url ?? null,
          title_ar:        data.title_ar ?? null,
          title_en:        data.title_en ?? null,
        }),
      });
      const j = await res.json();
      if (!res.ok) { setError(j.error ?? 'تعذّر الحفظ'); return; }
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl w-full max-w-2xl shadow-2xl max-h-[92vh] overflow-hidden flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 shrink-0">
          <h2 className="text-lg font-bold text-slate-800">بيانات هيدر طباعة أمر التسليم</h2>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center text-slate-400 hover:bg-slate-100 rounded-lg">✕</button>
        </div>

        {loading ? (
          <div className="p-12 text-center text-slate-400 text-sm">جاري التحميل...</div>
        ) : (
          <form onSubmit={handleSave} className="flex flex-col flex-1 overflow-hidden">
            <div className="p-6 space-y-5 overflow-y-auto flex-1">

              {/* اليسار — معلومات الشركة */}
              <div className="border border-slate-200 rounded-xl p-4 space-y-3 bg-slate-50/50">
                <p className="font-semibold text-sm text-slate-700">يسار الهيدر — معلومات الشركة</p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div>
                    <label className="label">اسم الشركة (EN)</label>
                    <input
                      type="text"
                      value={data.company_name_en ?? ''}
                      onChange={e => set('company_name_en', e.target.value)}
                      placeholder="Rawabi Alsham Co."
                      className="input-field"
                      dir="ltr"
                    />
                  </div>
                  <div>
                    <label className="label">اسم الشركة (AR)</label>
                    <input
                      type="text"
                      value={data.company_name_ar ?? ''}
                      onChange={e => set('company_name_ar', e.target.value)}
                      placeholder="شركة مطاعم إطلالة روابي الشام"
                      className="input-field"
                    />
                  </div>
                  <div>
                    <label className="label">العنوان — السطر الأول</label>
                    <input
                      type="text"
                      value={data.address_line1 ?? ''}
                      onChange={e => set('address_line1', e.target.value)}
                      placeholder="Al Adama Dist.- P.Code 3145 - Dammam"
                      className="input-field"
                      dir="ltr"
                    />
                  </div>
                  <div>
                    <label className="label">العنوان — السطر الثاني</label>
                    <input
                      type="text"
                      value={data.address_line2 ?? ''}
                      onChange={e => set('address_line2', e.target.value)}
                      placeholder="Dammam, Saudi Arabia"
                      className="input-field"
                      dir="ltr"
                    />
                  </div>
                  <div>
                    <label className="label">السجل التجاري (CR)</label>
                    <input
                      type="text"
                      value={data.cr_number ?? ''}
                      onChange={e => set('cr_number', e.target.value)}
                      placeholder="2050039158"
                      className="input-field"
                      dir="ltr"
                    />
                  </div>
                  <div>
                    <label className="label">الرقم الضريبي (VAT)</label>
                    <input
                      type="text"
                      value={data.vat_number ?? ''}
                      onChange={e => set('vat_number', e.target.value)}
                      placeholder="300518401800003"
                      className="input-field"
                      dir="ltr"
                    />
                  </div>
                </div>
              </div>

              {/* الوسط — الشعار */}
              <div className="border border-slate-200 rounded-xl p-4 space-y-3 bg-slate-50/50">
                <p className="font-semibold text-sm text-slate-700">وسط الهيدر — الشعار</p>
                <div className="flex items-center gap-4">
                  <div className="w-24 h-24 border border-slate-200 rounded-xl bg-white flex items-center justify-center overflow-hidden">
                    {data.logo_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={data.logo_url} alt="الشعار" className="max-w-full max-h-full object-contain" />
                    ) : (
                      <span className="text-slate-300 text-xs">لا يوجد شعار</span>
                    )}
                  </div>
                  <div className="flex-1 space-y-2">
                    <label className="cursor-pointer inline-block px-3 py-2 bg-emerald-50 text-emerald-700 rounded-lg hover:bg-emerald-100 text-sm font-semibold">
                      {uploadingLogo ? 'جاري الرفع...' : (data.logo_url ? 'استبدال الشعار' : 'رفع شعار')}
                      <input
                        type="file"
                        accept="image/*"
                        className="hidden"
                        disabled={uploadingLogo}
                        onChange={e => { const f = e.target.files?.[0]; if (f) uploadLogo(f); }}
                      />
                    </label>
                    {data.logo_url && (
                      <button
                        type="button"
                        onClick={() => set('logo_url', null)}
                        className="block text-xs text-red-600 hover:text-red-800"
                      >
                        إزالة الشعار
                      </button>
                    )}
                    <p className="text-[11px] text-slate-400">PNG / JPG — يفضّل خلفية شفافة</p>
                  </div>
                </div>
              </div>

              {/* اليمين — العنوان */}
              <div className="border border-slate-200 rounded-xl p-4 space-y-3 bg-slate-50/50">
                <p className="font-semibold text-sm text-slate-700">يمين الهيدر — اسم الورقة</p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div>
                    <label className="label">العنوان (AR)</label>
                    <input
                      type="text"
                      value={data.title_ar ?? ''}
                      onChange={e => set('title_ar', e.target.value)}
                      placeholder="أمر تسليم"
                      className="input-field"
                    />
                  </div>
                  <div>
                    <label className="label">العنوان (EN)</label>
                    <input
                      type="text"
                      value={data.title_en ?? ''}
                      onChange={e => set('title_en', e.target.value)}
                      placeholder="Delivery Note"
                      className="input-field"
                      dir="ltr"
                    />
                  </div>
                </div>
              </div>

              {error && <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">{error}</div>}
            </div>

            <div className="flex gap-3 px-6 py-4 border-t border-slate-100 shrink-0">
              <button type="submit" disabled={saving} className="btn-primary flex-1 justify-center">
                {saving ? 'جاري الحفظ...' : 'حفظ بيانات الهيدر'}
              </button>
              <button type="button" onClick={onClose} className="btn-secondary">إلغاء</button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
