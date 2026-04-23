'use client';

import { useState, useRef } from 'react';
import { parseXLSX, exportTemplate } from '@/lib/xlsx-utils';

interface Props {
  title: string;
  templateHeaders: string[];
  templateRow: (string | number)[];
  onImport: (rows: Record<string, string>[]) => Promise<{ imported: number; errors: string[] }>;
  onClose: () => void;
  onDone: () => void;
}

export default function ImportModal({ title, templateHeaders, templateRow, onImport, onClose, onDone }: Props) {
  const [rows, setRows] = useState<Record<string, string>[] | null>(null);
  const [fileName, setFileName] = useState('');
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<{ imported: number; errors: string[] } | null>(null);
  const [parseError, setParseError] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    setParseError(''); setRows(null); setResult(null);
    try {
      const parsed = await parseXLSX(file);
      if (parsed.length === 0) { setParseError('الملف فارغ أو غير صحيح'); return; }
      if (!Object.keys(parsed[0]).includes(templateHeaders[0])) {
        setParseError(`العمود الأول يجب أن يكون "${templateHeaders[0]}"`);
        return;
      }
      setRows(parsed);
    } catch {
      setParseError('تعذّر قراءة الملف — تأكد أنه ملف Excel صحيح (.xlsx)');
    }
    // reset input so same file can be re-selected
    e.target.value = '';
  };

  const handleImport = async () => {
    if (!rows) return;
    setImporting(true);
    const res = await onImport(rows);
    setResult(res);
    setImporting(false);
    if (res.errors.length === 0) setTimeout(onDone, 1200);
  };

  const downloadTemplate = () => {
    exportTemplate(templateHeaders, templateRow, `قالب_${title}.xlsx`);
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl w-full max-w-2xl shadow-2xl max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <h2 className="text-lg font-bold text-slate-800">استيراد {title}</h2>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center text-slate-400 hover:bg-slate-100 rounded-lg">✕</button>
        </div>

        <div className="p-6 space-y-5 overflow-y-auto flex-1">
          {/* Template */}
          <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-semibold text-emerald-800">قالب Excel</p>
              <p className="text-xs text-emerald-600 mt-0.5">حمّل القالب، عبّئه، ثم ارفعه</p>
            </div>
            <button onClick={downloadTemplate}
              className="flex items-center gap-2 px-4 py-2 bg-emerald-600 text-white rounded-lg text-sm font-semibold hover:bg-emerald-700 transition-colors flex-shrink-0">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
              </svg>
              تحميل القالب
            </button>
          </div>

          {/* File picker */}
          <div>
            <label className="label">رفع ملف Excel</label>
            <div onClick={() => fileRef.current?.click()}
              className="border-2 border-dashed border-slate-200 rounded-xl p-8 text-center cursor-pointer hover:border-emerald-400 hover:bg-emerald-50/30 transition-colors">
              <svg className="w-10 h-10 mx-auto mb-2 text-slate-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              {fileName
                ? <p className="text-sm font-semibold text-emerald-700">{fileName}</p>
                : <><p className="text-sm font-medium text-slate-600">اضغط لاختيار ملف Excel</p>
                  <p className="text-xs text-slate-400 mt-1">.xlsx فقط</p></>}
            </div>
            <input ref={fileRef} type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              onChange={handleFile} className="hidden" />
          </div>

          {parseError && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">{parseError}</div>
          )}

          {/* Preview */}
          {rows && !result && (
            <div>
              <p className="text-sm font-semibold text-slate-700 mb-2">
                معاينة — {rows.length} صف
              </p>
              <div className="border border-slate-200 rounded-xl overflow-hidden overflow-x-auto max-h-52">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-slate-50">
                      {Object.keys(rows[0]).map(h => (
                        <th key={h} className="px-3 py-2 text-right font-bold text-slate-600 border-b border-slate-200 whitespace-nowrap">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {rows.slice(0, 8).map((row, i) => (
                      <tr key={i} className="hover:bg-slate-50">
                        {Object.values(row).map((v, j) => (
                          <td key={j} className="px-3 py-2 text-slate-700 whitespace-nowrap">{v || '—'}</td>
                        ))}
                      </tr>
                    ))}
                    {rows.length > 8 && (
                      <tr>
                        <td colSpan={Object.keys(rows[0]).length}
                          className="px-3 py-2 text-center text-slate-400">
                          ... و {rows.length - 8} صفوف أخرى
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Result */}
          {result && (
            <div className={`border rounded-xl p-4 ${result.errors.length === 0 ? 'bg-green-50 border-green-200' : 'bg-orange-50 border-orange-200'}`}>
              <p className={`font-semibold text-sm ${result.errors.length === 0 ? 'text-green-800' : 'text-orange-800'}`}>
                ✓ تم استيراد {result.imported} سجل بنجاح
              </p>
              {result.errors.length > 0 && (
                <div className="mt-2 space-y-1 max-h-32 overflow-y-auto">
                  {result.errors.map((e, i) => <p key={i} className="text-xs text-orange-700">{e}</p>)}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="flex gap-3 px-6 pb-6 pt-2">
          {rows && !result && (
            <button onClick={handleImport} disabled={importing} className="btn-primary flex-1 justify-center">
              {importing ? 'جاري الاستيراد...' : `استيراد ${rows.length} سجل`}
            </button>
          )}
          <button onClick={result ? onDone : onClose} className="btn-secondary flex-1 justify-center">
            {result ? 'إغلاق' : 'إلغاء'}
          </button>
        </div>
      </div>
    </div>
  );
}
