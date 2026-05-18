import { Link, useRouter } from "@tanstack/react-router";
import logo from "@/assets/jungle-pepper-logo.png";
import { useAuth, type Role } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { LogOut } from "lucide-react";

const NAV: { to: string; label: string; roles: Role[] }[] = [
  { to: "/", label: "Dashboard", roles: ["admin", "storekeeper", "cashier"] },
  { to: "/pos", label: "POS", roles: ["admin", "cashier"] },
  { to: "/inventory", label: "Inventory", roles: ["admin", "storekeeper"] },
  { to: "/production", label: "Production", roles: ["admin", "storekeeper"] },
  { to: "/expenses", label: "Expenses", roles: ["admin", "storekeeper"] },
  { to: "/recipes", label: "Recipes", roles: ["admin"] },
  { to: "/menu", label: "Menu", roles: ["admin"] },
  { to: "/reports", label: "Reports", roles: ["admin", "storekeeper"] },
  { to: "/admin/users", label: "Users", roles: ["admin"] },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const { roles, fullName, username, signOut } = useAuth();
  const router = useRouter();
  const items = NAV.filter((n) => n.roles.some((r) => roles.includes(r)));

  return (
    <div className="min-h-screen flex flex-col">
      <header className="border-b border-border bg-sidebar">
        <div className="flex items-center gap-4 px-4 py-2.5">
          <Link to="/" className="flex items-center gap-2.5">
            <img src={logo} alt="Jungle Pepper" width={36} height={36} className="rounded" />
            <div className="leading-tight">
              <div className="font-bold text-base tracking-tight">Jungle Pepper</div>
              <div className="text-[10px] text-muted-foreground">Kidney Crescent - Blantyre</div>
            </div>
          </Link>
          <nav className="flex-1 flex flex-wrap items-center gap-1 ml-4">
            {items.map((n) => (
              <Link
                key={n.to}
                to={n.to}
                className="px-3 py-1.5 rounded-md text-sm text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors"
                activeProps={{ className: "bg-primary text-primary-foreground hover:bg-primary" }}
                activeOptions={{ exact: n.to === "/" }}
              >
                {n.label}
              </Link>
            ))}
          </nav>
          <div className="flex items-center gap-3 text-sm">
            <div className="text-right leading-tight">
              <div className="font-medium">{fullName ?? username}</div>
              <div className="text-[10px] uppercase text-muted-foreground">{roles.join(", ")}</div>
            </div>
            <Button
              size="sm"
              variant="ghost"
              onClick={async () => {
                await signOut();
                router.navigate({ to: "/login" });
              }}
            >
              <LogOut className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </header>
      <main className="flex-1 p-4 md:p-6">{children}</main>
    </div>
  );
}
