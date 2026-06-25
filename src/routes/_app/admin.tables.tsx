import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, useMemo } from "react";
import { Card } from "@/components/ui/card";
import { ErrorState, LoadingState } from "@/components/DataState";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Plus, Trash2 } from "lucide-react";
import { supabase } from "@/services/repositories/supabaseClient";
import { toast } from "sonner";
import type { Table } from "@/types/domain";

export const Route = createFileRoute("/_app/admin/tables")({
  component: AdminTablesPage,
});

function AdminTablesPage() {
  const qc = useQueryClient();
  const [showAdd, setShowAdd] = useState(false);
  const [newLabel, setNewLabel] = useState("");
  const [newCapacity, setNewCapacity] = useState(4);
  const [newSortOrder, setNewSortOrder] = useState(0);

  const branchMemberships = useQuery({
    queryKey: ["auth", "branch-memberships"],
    queryFn: async () => {
      const { data: membershipData, error: membershipError } = await supabase
        .from("branch_memberships")
        .select("branch_id, branches!inner(id, name)")
        .eq("active", true)
        .maybeSingle();
      if (membershipError) throw membershipError;
      if (membershipData)
        return membershipData as { branch_id: string; branches: { id: string; name: string } };
      const { data: branchData, error: branchError } = await supabase
        .from("branches")
        .select("id, name")
        .eq("active", true)
        .order("name")
        .limit(1)
        .maybeSingle();
      if (branchError) throw branchError;
      if (!branchData) return null;
      return { branch_id: branchData.id, branches: { id: branchData.id, name: branchData.name } };
    },
  });

  const branchMembership = branchMemberships.data;
  const branchName = branchMembership?.branches?.name ?? "Branch";

  const tables = useQuery({
    queryKey: ["admin", "tables", branchMembership?.branch_id],
    queryFn: async () => {
      const bid = branchMembership!.branch_id;
      const { data, error } = await supabase
        .from("tables")
        .select("*")
        .eq("branch_id", bid)
        .order("sort_order");
      if (error) throw error;
      return (data ?? []) as Table[];
    },
    enabled: !!branchMembership?.branch_id,
  });

  const addTable = useMutation({
    mutationFn: async () => {
      if (!branchMembership?.branch_id) throw new Error("No branch selected");
      const { error } = await supabase.from("tables").insert({
        branch_id: branchMembership.branch_id,
        label: newLabel.trim(),
        capacity: newCapacity,
        sort_order: newSortOrder,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      setShowAdd(false);
      setNewLabel("");
      setNewCapacity(4);
      setNewSortOrder(0);
      qc.invalidateQueries({ queryKey: ["admin", "tables"] });
      toast.success("Table added");
    },
    onError: (e: any) => toast.error(e.message),
  });

  const updateTable = useMutation({
    mutationFn: async ({
      id,
      label,
      capacity,
      sort_order,
      active,
    }: {
      id: string;
      label?: string;
      capacity?: number;
      sort_order?: number;
      active?: boolean;
    }) => {
      const { error } = await supabase
        .from("tables")
        .update({ label, capacity, sort_order, active })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "tables"] });
      toast.success("Table updated");
    },
    onError: (e: any) => toast.error(e.message),
  });

  const deleteTable = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("tables").update({ active: false }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "tables"] });
      toast.success("Table deactivated");
    },
    onError: (e: any) => toast.error(e.message),
  });

  if (!branchMembership?.branch_id) {
    return (
      <div className="p-4 text-center text-muted-foreground">
        {branchMemberships.isLoading ? "Loading branch..." : "No branch found for your account."}
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">Tables</h1>
          <p className="text-sm text-muted-foreground">{branchName}</p>
        </div>
        <Button onClick={() => setShowAdd(true)}>
          <Plus className="h-4 w-4 mr-1" /> Add table
        </Button>
      </div>

      {tables.isLoading && <LoadingState label="Loading tables..." />}
      {tables.error && <ErrorState error={tables.error} label="Could not load tables" />}

      <div className="space-y-2">
        {(tables.data ?? []).map((t) => (
          <TableRow
            key={t.id}
            table={t}
            onSave={(patch) => updateTable.mutate({ id: t.id, ...patch })}
            onDelete={() => deleteTable.mutate(t.id)}
            busy={updateTable.isPending || deleteTable.isPending}
          />
        ))}
        {(tables.data ?? []).length === 0 && !tables.isLoading && (
          <Card className="p-8 text-center text-muted-foreground">
            No tables yet. Add one to start.
          </Card>
        )}
      </div>

      {showAdd && (
        <Dialog open onOpenChange={() => setShowAdd(false)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Add table</DialogTitle>
              <DialogDescription>Create a new table for waiter orders.</DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              <div>
                <Label>Label</Label>
                <Input
                  value={newLabel}
                  onChange={(e) => setNewLabel(e.target.value)}
                  placeholder="Table 10"
                  autoFocus
                />
              </div>
              <div>
                <Label>Capacity</Label>
                <Input
                  type="number"
                  min={1}
                  value={newCapacity}
                  onChange={(e) => setNewCapacity(Math.max(1, Number(e.target.value) || 1))}
                />
              </div>
              <div>
                <Label>Sort order</Label>
                <Input
                  type="number"
                  min={0}
                  value={newSortOrder}
                  onChange={(e) => setNewSortOrder(Math.max(0, Number(e.target.value) || 0))}
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setShowAdd(false)}>
                Cancel
              </Button>
              <Button
                disabled={!newLabel.trim() || addTable.isPending}
                onClick={() => addTable.mutate()}
              >
                Add
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

function TableRow({
  table,
  onSave,
  onDelete,
  busy,
}: {
  table: Table;
  onSave: (patch: {
    label?: string;
    capacity?: number;
    sort_order?: number;
    active?: boolean;
  }) => void;
  onDelete: () => void;
  busy: boolean;
}) {
  const [label, setLabel] = useState(table.label);
  const [capacity, setCapacity] = useState(table.capacity);
  const [sortOrder, setSortOrder] = useState(table.sort_order);
  const [active, setActive] = useState(table.active);

  const hasChanges =
    label !== table.label ||
    capacity !== table.capacity ||
    sortOrder !== table.sort_order ||
    active !== table.active;

  return (
    <Card className="p-4">
      <div className="grid grid-cols-[1fr_100px_100px_80px_auto] gap-3 items-end">
        <div>
          <Label>Label</Label>
          <Input value={label} onChange={(e) => setLabel(e.target.value)} />
        </div>
        <div>
          <Label>Capacity</Label>
          <Input
            type="number"
            min={1}
            value={capacity}
            onChange={(e) => setCapacity(Math.max(1, Number(e.target.value) || 1))}
          />
        </div>
        <div>
          <Label>Sort</Label>
          <Input
            type="number"
            min={0}
            value={sortOrder}
            onChange={(e) => setSortOrder(Math.max(0, Number(e.target.value) || 0))}
          />
        </div>
        <div className="text-center">
          <Label className="block text-center mb-1">Active</Label>
          <Switch checked={active} onCheckedChange={setActive} />
        </div>
        <div className="flex gap-1">
          <Button
            size="sm"
            disabled={!hasChanges || busy}
            onClick={() => onSave({ label: label.trim(), capacity, sort_order: sortOrder, active })}
          >
            Save
          </Button>
          <Button size="sm" variant="ghost" disabled={busy} onClick={onDelete}>
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </Card>
  );
}
