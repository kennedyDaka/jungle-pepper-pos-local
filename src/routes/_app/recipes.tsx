import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
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
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { recipeService } from "@/services/recipeService";

export const Route = createFileRoute("/_app/recipes")({ component: RecipesPage });

function RecipesPage() {
  const qc = useQueryClient();
  const [selected, setSelected] = useState<string | null>(null);

  const menu = useQuery({
    queryKey: ["rec", "menu"],
    queryFn: async () => {
      return recipeService.listMenuItems();
    },
  });
  const items = useQuery({
    queryKey: ["rec", "items"],
    queryFn: async () => {
      return recipeService.listInventoryItems();
    },
  });
  const recipes = useQuery({
    queryKey: ["rec", "ing", selected],
    enabled: !!selected,
    queryFn: async () => {
      return recipeService.listRecipes(selected!);
    },
  });

  const [menuSearch, setMenuSearch] = useState("");
  const [newItem, setNewItem] = useState("");
  const [newQty, setNewQty] = useState(0);
  const [newTakeawayOnly, setNewTakeawayOnly] = useState(false);

  const add = async () => {
    if (!selected || !newItem || newQty <= 0) return;
    await recipeService.addRecipe({
      menu_item_id: selected,
      item_id: newItem,
      qty: newQty,
      takeaway_only: newTakeawayOnly,
    });
    setNewItem("");
    setNewQty(0);
    setNewTakeawayOnly(false);
    qc.invalidateQueries({ queryKey: ["rec", "ing"] });
  };
  const del = async (id: string) => {
    await recipeService.deleteRecipe(id);
    qc.invalidateQueries({ queryKey: ["rec", "ing"] });
  };
  const dataError = menu.error || items.error || recipes.error;

  return (
    <div className="grid md:grid-cols-3 gap-4">
      {(menu.isLoading || items.isLoading || recipes.isLoading) && (
        <LoadingState label="Loading live recipes..." />
      )}
      {dataError && <ErrorState error={dataError} label="Could not load recipes" />}
      <Card className="p-3 md:col-span-1 max-h-[80vh] overflow-auto">
        <h2 className="font-semibold mb-2">Menu items</h2>
        <Input
          placeholder="Search menu..."
          value={menuSearch}
          onChange={(e) => setMenuSearch(e.target.value)}
          className="mb-2"
        />
        <div className="space-y-1">
          {menu.data?.filter((m: any) => !menuSearch.trim() || m.name.toLowerCase().includes(menuSearch.toLowerCase()) || m.categories?.name?.toLowerCase().includes(menuSearch.toLowerCase())).map((m: any) => (
            <button
              key={m.id}
              onClick={() => setSelected(m.id)}
              className={`w-full text-left px-2 py-1.5 rounded text-sm ${selected === m.id ? "bg-primary text-primary-foreground" : "hover:bg-secondary"}`}
            >
              <div className="font-medium">{m.name}</div>
              <div className="text-xs opacity-70">{m.categories?.name}</div>
            </button>
          ))}
        </div>
      </Card>
      <Card className="p-4 md:col-span-2">
        <h2 className="font-semibold mb-3">{selected ? "Ingredients" : "Select a menu item"}</h2>
        {selected && (
          <>
            <table className="w-full text-sm mb-4">
              <thead>
                <tr className="text-left text-xs uppercase text-muted-foreground">
                  <th className="p-1">Item</th>
                  <th className="p-1 text-right">Qty</th>
                  <th className="p-1">Unit</th>
                  <th className="p-1">Takeaway</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {recipes.data?.map((r: any) => (
                  <tr key={r.id} className="border-t border-border">
                    <td className="p-2">{r.items?.name}</td>
                    <td className="p-2 text-right">{Number(r.qty)}</td>
                    <td className="p-2">{r.items?.units?.code}</td>
                    <td className="p-2 text-xs">{r.takeaway_only ? "Only" : "Always"}</td>
                    <td className="p-2 text-right">
                      <Button size="icon" variant="ghost" onClick={() => del(r.id)}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="flex gap-2 items-end border-t border-border pt-3">
              <div className="flex-1">
                <Select value={newItem} onValueChange={setNewItem}>
                  <SelectTrigger>
                    <SelectValue placeholder="Pick ingredient" />
                  </SelectTrigger>
                  <SelectContent className="max-h-72">
                    {items.data?.map((i: any) => (
                      <SelectItem key={i.id} value={i.id}>
                        {i.name} ({i.units?.code})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Input
                type="number"
                step="0.001"
                placeholder="Qty"
                className="w-32"
                value={newQty}
                onChange={(e) => setNewQty(Number(e.target.value))}
              />
              <div className="flex items-center gap-2 whitespace-nowrap pb-2">
                <Switch checked={newTakeawayOnly} onCheckedChange={setNewTakeawayOnly} />
                <Label className="text-xs">Takeaway only</Label>
              </div>
              <Button onClick={add}>
                <Plus className="h-4 w-4 mr-1" />
                Add
              </Button>
            </div>
          </>
        )}
      </Card>
    </div>
  );
}
