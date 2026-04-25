export type PagePermission = {
  view: boolean;
  add: boolean;
  edit: boolean;
  delete: boolean;
};

export type PageKey =
  | 'dashboard'
  | 'beneficiaries'
  | 'meals'
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
  { key: 'meals',         label: 'الأصناف',      href: '/meals' },
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
