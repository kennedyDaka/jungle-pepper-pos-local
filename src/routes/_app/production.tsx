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
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { fmtDate, fmtQty } from "@/lib/format";
import { productionService } from "@/services/productionService";

export const Route = createFileRoute("/_app/production")({
  component: ProductionPage,
});

type Line = { item_id: string; qty_count: number; weight_kg: number };
type Waste = { item_id: string; qty: number; reason: string };

const blankLine = (): Line => ({ item_id: "", qty_count: 0, weight_kg: 0 });

function ProductionPage() {
  const qc = useQueryClient();
  const [inputs, setInputs] = useState<Line[]>([blankLine()]);
  const [outputs, setOutputs] = useState<Line[]>([blankLine()]);
  const [wastage, setWastage] = useState<Waste[]>([]);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  const items = useQuery({
    queryKey: ["prod", "items"],
    queryFn: async () => {
      return productionService.listItems();
    },
  });
  const batches = useQuery({
    queryKey: ["prod", "batches"],
    queryFn: async () => {
      return productionService.listBatches();
    },
  });

  const itemMap = new Map<string, any>();
  items.data?.forEach((i: any) => itemMap.set(i.id, i));
  const unitOf = (id: string) => itemMap.get(id)?.units?.code ?? "";

  // Effective qty used by stock + cost = weight if unit is kg/g, else count
  const effectiveQty = (l: Line) => {
    const u = unitOf(l.item_id);
    if (u === "kg") return Number(l.weight_kg) || 0;
    if (u === "g") return (Number(l.weight_kg) || 0) * 1000;
    return Number(l.qty_count) || 0;
  };

  const submit = async () => {
    const buildPayload = (lines: Line[]) =>
      lines
        .filter((l) => l.item_id && (Number(l.qty_count) > 0 || Number(l.weight_kg) > 0))
        .map((l) => ({
          item_id: l.item_id,
          qty: effectiveQty(l),
          qty_count: Number(l.qty_count) || null,
          weight_kg: Number(l.weight_kg) || null,
        }));
    const cleanIn = buildPayload(inputs);
    const cleanOut = buildPayload(outputs);
    if (!cleanIn.length || !cleanOut.length) {
      toast.error("Add at least one input and output");
      return;
    }
    const cleanWastage = wastage
      .filter((line) => line.item_id && Number(line.qty) > 0)
      .map((line) => ({
        item_id: line.item_id,
        qty: Number(line.qty),
        reason: line.reason.trim() || "Production wastage",
      }));
    setBusy(true);
    await productionService.applyProduction({
      inputs: cleanIn,
      outputs: cleanOut,
      wastage: cleanWastage,
      note,
    });
    setBusy(false);
    toast.success("Production batch saved");
    setInputs([blankLine()]);
    setOutputs([blankLine()]);
    setWastage([]);
    setNote("");
    qc.invalidateQueries({ queryKey: ["prod"] });
    qc.invalidateQueries({ queryKey: ["inv"] });
  };

  const ItemSelect = ({ value, onChange }: { value: string; onChange: (v: string) => void }) => (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger>
        <SelectValue placeholder="Select item" />
      </SelectTrigger>
      <SelectContent className="max-h-72">
        {items.data?.map((i: any) => (
          <SelectItem key={i.id} value={i.id}>
            {i.name} ({i.units?.code})
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
  const dataError = items.error || batches.error;

  const LineRow = ({
    l,
    idx,
    lines,
    setLines,
  }: {
    l: Line;
    idx: number;
    lines: Line[];
    setLines: (x: Line[]) => void;
  }) => {
    const u = unitOf(l.item_id);
    const eff = effectiveQty(l);
    return (
      <div className="space-y-1 p-2 border border-border rounded-md">
        <div className="flex gap-2 items-center">
          <div className="flex-1">
            <ItemSelect
              value={l.item_id}
              onChange={(v) =>
                setLines(lines.map((x, i) => (i === idx ? { ...x, item_id: v } : x)))
              }
            />
          </div>
          <Button
            size="icon"
            variant="ghost"
            onClick={() => setLines(lines.filter((_, i) => i !== idx))}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <Label className="text-xs">Quantity (pieces / pkts)</Label>
            <Input
              type="number"
              step="0.001"
              value={l.qty_count || ""}
              placeholder="0"
              onChange={(e) =>
                setLines(
                  lines.map((x, i) =>
                    i === idx ? { ...x, qty_count: Number(e.target.value) } : x,
                  ),
                )
              }
            />
          </div>
          <div>
            <Label className="text-xs">Weight (kg)</Label>
            <Input
              type="number"
              step="0.001"
              value={l.weight_kg || ""}
              placeholder="0.000"
              onChange={(e) =>
                setLines(
                  lines.map((x, i) =>
                    i === idx ? { ...x, weight_kg: Number(e.target.value) } : x,
                  ),
                )
              }
            />
          </div>
        </div>
        {l.item_id && (
          <div className="text-xs text-muted-foreground">
            Stock will move by{" "}
            <span className="font-medium text-foreground">
              {fmtQty(eff)} {u}
            </span>
            {u === "kg" || u === "g" ? " (using weight)" : " (using quantity)"}
          </div>
        )}
      </div>
    );
  };

  const Section = ({
    title,
    lines,
    setLines,
    hint,
  }: {
    title: string;
    lines: Line[];
    setLines: (x: Line[]) => void;
    hint?: string;
  }) => (
    <div className="space-y-2">
      <h3 className="font-semibold">{title}</h3>
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      {lines.map((l, idx) => (
        <LineRow key={idx} l={l} idx={idx} lines={lines} setLines={setLines} />
      ))}
      <Button size="sm" variant="secondary" onClick={() => setLines([...lines, blankLine()])}>
        <Plus className="h-3 w-3 mr-1" />
        Add line
      </Button>
    </div>
  );

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Production</h1>
      {(items.isLoading || batches.isLoading) && (
        <LoadingState label="Loading live production data..." />
      )}
      {dataError && <ErrorState error={dataError} label="Could not load production data" />}
      <Card className="p-4 space-y-4">
        <h2 className="font-semibold">New batch</h2>
        <p className="text-xs text-muted-foreground">
          Enter both quantity and weight where applicable. Items measured in kg/g will deduct/credit
          by weight; counted items by quantity. E.g. 2 trays Fillet, 4.000 kg → 10 burger pkts + 10
          pizza pkts.
        </p>
        <div className="grid md:grid-cols-2 gap-4">
          <Section title="Inputs (raw consumed)" lines={inputs} setLines={setInputs} />
          <Section
            title="Outputs (portions produced)"
            lines={outputs}
            setLines={setOutputs}
            hint="Cost auto-rolled from inputs"
          />
        </div>
        <div>
          <h3 className="font-semibold mb-1">Wastage (optional)</h3>
          {wastage.map((w, idx) => (
            <div key={idx} className="flex gap-2 items-center mb-1">
              <div className="flex-1">
                <Select
                  value={w.item_id}
                  onValueChange={(v) =>
                    setWastage(wastage.map((x, i) => (i === idx ? { ...x, item_id: v } : x)))
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Item" />
                  </SelectTrigger>
                  <SelectContent>
                    {items.data?.map((i: any) => (
                      <SelectItem key={i.id} value={i.id}>
                        {i.name} ({i.units?.code})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Input
                className="w-28"
                type="number"
                step="0.001"
                placeholder="Qty"
                value={w.qty}
                onChange={(e) =>
                  setWastage(
                    wastage.map((x, i) => (i === idx ? { ...x, qty: Number(e.target.value) } : x)),
                  )
                }
              />
              <Input
                className="flex-1"
                placeholder="Reason"
                value={w.reason}
                onChange={(e) =>
                  setWastage(
                    wastage.map((x, i) => (i === idx ? { ...x, reason: e.target.value } : x)),
                  )
                }
              />
              <Button
                size="icon"
                variant="ghost"
                onClick={() => setWastage(wastage.filter((_, i) => i !== idx))}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          ))}
          <Button
            size="sm"
            variant="secondary"
            onClick={() => setWastage([...wastage, { item_id: "", qty: 0, reason: "" }])}
          >
            <Plus className="h-3 w-3 mr-1" />
            Add wastage
          </Button>
        </div>
        <div>
          <Label>Note</Label>
          <Input value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
        <Button onClick={submit} disabled={busy}>
          Save batch
        </Button>
      </Card>

      <Card className="p-4">
        <h2 className="font-semibold mb-3">Recent batches</h2>
        <div className="space-y-3 text-sm">
          {batches.data?.map((b: any) => (
            <div key={b.id} className="border border-border rounded p-3">
              <div className="flex justify-between text-xs text-muted-foreground mb-1">
                <span>{fmtDate(b.created_at)}</span>
                <span>{b.note}</span>
              </div>
              <div className="grid md:grid-cols-2 gap-3">
                <div>
                  <div className="font-medium text-xs uppercase text-muted-foreground">Inputs</div>
                  {b.production_inputs.map((x: any, i: number) => (
                    <div key={i}>
                      − {x.items?.name}: {x.qty_count ? `${fmtQty(x.qty_count)} qty` : ""}
                      {x.qty_count && x.weight_kg ? " · " : ""}
                      {x.weight_kg ? `${fmtQty(x.weight_kg)} kg` : ""}
                      {!x.qty_count && !x.weight_kg
                        ? `${fmtQty(x.qty)} ${x.items?.units?.code ?? ""}`
                        : ""}
                    </div>
                  ))}
                </div>
                <div>
                  <div className="font-medium text-xs uppercase text-muted-foreground">Outputs</div>
                  {b.production_outputs.map((x: any, i: number) => (
                    <div key={i}>
                      + {x.items?.name}: {x.qty_count ? `${fmtQty(x.qty_count)} qty` : ""}
                      {x.qty_count && x.weight_kg ? " · " : ""}
                      {x.weight_kg ? `${fmtQty(x.weight_kg)} kg` : ""}
                      {!x.qty_count && !x.weight_kg
                        ? `${fmtQty(x.qty)} ${x.items?.units?.code ?? ""}`
                        : ""}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
