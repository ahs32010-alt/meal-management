// Phonetic Arabic → Latin transliteration
const MAP: Record<string, string> = {
  'أ': 'a', 'إ': 'e', 'آ': 'aa', 'ا': 'a', 'ء': '',
  'ب': 'b', 'ت': 't', 'ث': 'th', 'ج': 'j', 'ح': 'h',
  'خ': 'kh', 'د': 'd', 'ذ': 'z', 'ر': 'r', 'ز': 'z',
  'س': 's', 'ش': 'sh', 'ص': 's', 'ض': 'd', 'ط': 't',
  'ظ': 'z', 'ع': 'a', 'غ': 'gh', 'ف': 'f', 'ق': 'q',
  'ك': 'k', 'ل': 'l', 'م': 'm', 'ن': 'n', 'ه': 'h',
  'و': 'oo', 'ي': 'ee', 'ى': 'a', 'ة': 'a',
  'لا': 'la', 'لأ': 'la', 'لإ': 'le', 'لآ': 'laa',
  ' ': ' ', 'ـ': '',
};

const TASHKEEL = /[ؐ-ًؚ-ٟ]/g;

function transliterateChars(text: string): string {
  let result = '';
  for (let i = 0; i < text.length; i++) {
    const two = text[i] + (text[i + 1] ?? '');
    if (MAP[two] !== undefined) { result += MAP[two]; i++; }
    else result += MAP[text[i]] ?? text[i];
  }
  return result.toLowerCase();
}

export function transliterate(arabic: string, customDict?: Record<string, string>): string {
  if (!arabic) return '';
  const trimmed = arabic.trim();

  // Full-phrase match
  if (customDict?.[trimmed]) return customDict[trimmed];

  const clean = trimmed.replace(TASHKEEL, '');

  if (customDict) {
    // Word-by-word: apply custom dict per token, fallback to char map
    return clean.split(' ').map(word =>
      customDict[word] ?? transliterateChars(word)
    ).join(' ');
  }

  return transliterateChars(clean);
}
