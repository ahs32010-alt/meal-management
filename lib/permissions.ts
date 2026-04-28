export type PagePermission = {
  view: boolean;
  add: boolean;
  edit: boolean;
  delete: boolean;
};

export type PageKey =
  | 'dashboard'
  | 'beneficiaries'
  | 'companions'
  | 'meals'
  | 'menu'
  | 'orders'
  | 'reports'
  | 'stickers'
  | 'settings';

export type PermissionAction = 'view' | 'add' | 'edit' | 'delete';

export type PermissionsMap = Partial<Record<PageKey, PagePermission>>;

export interface AppUser {
  id: string;
  email: string;
  full_name: string | null;
  is_admin: boolean;
  permissions: PermissionsMap;
  avatar_url: string | null;
  created_at: string;
  updated_at: string;
}

export const PAGES: { key: PageKey; label: string; href: string }[] = [
  { key: 'dashboard',     label: 'لوحة التحكم',  href: '/' },
  { key: 'beneficiaries', label: 'المستفيدون',   href: '/beneficiaries' },
  { key: 'companions',    label: 'المرافقون',    href: '/companions' },
  { key: 'meals',         label: 'الأصناف',      href: '/meals' },
  { key: 'menu',          label: 'قائمة الطعام', href: '/menu' },
  { key: 'orders',        label: 'أوامر التشغيل', href: '/orders' },
  { key: 'reports',       label: 'التقارير',     href: '/reports' },
  { key: 'stickers',      label: 'الستيكرات',    href: '/stickers' },
  { key: 'settings',      label: 'الإعدادات',    href: '/settings' },
];

export const ACTION_LABELS: Record<PermissionAction, string> = {
  view:   'عرض',
  add:    'إضافة',
  edit:   'تعديل',
  delete: 'حذف',
};

// الإجراءات الفعلية المتاحة لكل صفحة — مو كل الصفحات لها نفس الـactions.
// مثلاً: لوحة التحكم/التقارير/الستيكرات — عرض فقط (لا إضافة/تعديل/حذف).
// قائمة الطعام — تعديل لخلايا المنيو فقط.
// الإعدادات — عرض + تعديل (لإدارة الترجمة الحرفية).
export const PAGE_AVAILABLE_ACTIONS: Record<PageKey, PermissionAction[]> = {
  dashboard:     ['view'],
  beneficiaries: ['view', 'add', 'edit', 'delete'],
  companions:    ['view', 'add', 'edit', 'delete'],
  meals:         ['view', 'add', 'edit', 'delete'],
  menu:          ['view', 'edit'],
  orders:        ['view', 'add', 'edit', 'delete'],
  reports:       ['view'],
  stickers:      ['view'],
  settings:      ['view', 'edit'],
};

// مساعد: هل هذا الإجراء متاح أصلاً على هذه الصفحة؟
export function isActionAvailable(page: PageKey, action: PermissionAction): boolean {
  return PAGE_AVAILABLE_ACTIONS[page]?.includes(action) ?? false;
}

export function emptyPermissions(): Required<Record<PageKey, PagePermission>> {
  const out = {} as Record<PageKey, PagePermission>;
  for (const p of PAGES) {
    out[p.key] = { view: false, add: false, edit: false, delete: false };
  }
  return out as Required<Record<PageKey, PagePermission>>;
}

export function can(user: AppUser | null, page: PageKey, action: PermissionAction): boolean {
  if (!user) return false;
  if (user.is_admin) return true;
  return Boolean(user.permissions?.[page]?.[action]);
}
