import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { api, tokenStore } from "./api";
import type { User } from "./types";

type AuthValue = { user: User | null; loading: boolean; login: (u: string, p: string) => Promise<void>; logout: () => Promise<void>; refreshUser: () => Promise<void> };
const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const refreshUser = async () => { setUser(await api.me()); };
  useEffect(() => {
    api.restoreSession()
      .then((access) => access ? refreshUser() : undefined)
      .catch(() => tokenStore.clear())
      .finally(() => setLoading(false));
  }, []);
  const login = async (username: string, password: string) => { tokenStore.set(await api.login(username, password)); await refreshUser(); };
  const logout = async () => {
    try { await api.logout(); } finally { tokenStore.clear(); setUser(null); }
  };
  return <AuthContext.Provider value={{ user, loading, login, logout, refreshUser }}>{children}</AuthContext.Provider>;
}

export function useAuth() { const value = useContext(AuthContext); if (!value) throw new Error("AuthProvider is missing"); return value; }
