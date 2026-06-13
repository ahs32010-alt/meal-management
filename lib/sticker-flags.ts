// خيارات الستيكر القابلة للتأشير في تخصيصات المستفيد — تنعكس كرموز في ستيكرات
// الغداء والعشاء (الصفحة + تصدير Word). مصدر واحد للحقيقة لكل الأماكن.

export type StickerFlagKey = 'no_fish' | 'no_pasta_sandwich' | 'low_carb';

export interface StickerFlag {
  key: StickerFlagKey;
  label: string;
  symbol: string;
}

export const STICKER_FLAGS: StickerFlag[] = [
  { key: 'no_fish',           label: 'لا يفضل السمك',                 symbol: '◈' },
  { key: 'no_pasta_sandwich', label: 'لا يفضل المكرونة ولا الساندويش', symbol: '■' },
  { key: 'low_carb',          label: 'قليل الكاربوهيدرات',            symbol: 'Ⓡ' },
];
