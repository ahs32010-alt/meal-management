import {
  Document,
  Packer,
  Paragraph,
  ImageRun,
  convertMillimetersToTwip,
  PageOrientation,
} from 'docx';
import { toPng } from 'html-to-image';

const MM_TO_PX = 96 / 25.4;

// dataURL (PNG) → Uint8Array
function dataUrlToBytes(dataUrl: string): Uint8Array {
  const base64 = dataUrl.split(',')[1] ?? '';
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

/**
 * يصدّر الستيكرات لملف Word، كل ستيكر في صفحة مستقلة بمقاس = مقاس الستيكر بالضبط.
 * يلتقط عُقد الستيكرات المعروضة في الصفحة كصور PNG، فيكون الملف طبق الأصل من الصفحة.
 */
export async function exportLunchDinnerStickers(
  nodes: HTMLElement[],
  widthCm: number,
  heightCm: number,
): Promise<void> {
  // أبعاد الصورة بالبكسل عند 96dpi لتملأ الصفحة بمقاسها الحقيقي
  const wPx = Math.round(widthCm * 10 * MM_TO_PX);
  const hPx = Math.round(heightCm * 10 * MM_TO_PX);

  // التقاط كل ستيكر كصورة عالية الدقة (pixelRatio=3 لطباعة حادّة)
  const images: Uint8Array[] = [];
  for (const node of nodes) {
    const dataUrl = await toPng(node, {
      pixelRatio: 3,
      cacheBust: true,
      backgroundColor: '#ffffff',
      width: node.offsetWidth,
      height: node.offsetHeight,
    });
    images.push(dataUrlToBytes(dataUrl));
  }

  const sections = images.map(data => ({
    properties: {
      page: {
        size: {
          width: convertMillimetersToTwip(widthCm * 10),
          height: convertMillimetersToTwip(heightCm * 10),
          orientation: PageOrientation.PORTRAIT,
        },
        margin: { top: 0, bottom: 0, left: 0, right: 0, header: 0, footer: 0, gutter: 0 },
      },
    },
    children: [
      new Paragraph({
        // تباعد السطر = ارتفاع الصورة بالضبط (1px = 15 twip) لمنع ظهور صفحة فارغة
        spacing: { before: 0, after: 0, line: hPx * 15, lineRule: 'exact' as const },
        children: [
          new ImageRun({
            data,
            type: 'png',
            transformation: { width: wPx, height: hPx },
          }),
        ],
      }),
    ],
  }));

  const doc = new Document({
    creator: 'Khutwat Amal',
    title: 'ستيكرات الغداء والعشاء',
    sections: sections.length ? sections : [{ children: [new Paragraph({ children: [] })] }],
  });

  const blob = await Packer.toBlob(doc);
  triggerDownload(blob, 'ستيكرات-الغداء-والعشاء.docx');
}

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
