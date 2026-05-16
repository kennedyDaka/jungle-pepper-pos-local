import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { ErrorState, LoadingState } from "@/components/DataState";
import { MWK, fmtQty } from "@/lib/format";
import { useAuth } from "@/lib/auth";
import { dashboardService } from "@/services/dashboardService";
import { AlertTriangle, ShoppingCart, TrendingUp, Package, Factory } from "lucide-react";

export const Route = createFileRoute("/_app/dashboard")({
  component: Dashboard,
});

function Dashboard() {
  const { fullName, roles } = useAuth();
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const isoToday = today.toISOString();

  const sales = useQuery({
    queryKey: ["dash", "sales", isoToday],
    queryFn: () => dashboardService.getTodaySales(isoToday),
  });

  const lowStock = useQuery({
    queryKey: ["dash", "low"],
    queryFn: dashboardService.getLowStockItems,
  });

  const negStock = useQuery({
    queryKey: ["dash", "neg"],
    queryFn: dashboardService.getNegativeStockItems,
  });

  const canViewProduction = roles.includes("admin") || roles.includes("storekeeper");
  const prodToday = useQuery({
    queryKey: ["dash", "prod", isoToday],
    queryFn: () => dashboardService.getProductionCountSince(isoToday),
    enabled: canViewProduction,
  });
  const anyLoading =
    sales.isLoading ||
    lowStock.isLoading ||
    negStock.isLoading ||
    (canViewProduction && prodToday.isLoading);
  const firstError = sales.error || lowStock.error || negStock.error || prodToday.error;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Welcome back, {fullName ?? "Local user"}</h1>
        <p className="text-sm text-muted-foreground">
          {new Date().toLocaleDateString("en-GB", {
            weekday: "long",
            day: "numeric",
            month: "long",
            year: "numeric",
          })}
        </p>
      </div>
      {anyLoading && <LoadingState label="Loading live dashboard..." />}
      {firstError && <ErrorState error={firstError} label="Could not load dashboard data" />}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          icon={<TrendingUp />}
          label="Today's sales"
          value={MWK(sales.data?.total ?? 0)}
          sub={`${sales.data?.count ?? 0} orders`}
        />
        <StatCard
          icon={<AlertTriangle />}
          label="Low stock items"
          value={String(lowStock.data?.length ?? 0)}
          tone={lowStock.data?.length ? "warning" : undefined}
        />
        <StatCard
          icon={<Package />}
          label="Negative stock"
          value={String(negStock.data?.length ?? 0)}
          tone={negStock.data?.length ? "destructive" : undefined}
          sub="Variance flagged"
        />
        <StatCard
          icon={<Factory />}
          label="Production today"
          value={canViewProduction ? String(prodToday.data ?? 0) : "-"}
          sub="batches"
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card className="p-4">
          <h2 className="font-semibold flex items-center gap-2 mb-3">
            <ShoppingCart className="h-4 w-4" /> Top items today
          </h2>
          {sales.data?.top.length ? (
            <ul className="space-y-1.5 text-sm">
              {sales.data.top.map(([name, qty]) => (
                <li key={name} className="flex justify-between">
                  <span>{name}</span>
                  <span className="font-medium">{fmtQty(qty)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">No sales yet today.</p>
          )}
        </Card>

        <Card className="p-4">
          <h2 className="font-semibold flex items-center gap-2 mb-3">
            <AlertTriangle className="h-4 w-4 text-warning" /> Low stock alerts
          </h2>
          {lowStock.data?.length ? (
            <ul className="space-y-1.5 text-sm max-h-64 overflow-auto">
              {lowStock.data.map((item) => (
                <li key={item.id} className="flex justify-between">
                  <span>{item.name}</span>
                  <span className="text-warning font-medium">
                    {fmtQty(item.qty_on_hand)} {item.units?.code}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">All items above reorder level.</p>
          )}
        </Card>
      </div>

      {roles.includes("admin") && (
        <p className="text-xs text-muted-foreground">Live mode: data is served by Supabase.</p>
      )}
    </div>
  );
}

function StatCard({
  icon,
  label,
  value,
  sub,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub?: string;
  tone?: "warning" | "destructive";
}) {
  return (
    <Card className="p-4">
      <div className="flex items-center justify-between">
        <span className="text-xs uppercase tracking-wider text-muted-foreground">{label}</span>
        <span
          className={
            tone === "warning"
              ? "text-warning"
              : tone === "destructive"
                ? "text-destructive"
                : "text-primary"
          }
        >
          {icon}
        </span>
      </div>
      <div className="text-2xl font-bold mt-1">{value}</div>
      {sub && <div className="text-xs text-muted-foreground mt-0.5">{sub}</div>}
    </Card>
  );
}
