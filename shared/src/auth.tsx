import { createContext, useContext, useState, useEffect, useCallback } from 'react';

export interface AuthApi {
  get(path: string, extra?: any): Promise<any>;
  post(path: string, body?: unknown, extra?: any): Promise<any>;
}

export interface PushController {
  enablePush?: () => void | Promise<boolean>;
  disablePush?: () => void | Promise<void>;
}

export interface AuthOptions {
  role: string;
  api: AuthApi;
  push?: PushController | null;
}

export interface AuthContextValue {
  user: any;
  loading: boolean;
  login: (email: string, password: string) => Promise<any>;
  verify2fa: (twofaToken: string, code: string) => Promise<any>;
  logout: () => void;
  reload: () => Promise<void>;
}

export function createAuth({ role, api, push }: AuthOptions) {
  const AuthContext = createContext<AuthContextValue | null>(null);

  function AuthProvider({ children }: { children: React.ReactNode }) {
    const [user, setUser] = useState<any>(null);
    const [loading, setLoading] = useState(true);

    const loadMe = useCallback(async () => {
      try {
        const res = await api.get('/auth/me');
        setUser(res.data);
        
      } catch (e) {
        setUser(null);
      } finally {
        setLoading(false);
      }
    }, [push, api]);

    useEffect(() => {
      loadMe();
    }, [loadMe]);

    const login = async (email: string, password: string) => {
      const res = await api.post('/auth/login', { email, password, role });
      if (res.data && res.data.requires_2fa) {
        return { requires_2fa: true, twofa_token: res.data.twofa_token, user: res.data.user };
      }
      setUser(res.data.user);
      
      return res.data.user;
    };

    const verify2fa = async (twofaToken: string, code: string) => {
      const res = await api.post('/auth/2fa/verify', { twofa_token: twofaToken, code });
      setUser(res.data.user);
      
      return res.data.user;
    };

    const logout = () => {
      push?.disablePush?.();
      api.post('/auth/logout', {}, { silent: true }).catch(() => {});
      setUser(null);
    };

    return (
      <AuthContext.Provider value={{ user, loading, login, verify2fa, logout, reload: loadMe }}>
        {children}
      </AuthContext.Provider>
    );
  }

  function useAuth(): AuthContextValue {
    return useContext(AuthContext) as AuthContextValue;
  }

  return { AuthProvider, useAuth };
}
