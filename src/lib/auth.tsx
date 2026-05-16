import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { authService } from "@/services/authService";
import type { AuthSession, AuthUser, Role } from "@/types/domain";

export type { Role };

interface AuthCtx {
  session: AuthSession | null;
  user: AuthUser | null;
  username: string | null;
  fullName: string | null;
  roles: Role[];
  loading: boolean;
  signOut: () => Promise<void>;
  refresh: () => Promise<void>;
}

const Ctx = createContext<AuthCtx>({
  session: null,
  user: null,
  username: null,
  fullName: null,
  roles: [],
  loading: true,
  signOut: async () => {},
  refresh: async () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<AuthSession | null>(null);
  const [profile, setProfile] = useState<{ username: string; full_name: string } | null>(null);
  const [roles, setRoles] = useState<Role[]>([]);
  const [loading, setLoading] = useState(true);

  const loadProfile = async (nextSession: AuthSession | null) => {
    setSession(nextSession);
    if (!nextSession) {
      setProfile(null);
      setRoles([]);
      return;
    }

    const current = await authService.getCurrentProfile();
    setProfile(current ? { username: current.username, full_name: current.full_name } : null);
    setRoles(current?.roles ?? []);
  };

  useEffect(() => {
    let alive = true;

    authService
      .getSession()
      .then(async (nextSession) => {
        if (!alive) return;
        await loadProfile(nextSession);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });

    const unsubscribe = authService.onSessionChange(async (nextSession) => {
      if (!alive) return;
      await loadProfile(nextSession);
      setLoading(false);
    });

    return () => {
      alive = false;
      unsubscribe();
    };
  }, []);

  return (
    <Ctx.Provider
      value={{
        session,
        user: session?.user ?? null,
        username: profile?.username ?? null,
        fullName: profile?.full_name ?? null,
        roles,
        loading,
        signOut: async () => {
          await authService.signOut();
          setSession(null);
          setProfile(null);
          setRoles([]);
        },
        refresh: async () => {
          await loadProfile(session);
        },
      }}
    >
      {children}
    </Ctx.Provider>
  );
}

export const useAuth = () => useContext(Ctx);
export const hasRole = (roles: Role[], role: Role) => roles.includes(role);
