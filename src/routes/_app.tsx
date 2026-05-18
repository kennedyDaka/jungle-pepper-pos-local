import { createFileRoute, Outlet, redirect, useRouter } from "@tanstack/react-router";
import { useEffect } from "react";
import { authService } from "@/services/authService";
import { AppShell } from "@/components/AppShell";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";

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
  const { loading, session, roles, signOut } = useAuth();

  useEffect(() => {
    if (!loading && !session) {
      router.navigate({ to: "/login" });
    }
  }, [loading, session, router]);

  if (loading || !session)
    return (
      <div className="min-h-screen flex items-center justify-center text-muted-foreground">
        Loading...
      </div>
    );

  if (roles.length === 0) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4 bg-background">
        <div className="max-w-md text-center space-y-3">
          <h1 className="text-xl font-semibold">No staff role assigned</h1>
          <p className="text-sm text-muted-foreground">
            Your Supabase login is valid, but this account does not have a Jungle Pepper staff role
            yet. Ask an admin to assign a role, then refresh.
          </p>
          <Button
            variant="secondary"
            onClick={() => signOut().then(() => router.navigate({ to: "/login" }))}
          >
            Sign out
          </Button>
        </div>
      </div>
    );
  }

  return (
    <AppShell>
      <Outlet />
    </AppShell>
  );
}
