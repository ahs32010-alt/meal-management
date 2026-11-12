import { describe, expect, it } from 'vitest';
import { can, emptyPermissions, type AppUser } from '@/lib/permissions';

const baseUser = (overrides: Partial<AppUser> = {}): AppUser => ({
  id: 'u1',
  email: 'u@example.com',
  full_name: 'User',
  is_admin: false,
  permissions: {},
  avatar_url: null,
  created_at: '2026-01-01',
  updated_at: '2026-01-01',
  ...overrides,
});

describe('can()', () => {
  it('returns false for null user', () => {
    expect(can(null, 'meals', 'view')).toBe(false);
  });

  it('returns true for any action when user is admin', () => {
    const admin = baseUser({ is_admin: true });
    expect(can(admin, 'settings', 'delete')).toBe(true);
    expect(can(admin, 'meals', 'edit')).toBe(true);
  });

  it('respects permission flags for non-admin', () => {
    const u = baseUser({
      permissions: { meals: { view: true, add: false, edit: false, delete: false } },
    });
    expect(can(u, 'meals', 'view')).toBe(true);
    expect(can(u, 'meals', 'add')).toBe(false);
    expect(can(u, 'orders', 'view')).toBe(false);
  });
});

describe('emptyPermissions()', () => {
  it('returns all pages with all-false flags', () => {
    const p = emptyPermissions();
    expect(p.meals).toEqual({ view: false, add: false, edit: false, delete: false });
    expect(p.beneficiaries).toEqual({ view: false, add: false, edit: false, delete: false });
    expect(p.settings).toEqual({ view: false, add: false, edit: false, delete: false });
  });
});

describe('صلاحيات أقسام المطبخ وحصر الأقسام', () => {
  it('تظهر في جدول الصلاحيات بإجراءاتها', async () => {
    const { PAGES, PAGE_AVAILABLE_ACTIONS } = await import('@/lib/permissions');
    expect(PAGES.map(p => p.key)).toEqual(expect.arrayContaining(['kitchen_sections', 'kitchen_report']));
    expect(PAGE_AVAILABLE_ACTIONS.kitchen_sections).toEqual(['view', 'add', 'edit', 'delete']);
    expect(PAGE_AVAILABLE_ACTIONS.kitchen_report).toEqual(['view']);
  });

  it('صلاحية الجزء وحدها تفتح الصفحة الأم (الرابط في القائمة)', async () => {
    const { canOpenPage } = await import('@/lib/permissions');
    const u = baseUser({ permissions: { kitchen_sections: { view: true, add: false, edit: false, delete: false } } });
    expect(canOpenPage(u, 'meals')).toBe(true);
    expect(can(u, 'meals', 'view')).toBe(false);
    expect(canOpenPage(u, 'reports')).toBe(false);
    const r = baseUser({ permissions: { kitchen_report: { view: true, add: false, edit: false, delete: false } } });
    expect(canOpenPage(r, 'reports')).toBe(true);
    expect(canOpenPage(r, 'meals')).toBe(false);
  });

  it('أقسام المطبخ تنفّذ مباشرة — بلا خيار موافقة', async () => {
    const { needsApproval, isApprovalAvailable } = await import('@/lib/permissions');
    const u = baseUser({
      permissions: { kitchen_sections: { view: true, add: true, edit: true, delete: true } },
      approval_required: { kitchen_sections: { add: true, edit: true, delete: true } },
    });
    expect(needsApproval(u, 'kitchen_sections', 'edit')).toBe(false);
    expect(isApprovalAvailable('kitchen_sections', 'add')).toBe(false);
    expect(isApprovalAvailable('meals', 'add')).toBe(true);
  });
});
