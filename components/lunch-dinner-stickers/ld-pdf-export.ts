import { jsPDF } from 'jspdf';
import { toPng, getFontEmbedCSS } from 'html-to-image';

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | null> {
  return Promise.race([p, new Promise<null>(resolve => setTimeout(() => resolve(null), ms))]);
}

export type PdfMode = 'single' | 'separate';

// أسماء ملفات آمنة على ويندوز/ماك — بلا الرموز المحجوزة
const safeName = (s: string) => s.replace(/[\\/:*?"<>|\n\r\t]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);

/**
 * يصدّر الستيكرات إلى PDF — كل ستيكر في صفحة مستقلة بمقاس = المقاس المختار بالمللي بالضبط،
 * والصورة طبق الأصل من الستيكر المعروض في الصفحة (تطابق تام بالشكل والصيغة).
 *
 * `mode`:
 *  - 'single'   → ملف PDF واحد فيه كل الستيكرات (صفحة لكل ستيكر).
 *  - 'separate' → ملف PDF لكل ستيكر، كلها داخل ملف مضغوط (.zip) واحد.
 *    الأسماء تبدأ برقم الترتيب حتى تنفرز في المجلد بنفس ترتيب الصفحة.
 */
export async function exportLunchDinnerStickersPdf(
  nodes: HTMLElement[],
  widthCm: number,
  heightCm: number,
  onProgress?: (done: number, total: number) => void,
  filename = 'ستيكرات-الغداء-والعشاء.pdf',
  opts: { mode?: PdfMode; names?: string[] } = {},
): Promise<{ captured: number; failed: number }> {
  const { mode = 'single', names = [] } = opts;
  const wMm = widthCm * 10;
  const hMm = heightCm * 10;
  const orientation = wMm >= hMm ? 'landscape' : 'portrait';
  const newPdf = () => new jsPDF({ orientation, unit: 'mm', format: [wMm, hMm] });

  // حساب CSS الخطوط مرّة واحدة (تسريع) — مع fallback لو فشل/تأخّر
  let fontEmbedCSS: string | undefined;
  try {
    fontEmbedCSS = (await withTimeout(getFontEmbedCSS(nodes[0]), 8000)) ?? undefined;
  } catch {
    fontEmbedCSS = undefined;
  }

  const single = mode === 'single' ? newPdf() : null;
  const files: Record<string, Uint8Array> = {};
  const pad = String(nodes.length).length;

  let captured = 0;
  let failed = 0;
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    try {
      const dataUrl = await toPng(node, {
        pixelRatio: 3,
        cacheBust: false,
        // لا نمرّر backgroundColor — لأنه يطغى على لون خلفية الستيكر؛
        // الستيكر نفسه له خلفية صريحة (لون النظام أو أبيض).
        width: node.offsetWidth,
        height: node.offsetHeight,
        fontEmbedCSS,
        skipFonts: !fontEmbedCSS,
      });
      if (single) {
        if (captured > 0) single.addPage([wMm, hMm], orientation);
        // الصورة تملأ الصفحة بالكامل بمقاسها الحقيقي بالمللي
        single.addImage(dataUrl, 'PNG', 0, 0, wMm, hMm, undefined, 'FAST');
      } else {
        const pdf = newPdf();
        pdf.addImage(dataUrl, 'PNG', 0, 0, wMm, hMm, undefined, 'FAST');
        const label = safeName(names[i] ?? '') || 'ستيكر';
        files[`${String(i + 1).padStart(pad, '0')}-${label}.pdf`] = new Uint8Array(pdf.output('arraybuffer'));
      }
      captured++;
    } catch {
      failed++;
    }
    onProgress?.(i + 1, nodes.length);
    await new Promise(r => setTimeout(r, 0));
  }

  if (!captured) {
    throw new Error('فشل التقاط جميع الستيكرات — تأكد من تحميل الصفحة كاملة ثم أعد المحاولة');
  }

  if (single) {
    single.save(filename);
  } else {
    // fflate يُحمَّل عند الحاجة فقط. level 0 = تخزين بلا ضغط: الـPDF مضغوط أصلاً
    const { zipSync } = await import('fflate');
    const zip = zipSync(files, { level: 0 });
    const url = URL.createObjectURL(new Blob([zip as BlobPart], { type: 'application/zip' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = filename.replace(/\.pdf$/i, '') + '.zip';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return { captured, failed };
}
