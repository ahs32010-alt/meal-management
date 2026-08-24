import { jsPDF } from 'jspdf';
import { toPng, getFontEmbedCSS } from 'html-to-image';

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | null> {
  return Promise.race([p, new Promise<null>(resolve => setTimeout(() => resolve(null), ms))]);
}

/**
 * يصدّر الستيكرات إلى PDF — كل ستيكر في صفحة مستقلة بمقاس = المقاس المختار بالمللي بالضبط،
 * والصورة طبق الأصل من الستيكر المعروض في الصفحة (تطابق تام بالشكل والصيغة).
 */
export async function exportLunchDinnerStickersPdf(
  nodes: HTMLElement[],
  widthCm: number,
  heightCm: number,
  onProgress?: (done: number, total: number) => void,
  filename = 'ستيكرات-الغداء-والعشاء.pdf',
): Promise<{ captured: number; failed: number }> {
  const wMm = widthCm * 10;
  const hMm = heightCm * 10;

  // حساب CSS الخطوط مرّة واحدة (تسريع) — مع fallback لو فشل/تأخّر
  let fontEmbedCSS: string | undefined;
  try {
    fontEmbedCSS = (await withTimeout(getFontEmbedCSS(nodes[0]), 8000)) ?? undefined;
  } catch {
    fontEmbedCSS = undefined;
  }

  const pdf = new jsPDF({
    orientation: wMm >= hMm ? 'landscape' : 'portrait',
    unit: 'mm',
    format: [wMm, hMm],
  });

  let captured = 0;
  let failed = 0;
  let first = true;
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
      if (!first) pdf.addPage([wMm, hMm], wMm >= hMm ? 'landscape' : 'portrait');
      first = false;
      // الصورة تملأ الصفحة بالكامل بمقاسها الحقيقي بالمللي
      pdf.addImage(dataUrl, 'PNG', 0, 0, wMm, hMm, undefined, 'FAST');
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

  pdf.save(filename);
  return { captured, failed };
}
