import { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { authApi } from '../api';
import { load, save, remove } from '../store';
import { enablePush, disablePush } from '../push';

const USER_KEY = 'user';

interface AuthUser {
  id?: number;
  name?: string;
  name_ar?: string;
  name_en?: string;
  email?: string;
  phone?: string;
  avatar?: string | null;
  created_at?: string;
  role?: string;
  [k: string]: unknown;
}

interface AuthContextValue {
  user: AuthUser | null;
  setUser: (u: AuthUser | null) => void;
  ready: boolean;
  login: (email: string, password: string) => Promise<AuthUser>;
  register: (payload: unknown) => Promise<unknown>;
  verifyEmail: (token: string) => Promise<AuthUser>;
  logout: () => void;
  refreshUser: () => Promise<AuthUser>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUserState] = useState<AuthUser | null>(() => load<AuthUser | null>(USER_KEY, null));
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!user) {
      setReady(true);
      return;
    }
    authApi
      .me()
      .then((u: AuthUser) => {
        setUserState(u);
        save(USER_KEY, u);
        enablePush();
      })
      .catch(() => {
        remove(USER_KEY);
        setUserState(null);
      })
      .finally(() => setReady(true));
  }, []);

  const setUser = useCallback((u: AuthUser | null) => {
    setUserState(u);
    if (u) save(USER_KEY, u);
    else remove(USER_KEY);
  }, []);

  const login = useCallback(
    async (email: string, password: string) => {
      const res = (await authApi.login(email, password)) as any;
      const u = (res && res.user) ? res.user : res;
      setUser(u);
      enablePush();
      return u;
    },
    [setUser]
  );

  const register = useCallback((payload: unknown) => authApi.register(payload), []);

  const verifyEmail = useCallback(
    async (token: string) => {
      const res = (await authApi.verifyEmail(token)) as any;
      const u = (res && res.user) ? res.user : res;
      setUser(u);
      enablePush();
      return u;
    },
    [setUser]
  );

  const logout = useCallback(() => {
    disablePush();
    authApi.logout().catch(() => {});
    setUser(null);
  }, [setUser]);

  const refreshUser = useCallback(async () => {
    const u = (await authApi.me()) as AuthUser;
    setUser(u);
    return u;
  }, [setUser]);

  return (
    <AuthContext.Provider value={{ user, setUser, ready, login, register, verifyEmail, logout, refreshUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
