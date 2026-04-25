// splits[ben_id][meal_id] = groupIndex  (0 = main sticker, 1 = sticker 2, …)
// meal_ids not present default to group 0
export type GroupMap = Record<string, number>;
export type SplitsMap = Record<string, GroupMap>;

export const GROUP_COLORS = [
  { bg: 'bg-slate-700',   text: 'text-white', border: 'border-slate-700',   label: 'أصلي'   },
  { bg: 'bg-violet-600',  text: 'text-white', border: 'border-violet-600',  label: 'ستيكر ٢' },
  { bg: 'bg-rose-500',    text: 'text-white', border: 'border-rose-500',    label: 'ستيكر ٣' },
  { bg: 'bg-amber-500',   text: 'text-white', border: 'border-amber-500',   label: 'ستيكر ٤' },
  { bg: 'bg-emerald-600', text: 'text-white', border: 'border-emerald-600', label: 'ستيكر ٥' },
];

export function serializeSplits(gm: GroupMap): string[] {
  return Object.entries(gm).filter(([, g]) => g > 0).map(([id, g]) => `${id}:${g}`);
}

export function deserializeSplits(arr: string[]): GroupMap {
  const gm: GroupMap = {};
  for (const s of arr) {
    const idx = s.lastIndexOf(':');
    if (idx === -1) {
      gm[s] = 1;
    } else {
      gm[s.slice(0, idx)] = parseInt(s.slice(idx + 1)) || 1;
    }
  }
  return gm;
}

export function maxGroup(gm: GroupMap): number {
  return Math.max(0, ...Object.values(gm));
}
