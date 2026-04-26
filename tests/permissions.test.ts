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
