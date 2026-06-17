import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/services/repositories/supabaseClient";
import { reservationService } from "@/services/reservationService";
import type { Reservation } from "@/types/domain";
import { Card } from "@/components/ui/card";
import { ErrorState, LoadingState } from "@/components/DataState";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { Check, X } from "lucide-react";
import { fmtDate } from "@/lib/format";

export const Route = createFileRoute("/_app/reservations")({
  component: ReservationsPage,
});

const STATUSES = ["pending", "confirmed", "cancelled"] as const;

function ReservationsPage() {
  const qc = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<string>("pending");
  const today = new Date().toISOString().slice(0, 10);
  const [dateFilter, setDateFilter] = useState(today);

  const membership = useQuery({
    queryKey: ["auth", "branch-membership"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("branch_memberships")
        .select("branch_id, branches!inner(id, name)")
        .eq("active", true)
        .maybeSingle();
      if (error) throw error;
      return data as { branch_id: string; branches: { id: string; name: string } };
    },
  });
  const branchId = membership.data?.branch_id;

  const reservations = useQuery({
    queryKey: ["reservations", branchId, statusFilter, dateFilter],
    queryFn: () => reservationService.list(branchId!, statusFilter),
    enabled: !!branchId,
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: "confirmed" | "cancelled" }) =>
      reservationService.updateStatus(id, status),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["reservations"] });
      toast.success("Reservation updated");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const filtered = (reservations.data ?? []).filter((r: Reservation) =>
    dateFilter ? r.reservation_date === dateFilter : true,
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h1 className="text-2xl font-bold">Reservations</h1>
        <div className="flex items-center gap-2">
          <input
            type="date"
            value={dateFilter}
            onChange={(e) => setDateFilter(e.target.value)}
            className="rounded-md border border-input bg-background px-3 py-1.5 text-sm"
          />
        </div>
      </div>

      <div className="flex gap-1 border-b border-border pb-px">
        {["pending", "confirmed", "cancelled"].map((s) => (
          <button
            key={s}
            onClick={() => setStatusFilter(s)}
            className={`px-4 py-2 text-sm font-medium rounded-t-md transition-colors ${
              statusFilter === s
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:text-foreground hover:bg-secondary"
            }`}
          >
            {s.charAt(0).toUpperCase() + s.slice(1)}
          </button>
        ))}
      </div>

      {reservations.isLoading && <LoadingState label="Loading reservations..." />}
      {reservations.error && <ErrorState error={reservations.error} label="Could not load reservations" />}

      {!reservations.isLoading && !reservations.error && filtered.length === 0 && (
        <p className="text-muted-foreground text-sm py-8 text-center">
          No {statusFilter} reservations{dateFilter ? ` for ${fmtDate(dateFilter)}` : ""}.
        </p>
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {filtered.map((r: Reservation) => (
          <Card key={r.id} className="p-4 space-y-2">
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="font-semibold">{r.customer_name}</p>
                <p className="text-sm text-muted-foreground">{r.phone}</p>
                {r.email && <p className="text-sm text-muted-foreground">{r.email}</p>}
              </div>
              <span
                className={`inline-block rounded-full px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wider ${
                  r.status === "confirmed"
                    ? "bg-green-100 text-green-800"
                    : r.status === "cancelled"
                      ? "bg-red-100 text-red-800"
                      : "bg-yellow-100 text-yellow-800"
                }`}
              >
                {r.status}
              </span>
            </div>
            <div className="text-sm space-y-0.5">
              <p>
                <span className="text-muted-foreground">Date:</span>{" "}
                {fmtDate(r.reservation_date)} at {r.reservation_time.slice(0, 5)}
              </p>
              <p>
                <span className="text-muted-foreground">Guests:</span> {r.guests}
              </p>
              {r.occasion && (
                <p>
                  <span className="text-muted-foreground">Occasion:</span> {r.occasion}
                </p>
              )}
              {r.notes && (
                <p>
                  <span className="text-muted-foreground">Notes:</span> {r.notes}
                </p>
              )}
            </div>
            {r.status === "pending" && (
              <div className="flex gap-2 pt-1">
                <Button
                  size="sm"
                  className="flex-1"
                  onClick={() => updateMutation.mutate({ id: r.id, status: "confirmed" })}
                  disabled={updateMutation.isPending}
                >
                  <Check className="h-4 w-4 mr-1" />
                  Confirm
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="flex-1 text-red-600 border-red-200 hover:bg-red-50"
                  onClick={() => updateMutation.mutate({ id: r.id, status: "cancelled" })}
                  disabled={updateMutation.isPending}
                >
                  <X className="h-4 w-4 mr-1" />
                  Cancel
                </Button>
              </div>
            )}
          </Card>
        ))}
      </div>
    </div>
  );
}
