import { describe, expect, it } from 'vitest';
import {
  cycleWeekFor,
  parseIsoDate,
  resolveWeeks,
  startOfMenuWeek,
  wrapWeek,
} from '@/lib/assistant/week';

const d = (iso: string) => parseIsoDate(iso)!;

describe('parseIsoDate', () => {
  it('parses YYYY-MM-DD as UTC midnight', () => {
    const x = d('2026-08-08');
    expect(x.getUTCFullYear()).toBe(2026);
    expect(x.getUTCMonth()).toBe(7);
    expect(x.getUTCDate()).toBe(8);
  });

  it('returns null for garbage', () => {
    expect(parseIsoDate('not-a-date')).toBeNull();
  });
});

describe('startOfMenuWeek', () => {
  it('snaps to the preceding Saturday', () => {
    // 2026-08-08 هو سبت
    expect(d('2026-08-08').getUTCDay()).toBe(6);
    expect(startOfMenuWeek(d('2026-08-08')).toISOString().slice(0, 10)).toBe('2026-08-08');
    // الأحد بعده ينتمي لنفس الأسبوع
    expect(startOfMenuWeek(d('2026-08-09')).toISOString().slice(0, 10)).toBe('2026-08-08');
    // الجمعة قبله تنتمي للأسبوع السابق
    expect(startOfMenuWeek(d('2026-08-07')).toISOString().slice(0, 10)).toBe('2026-08-01');
  });
});

describe('wrapWeek', () => {
  it('wraps into 1..4', () => {
    expect(wrapWeek(5)).toBe(1);
    expect(wrapWeek(0)).toBe(4);
    expect(wrapWeek(-1)).toBe(3);
    expect(wrapWeek(4)).toBe(4);
    expect(wrapWeek(8)).toBe(4);
  });
});

describe('cycleWeekFor', () => {
  it('returns the anchor week within the same menu week', () => {
    expect(cycleWeekFor(d('2026-08-08'), 2, d('2026-08-08'))).toBe(2);
    expect(cycleWeekFor(d('2026-08-08'), 2, d('2026-08-12'))).toBe(2);
  });

  it('advances one cycle week per calendar week', () => {
    expect(cycleWeekFor(d('2026-08-08'), 2, d('2026-08-15'))).toBe(3);
    expect(cycleWeekFor(d('2026-08-08'), 2, d('2026-08-22'))).toBe(4);
    expect(cycleWeekFor(d('2026-08-08'), 2, d('2026-08-29'))).toBe(1); // يلفّ
  });

  it('goes backwards for earlier dates', () => {
    expect(cycleWeekFor(d('2026-08-08'), 2, d('2026-08-01'))).toBe(1);
    expect(cycleWeekFor(d('2026-08-08'), 1, d('2026-08-01'))).toBe(4);
  });
});

describe('resolveWeeks', () => {
  const anchor = { currentWeek: 2, anchorDate: '2026-08-08', anchorWeek: 2 };

  it('passes explicit weeks through untouched', () => {
    expect(resolveWeeks({ mode: 'explicit', weeks: [1, 3] }, null).weeks).toEqual([1, 3]);
  });

  it('returns the whole cycle for "all"', () => {
    expect(resolveWeeks({ mode: 'all' }, null).weeks).toEqual([1, 2, 3, 4]);
  });

  it('resolves current/next/prev against the anchor', () => {
    expect(resolveWeeks({ mode: 'current' }, anchor).weeks).toEqual([2]);
    expect(resolveWeeks({ mode: 'next' }, anchor).weeks).toEqual([3]);
    expect(resolveWeeks({ mode: 'prev' }, anchor).weeks).toEqual([1]);
  });

  it('wraps at the cycle boundary', () => {
    const a4 = { currentWeek: 4, anchorDate: '2026-08-08', anchorWeek: 4 };
    expect(resolveWeeks({ mode: 'next' }, a4).weeks).toEqual([1]);
  });

  it('refuses to guess when there is no anchor', () => {
    const r = resolveWeeks({ mode: 'next' }, null);
    expect(r.needsAnchor).toBe(true);
    expect(r.weeks).toEqual([]);
    expect(r.note).toContain('حدّد الأسبوع');
  });

  it('explains where the week number came from', () => {
    expect(resolveWeeks({ mode: 'current' }, anchor).note).toContain('2026-08-08');
  });
});
