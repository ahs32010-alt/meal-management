import { describe, expect, it } from 'vitest';
import {
  editRatio,
  matchKey,
  normalizeArabic,
  rankMatches,
  resolveOne,
  scoreMatch,
  stripArticle,
  tokenize,
} from '@/lib/assistant/normalize';

describe('normalizeArabic', () => {
  it('unifies alef variants', () => {
    expect(normalizeArabic('أرز')).toBe('ارز');
    expect(normalizeArabic('إفطار')).toBe('افطار');
    expect(normalizeArabic('آيس')).toBe('ايس');
  });

  it('unifies ta-marbuta and alef-maqsura', () => {
    expect(normalizeArabic('شوربة')).toBe('شوربه');
    expect(normalizeArabic('مصفى')).toBe('مصفي');
  });

  it('strips tashkeel without eating Arabic-Indic digits', () => {
    expect(normalizeArabic('بُرْتُقَال')).toBe('برتقال');
    // الأرقام الهندية تتحوّل للاتينية ولا تُحذف مع التشكيل
    expect(normalizeArabic('فيلا ٣')).toBe('فيلا 3');
    expect(normalizeArabic('١٢٣')).toBe('123');
  });

  it('drops punctuation and collapses whitespace', () => {
    expect(normalizeArabic('  أرز   بخاري؟!  ')).toBe('ارز بخاري');
  });

  it('returns empty string for empty input', () => {
    expect(normalizeArabic('')).toBe('');
    expect(normalizeArabic('؟؟؟')).toBe('');
  });
});

describe('stripArticle', () => {
  it('removes ال from long words only', () => {
    expect(stripArticle('البرتقال')).toBe('برتقال');
    expect(stripArticle('الرز')).toBe('الرز'); // قصيرة — نتركها
  });
});

describe('matchKey', () => {
  it('normalizes and strips definite articles per word', () => {
    expect(matchKey('البرتقال الطازج')).toBe('برتقال طازج');
  });
});

describe('tokenize', () => {
  it('splits normalized words', () => {
    expect(tokenize('أرز بخاري')).toEqual(['ارز', 'بخاري']);
    expect(tokenize('   ')).toEqual([]);
  });
});

describe('editRatio', () => {
  it('is 1 for identical strings and lower for typos', () => {
    expect(editRatio('برتقال', 'برتقال')).toBe(1);
    expect(editRatio('برتقال', 'برتقان')).toBeGreaterThan(0.7);
    expect(editRatio('برتقال', 'سمك')).toBeLessThan(0.3);
  });
});

describe('scoreMatch', () => {
  it('gives a perfect score to an exact match ignoring diacritics', () => {
    expect(scoreMatch('بُرْتُقَال', 'برتقال')).toBe(1);
  });

  it('scores containment highly', () => {
    expect(scoreMatch('برتقال', 'برتقال طازج')).toBeGreaterThan(0.75);
  });

  it('tolerates a missing hamza and definite article', () => {
    expect(scoreMatch('الارز', 'أرز')).toBeGreaterThan(0.8);
  });

  it('tolerates a single-letter typo', () => {
    expect(scoreMatch('برتقان', 'برتقال')).toBeGreaterThan(0.7);
  });

  it('scores unrelated words low', () => {
    expect(scoreMatch('برتقال', 'دجاج مشوي')).toBeLessThan(0.5);
  });

  it('returns 0 when either side is empty', () => {
    expect(scoreMatch('', 'برتقال')).toBe(0);
    expect(scoreMatch('برتقال', '؟')).toBe(0);
  });
});

const MEALS = [
  { id: '1', name: 'برتقال طازج', english_name: 'Fresh Orange' },
  { id: '2', name: 'أرز بخاري', english_name: 'Bukhari Rice' },
  { id: '3', name: 'سمك مشوي', english_name: 'Grilled Fish' },
  { id: '4', name: 'عصير برتقال', english_name: 'Orange Juice' },
];

const texts = (m: (typeof MEALS)[number]) => [m.name, m.english_name];

describe('rankMatches', () => {
  it('ranks the closest candidate first', () => {
    const r = rankMatches('سمك', MEALS, texts);
    expect(r[0].item.id).toBe('3');
  });

  it('matches on the English name too', () => {
    const r = rankMatches('Bukhari', MEALS, texts);
    expect(r[0].item.id).toBe('2');
  });

  it('returns nothing below the threshold', () => {
    expect(rankMatches('سيارة', MEALS, texts, { threshold: 0.8 })).toHaveLength(0);
  });
});

describe('resolveOne', () => {
  it('resolves a confident single match', () => {
    const r = resolveOne('سمك مشوي', MEALS, texts);
    expect(r.status).toBe('found');
    if (r.status === 'found') expect(r.item.id).toBe('3');
  });

  it('reports none with near suggestions when nothing is confident', () => {
    const r = resolveOne('طائرة', MEALS, texts);
    expect(r.status).toBe('none');
  });

  it('flags ambiguity when two candidates tie', () => {
    const tied = [
      { id: 'a', name: 'دجاج مشوي', english_name: null },
      { id: 'b', name: 'دجاج مسلوق', english_name: null },
    ];
    const r = resolveOne('دجاج', tied, (m) => [m.name, m.english_name]);
    expect(r.status).toBe('ambiguous');
    if (r.status === 'ambiguous') expect(r.candidates).toHaveLength(2);
  });

  it('prefers an exact match over a tie', () => {
    const r = resolveOne('برتقال طازج', MEALS, texts);
    expect(r.status).toBe('found');
    if (r.status === 'found') expect(r.item.id).toBe('1');
  });
});
