/**
 * فهرس صفحات النظام للتنقّل بالأمر: «افتح صفحة التقارير».
 *
 * مصدر واحد يربط بين ما ينطقه المستخدم، والمسار، والصلاحية المطلوبة لعرضه.
 */

import type { PageKey } from '@/lib/permissions';

export interface PageEntry {
  /** مفتاح الصلاحية — أو null للصفحات المتاحة لكل مسجَّل دخول. */
  permission: PageKey | null;
  href: string;
  label: string;
  /** أسماء ينطقها المستخدم (تُطبَّع قبل المقارنة). */
  aliases: string[];
}

export const PAGE_CATALOG: PageEntry[] = [
  {
    permission: 'dashboard',
    href: '/',
    label: 'لوحة التحكم',
    aliases: ['لوحة التحكم', 'الرئيسية', 'الرئيسيه', 'الصفحة الرئيسية', 'الداشبورد', 'لوحه التحكم'],
  },
  {
    permission: 'beneficiaries',
    href: '/beneficiaries',
    label: 'المستفيدون',
    aliases: ['المستفيدين', 'المستفيدون', 'صفحة المستفيدين', 'النزلاء'],
  },
  {
    permission: 'companions',
    href: '/companions',
    label: 'المرافقون',
    aliases: ['المرافقين', 'المرافقون', 'صفحة المرافقين'],
  },
  {
    permission: 'meals',
    href: '/meals',
    label: 'الأصناف',
    aliases: ['الاصناف', 'الأصناف', 'صفحة الاصناف', 'الوجبات'],
  },
  {
    permission: 'menu',
    href: '/menu',
    label: 'قائمة الطعام',
    aliases: ['قائمة الطعام', 'المنيو', 'القائمة', 'قائمه الطعام', 'المنو'],
  },
  {
    permission: 'orders',
    href: '/orders',
    label: 'أوامر التشغيل',
    aliases: ['اوامر التشغيل', 'أوامر التشغيل', 'الاوامر', 'امر التشغيل'],
  },
  {
    permission: 'delivery_orders',
    href: '/delivery-orders',
    label: 'أوامر التسليم',
    aliases: ['اوامر التسليم', 'أوامر التسليم', 'التسليم', 'امر التسليم'],
  },
  {
    permission: 'reports',
    href: '/reports',
    label: 'التقارير',
    aliases: ['التقارير', 'تقارير', 'صفحة التقارير'],
  },
  {
    permission: 'stickers',
    href: '/stickers',
    label: 'ستيكرات الفطور',
    aliases: ['ستيكرات الفطور', 'ستكرات الفطور', 'ملصقات الفطور'],
  },
  {
    permission: 'lunch_dinner_stickers',
    href: '/lunch-dinner-stickers',
    label: 'ستيكرات الغداء والعشاء',
    aliases: ['ستيكرات الغداء', 'ستيكرات العشاء', 'ستيكرات الغداء والعشاء', 'ملصقات الغداء'],
  },
  {
    permission: null,
    href: '/approvals',
    label: 'الموافقات',
    aliases: ['الموافقات', 'طلبات الموافقة', 'الطلبات'],
  },
  {
    permission: 'settings',
    href: '/settings',
    label: 'الإعدادات',
    aliases: ['الاعدادات', 'الإعدادات', 'الضبط', 'الاعداد'],
  },
];
