// خيارات الستيكر القابلة للتأشير في تخصيصات المستفيد — تنعكس كرموز في ستيكرات
// الغداء والعشاء (الصفحة + تصدير Word). مصدر واحد للحقيقة لكل الأماكن.

export type StickerFlagKey = 'no_fish' | 'no_pasta' | 'no_sandwich' | 'low_carb';

export interface StickerFlag {
  key: StickerFlagKey;
  label: string;
  symbol: string;
}

/**
 * علامة «وجبات غداء وعشاء مخصصة» — ليست من STICKER_FLAGS عمداً: تلك تُطبع
 * رموزاً على الستيكر، وهذه للفرز والتمييز في الصفحة فقط ولا تظهر على الستيكر.
 */
export const CUSTOM_LD_MEALS_LABEL = 'وجبات غداء وعشاء مخصصة';

export const STICKER_FLAGS: StickerFlag[] = [
  { key: 'no_fish',           label: 'لا يفضل السمك',                 symbol: '◈' },
  { key: 'no_pasta',          label: 'لا يفضل المكرونة',              symbol: 'No M' },
  { key: 'no_sandwich',       label: 'لا يفضل الساندويش',             symbol: 'No S' },
  { key: 'low_carb',          label: 'قليل الكاربوهيدرات',            symbol: 'Ⓡ' },
];
