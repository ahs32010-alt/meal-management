/**
 * تصدير ستيكرات العينات — الصورة الملتقطة من الستيكر المعروض نفسه، فالـPDF
 * وWord طبق الأصل من المعاينة. طريقتان:
 *   • grid    → جنب بعض على ورق A4 (مثل ستيكرات الفطور)، بمقاس الستيكر الحقيقي
 *   • perPage → كل ستيكر في صفحة بمقاسه (طابعة الملصقات)
 */

import { toPng, getFontEmbedCSS } from 'html-to-image';

export type SampleArrange = 'grid' | 'perPage';

export const A4 = { w: 210, h: 297, margin: 8, gap: 2 } as const;

/** كم ستيكر يدخل في صفحة A4 (أعمدة × صفوف) — 1 على الأقل */
export function a4Fit(widthCm: number, heightCm: number): { cols: number; rows: number; perPage: number } {
  const uw = A4.w - 2 * A4.margin, uh = A4.h - 2 * A4.margin;
  const cols = Math.max(1, Math.floor((uw + A4.gap) / (widthCm * 10 + A4.gap)));
  const rows = Math.max(1, Math.floor((uh + A4.gap) / (heightCm * 10 + A4.gap)));
  return { cols, rows, perPage: cols * rows };
}

async function capture(
  nodes: HTMLElement[], onProgress?: (done: number, total: number) => void,
): Promise<{ images: (string | null)[]; failed: number }> {
  let fontEmbedCSS: string | undefined;
  try {
    fontEmbedCSS = (await Promise.race([
      getFontEmbedCSS(nodes[0]),
      new Promise<null>(r => setTimeout(() => r(null), 8000)),
    ])) ?? undefined;
  } catch { fontEmbedCSS = undefined; }

  const images: (string | null)[] = [];
  let failed = 0;
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    try {
      images.push(await toPng(node, {
        pixelRatio: 3, cacheBust: false,
        width: node.offsetWidth, height: node.offsetHeight,
        fontEmbedCSS, skipFonts: !fontEmbedCSS,
      }));
    } catch {
      images.push(null);
      failed++;
    }
    onProgress?.(i + 1, nodes.length);
    await new Promise(r => setTimeout(r, 0));
  }
  if (failed === nodes.length) throw new Error('فشل التقاط الستيكرات — انتظر تحميل الصفحة ثم أعد المحاولة');
  return { images, failed };
}

function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** PDF على A4 — الستيكرات جنب بعض من اليمين لليسار (اتجاه القراءة العربي) */
export async function exportSampleGridPdf(
  nodes: HTMLElement[], widthCm: number, heightCm: number, filename: string,
  onProgress?: (done: number, total: number) => void,
): Promise<{ captured: number; failed: number }> {
  const { images, failed } = await capture(nodes, onProgress);
  const { jsPDF } = await import('jspdf');
  const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const { cols, perPage } = a4Fit(widthCm, heightCm);
  const wMm = widthCm * 10, hMm = heightCm * 10;
  const ok = images.filter((x): x is string => !!x);
  ok.forEach((img, i) => {
    const slot = i % perPage;
    if (i > 0 && slot === 0) pdf.addPage('a4', 'portrait');
    const col = slot % cols, row = Math.floor(slot / cols);
    const x = A4.w - A4.margin - (col + 1) * wMm - col * A4.gap;
    const y = A4.margin + row * (hMm + A4.gap);
    pdf.addImage(img, 'PNG', x, y, wMm, hMm, undefined, 'FAST');
  });
  pdf.save(filename);
  return { captured: ok.length, failed };
}

/** Word: A4 (جنب بعض) أو صفحة لكل ستيكر بمقاسه */
export async function exportSampleWord(
  nodes: HTMLElement[], widthCm: number, heightCm: number, arrange: SampleArrange, filename: string,
  onProgress?: (done: number, total: number) => void,
): Promise<{ captured: number; failed: number }> {
  const { images, failed } = await capture(nodes, onProgress);
  const { Document, Packer, Paragraph, ImageRun, TextRun, AlignmentType, convertMillimetersToTwip, PageOrientation } = await import('docx');
  const PX_PER_MM = 96 / 25.4;
  const wMm = widthCm * 10, hMm = heightCm * 10;
  const toBytes = (dataUrl: string) => Uint8Array.from(atob(dataUrl.split(',')[1]), c => c.charCodeAt(0));
  const ok = images.filter((x): x is string => !!x);
  const mmTw = convertMillimetersToTwip;

  let sections;
  if (arrange === 'perPage') {
    sections = ok.map(img => ({
      properties: {
        page: {
          size: { width: mmTw(wMm), height: mmTw(hMm), orientation: PageOrientation.PORTRAIT },
          margin: { top: 0, bottom: 0, left: 0, right: 0, header: 0, footer: 0, gutter: 0 },
        },
      },
      children: [new Paragraph({
        spacing: { before: 0, after: 0, line: 240 },
        children: [new ImageRun({
          type: 'png', data: toBytes(img),
          // أقل من الصفحة بشعرة — سطر الفقرة ما يدفع الصورة لصفحة ثانية
          transformation: { width: Math.floor(wMm * PX_PER_MM) - 1, height: Math.floor(hMm * PX_PER_MM) - 2 },
        })],
      })],
    }));
  } else {
    // فقرة لكل صف: الستيكرات جنب بعض، وWord يقلب الصفحة لحاله عند امتلائها
    const { cols } = a4Fit(widthCm, heightCm);
    const gapPx = A4.gap * PX_PER_MM;
    const rows: InstanceType<typeof Paragraph>[] = [];
    for (let i = 0; i < ok.length; i += cols) {
      const children: (InstanceType<typeof ImageRun> | InstanceType<typeof TextRun>)[] = [];
      ok.slice(i, i + cols).forEach((img, j) => {
        if (j > 0) children.push(new TextRun({ text: ' ', size: Math.max(2, Math.round(gapPx * 1.5)) }));
        children.push(new ImageRun({
          type: 'png', data: toBytes(img),
          transformation: { width: Math.round(wMm * PX_PER_MM), height: Math.round(hMm * PX_PER_MM) },
        }));
      });
      rows.push(new Paragraph({
        alignment: AlignmentType.RIGHT, bidirectional: true, keepLines: true,
        spacing: { before: 0, after: mmTw(A4.gap) },
        children,
      }));
    }
    sections = [{
      properties: {
        page: {
          size: { width: mmTw(A4.w), height: mmTw(A4.h), orientation: PageOrientation.PORTRAIT },
          margin: { top: mmTw(A4.margin), bottom: mmTw(A4.margin), left: mmTw(A4.margin), right: mmTw(A4.margin), header: 0, footer: 0, gutter: 0 },
        },
      },
      children: rows,
    }];
  }

  const doc = new Document({ creator: 'Khutwat Amal', title: 'ستيكرات العينات', sections });
  download(await Packer.toBlob(doc), filename);
  return { captured: ok.length, failed };
}
