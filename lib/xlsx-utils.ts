export type SheetRow = Record<string, string | number | boolean | null | undefined>;

/** ورقة واحدة داخل ملف متعدّد الأوراق */
export interface WorkbookSheet {
  name: string;
  rows: SheetRow[];
  /** رؤوس الأعمدة بالترتيب — لازمة عشان الورقة الفارغة تنزل برؤوسها */
  headers?: string[];
}

/**
 * يصدّر ملف Excel فيه عدة أوراق. نستخدمه في التكاليف حيث البيانات مترابطة
 * (وحدات ← مواد ← وصفات) فلازم تنزل وتُستورد كوحدة واحدة.
 */
export async function exportWorkbook(sheets: WorkbookSheet[], filename: string) {
  const XLSX = await import('xlsx');
  const wb = XLSX.utils.book_new();

  for (const sheet of sheets) {
    const headers = sheet.headers ?? Object.keys(sheet.rows[0] ?? {});
    const ws = sheet.rows.length > 0
      ? XLSX.utils.json_to_sheet(sheet.rows, { header: headers })
      : XLSX.utils.aoa_to_sheet([headers]);

    ws['!cols'] = headers.map(h => ({
      wch: Math.max(h.length, ...sheet.rows.map(r => String(r[h] ?? '').length), 8) + 2,
    }));
    // اتجاه الورقة من اليمين لليسار — الملف عربي
    ws['!views'] = [{ RTL: true }];
    XLSX.utils.book_append_sheet(wb, ws, sheet.name);
  }

  XLSX.writeFile(wb, filename);
}

/** يقرأ كل أوراق الملف كخريطة: اسم الورقة → صفوفها */
export async function parseWorkbook(file: File): Promise<Record<string, Record<string, string>[]>> {
  const XLSX = await import('xlsx');
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = e => {
      try {
        const data = new Uint8Array(e.target?.result as ArrayBuffer);
        const wb = XLSX.read(data, { type: 'array' });
        const out: Record<string, Record<string, string>[]> = {};
        for (const name of wb.SheetNames) {
          out[name] = XLSX.utils.sheet_to_json<Record<string, string>>(wb.Sheets[name], {
            defval: '',
            raw: false,
          });
        }
        resolve(out);
      } catch (err) { reject(err); }
    };
    reader.onerror = reject;
    reader.readAsArrayBuffer(file);
  });
}

export async function exportXLSX(
  rows: Record<string, string | number | boolean | null | undefined>[],
  filename: string,
  sheetName = 'Sheet1'
) {
  const XLSX = await import('xlsx');
  // اتحاد مفاتيح كل الصفوف بترتيب أول ظهور — الاعتماد على rows[0] وحده كان
  // يُسقط أي عمود لا يوجد في الصف الأول (ويحسب عرض الأعمدة على أساس ناقص).
  const headers: string[] = [];
  const seen = new Set<string>();
  for (const r of rows) {
    for (const k of Object.keys(r)) {
      if (!seen.has(k)) { seen.add(k); headers.push(k); }
    }
  }
  const ws = XLSX.utils.json_to_sheet(rows, { header: headers });
  ws['!cols'] = headers.map(key => ({
    wch: Math.max(key.length, ...rows.map(r => String(r[key] ?? '').length)) + 2,
  }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  XLSX.writeFile(wb, filename);
}

export async function exportTemplate(
  headers: string[],
  sampleRow: (string | number)[],
  filename: string,
  sheetName = 'Sheet1'
) {
  const XLSX = await import('xlsx');
  const ws = XLSX.utils.aoa_to_sheet([headers, sampleRow]);
  ws['!cols'] = headers.map((h, i) => ({
    wch: Math.max(h.length, String(sampleRow[i] ?? '').length) + 4,
  }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  XLSX.writeFile(wb, filename);
}

export async function parseXLSX(file: File): Promise<Record<string, string>[]> {
  const XLSX = await import('xlsx');
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = e => {
      try {
        const data = new Uint8Array(e.target?.result as ArrayBuffer);
        const wb = XLSX.read(data, { type: 'array' });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json<Record<string, string>>(ws, {
          defval: '',
          raw: false,
        });
        resolve(rows);
      } catch (err) { reject(err); }
    };
    reader.onerror = reject;
    reader.readAsArrayBuffer(file);
  });
}
