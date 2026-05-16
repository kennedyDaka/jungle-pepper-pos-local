import { createFileRoute, Outlet, redirect, useRouter } from "@tanstack/react-router";
import { useEffect } from "react";
import { authService } from "@/services/authService";
import { AppShell } from "@/components/AppShell";
import { useAuth } from "@/lib/auth";

export const Route = createFileRoute("/_app")({
  beforeLoad: async () => {
    if (typeof window === "undefined") return;
    const session = await authService.getSession();
    if (!session) throw redirect({ to: "/login" });
  },
  component: AppLayout,
});

function AppLayout() {
  const router = useRouter();
  const { loading, session, roles } = useAuth();

  useEffect(() => {
    let cancelled = false;
    if (!loading && (!session || roles.length === 0)) {
      authService.signOut().finally(() => {
        if (!cancelled) router.navigate({ to: "/login" });
      });
    }
    return () => {
      cancelled = true;
    };
  }, [loading, session, roles.length, router]);

  if (loading || !session || roles.length === 0)
    return (
      <div className="min-h-screen flex items-center justify-center text-muted-foreground">
        Loading...
      </div>
    );
  return (
    <AppShell>
      <Outlet />
    </AppShell>
  );
}
