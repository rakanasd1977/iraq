import { createAuth } from '@rafidain/shared/auth';
import { api } from './api';
import { push } from './push';

export const { AuthProvider, useAuth } = createAuth({
  role: 'admin',
  api,
  push,
});

export function useAuthPermissions() {
  const { user } = useAuth();
  const perms = (user?.permissions || []) as string[];
  const roles = (user?.roles || []) as string[];
  const isSuper = roles.includes('super_admin');
  const set = new Set(perms);
  const can = (resource: string, action: string) => isSuper || set.has(`${resource}:${action}`);
  return { can, isSuper, permissions: perms, roles };
}
