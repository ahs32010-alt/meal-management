import { jsPDF } from 'jspdf';
import { toPng, getFontEmbedCSS } from 'html-to-image';

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | null> {
  return Promise.race([p, new Promise<null>(resolve => setTimeout(() => resolve(null), ms))]);
}

/**
 * يصدّر صفحات جاهزة بمقاس A4 (كل عنصر = صفحة كاملة) إلى ملف PDF.
 * العناصر مصمَّمة لمقاس الورقة نفسه، فلا تصغير — الخط يطلع بحجمه المقصود.
 */
export async function exportPagesToPdf(pages: HTMLElement[], filename: string): Promise<void> {
  if (pages.length === 0) return;

  let fontEmbedCSS: string | undefined;
  try {
    fontEmbedCSS = (await withTimeout(getFontEmbedCSS(pages[0]), 8000)) ?? undefined;
  } catch {
    fontEmbedCSS = undefined;
  }

  const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  for (let i = 0; i < pages.length; i++) {
    // دقة ×٣ — النص يبقى حاداً حتى مع التكبير
    const dataUrl = await toPng(pages[i], { pixelRatio: 3, backgroundColor: '#ffffff', fontEmbedCSS });
    if (i > 0) pdf.addPage();
    pdf.addImage(dataUrl, 'PNG', 0, 0, 210, 297, undefined, 'FAST');
  }
  pdf.save(filename);
}
