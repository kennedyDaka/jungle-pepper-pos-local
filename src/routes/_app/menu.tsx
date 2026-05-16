import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Card } from "@/components/ui/card";
import { ErrorState, LoadingState } from "@/components/DataState";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { MWK } from "@/lib/format";
import { menuService } from "@/services/menuService";
import { toast } from "sonner";
import { Plus, Trash2 } from "lucide-react";

export const Route = createFileRoute("/_app/menu")({ component: MenuAdmin });

function MenuAdmin() {
  const qc = useQueryClient();
  const [open, setOpen] = useState<any | null>(null);
  const cats = useQuery({
    queryKey: ["menu", "cats"],
    queryFn: async () => {
      return menuService.listCategories();
    },
  });
  const items = useQuery({
    queryKey: ["menu", "items"],
    queryFn: async () => {
      return menuService.listMenuItems();
    },
  });

  const del = async (id: string) => {
    if (!confirm("Delete this menu item?")) return;
    await menuService.deleteMenuItem(id);
    qc.invalidateQueries({ queryKey: ["menu"] });
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold">Menu</h1>
        <Button
          onClick={() =>
            setOpen({
              name: "",
              price: 0,
              category_id: cats.data?.[0]?.id,
              description: "",
              active: true,
            })
          }
        >
          <Plus className="h-4 w-4 mr-1" />
          New item
        </Button>
      </div>
      {(cats.isLoading || items.isLoading) && <LoadingState label="Loading live menu..." />}
      {(cats.error || items.error) && (
        <ErrorState error={cats.error || items.error} label="Could not load menu" />
      )}
      <Card className="overflow-auto">
        <table className="w-full text-sm">
          <thead className="bg-secondary/50">
            <tr className="text-left">
              <th className="p-2">Name</th>
              <th className="p-2">Category</th>
              <th className="p-2 text-right">Price</th>
              <th className="p-2">Description</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {items.data?.map((m: any) => (
              <tr key={m.id} className="border-t border-border hover:bg-secondary/30">
                <td className="p-2 font-medium">{m.name}</td>
                <td className="p-2 text-muted-foreground">{m.categories?.name}</td>
                <td className="p-2 text-right">{MWK(m.price)}</td>
                <td className="p-2 text-xs text-muted-foreground max-w-md truncate">
                  {m.description}
                </td>
                <td className="p-2 text-right whitespace-nowrap">
                  <Button size="sm" variant="ghost" onClick={() => setOpen(m)}>
                    Edit
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => del(m.id)}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      {open && (
        <ItemDialog
          item={open}
          cats={cats.data ?? []}
          onClose={() => setOpen(null)}
          onSaved={() => {
            qc.invalidateQueries({ queryKey: ["menu"] });
            setOpen(null);
          }}
        />
      )}
    </div>
  );
}

function ItemDialog({ item, cats, onClose, onSaved }: any) {
  const [m, setM] = useState({ ...item });
  const save = async () => {
    const payload = {
      name: m.name,
      price: m.price,
      category_id: m.category_id,
      description: m.description,
      active: m.active,
    };
    await menuService.saveMenuItem(m.id ? { ...payload, id: m.id } : payload);
    toast.success("Saved");
    onSaved();
  };
  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{m.id ? "Edit" : "New"} menu item</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Name</Label>
            <Input value={m.name} onChange={(e) => setM({ ...m, name: e.target.value })} />
          </div>
          <div>
            <Label>Category</Label>
            <Select
              value={m.category_id ?? ""}
              onValueChange={(v) => setM({ ...m, category_id: v })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {cats.map((c: any) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Price (MWK)</Label>
            <Input
              type="number"
              value={m.price}
              onChange={(e) => setM({ ...m, price: Number(e.target.value) })}
            />
          </div>
          <div>
            <Label>Description</Label>
            <Input
              value={m.description ?? ""}
              onChange={(e) => setM({ ...m, description: e.target.value })}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={save}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
