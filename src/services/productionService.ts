import { inventoryService } from "@/services/inventoryService";
import { supabase } from "@/services/repositories/supabaseClient";
import { raiseIfError } from "@/services/repositories/supabaseErrors";
import type { ProductionBatchView, Unit } from "@/types/domain";
import type { Database, Json } from "@/types/database";

export interface ProductionPayload {
  inputs: Array<{
    item_id: string;
    qty: number;
    qty_count?: number | null;
    weight_kg?: number | null;
    cook_kg?: number | null;
  }>;
  outputs: Array<{
    item_id: string;
    qty: number;
    qty_count?: number | null;
    weight_kg?: number | null;
    cook_kg?: number | null;
  }>;
  wastage: Array<{ item_id: string; qty: number; reason: string }>;
  note?: string;
}

type ProductionLineWithRelations = Database["public"]["Tables"]["production_inputs"]["Row"] & {
  items?: {
    name: string;
    units?: Pick<Unit, "code"> | null;
  } | null;
};

type ProductionWaste = Database["public"]["Tables"]["production_wastage"]["Row"];

type BatchWithRelations = Database["public"]["Tables"]["production_batches"]["Row"] & {
  production_inputs?: ProductionLineWithRelations[];
  production_outputs?: ProductionLineWithRelations[];
  production_wastage?: ProductionWaste[];
};

function toLine(line: ProductionLineWithRelations) {
  return {
    id: line.id,
    batch_id: line.batch_id,
    item_id: line.item_id,
    qty: Number(line.qty),
    qty_count: line.qty_count === null ? null : Number(line.qty_count),
    weight_kg: line.weight_kg === null ? null : Number(line.weight_kg),
    unit_cost: line.unit_cost === null ? null : Number(line.unit_cost),
    items: line.items
      ? {
          name: line.items.name,
          units: line.items.units ? { code: line.items.units.code } : undefined,
        }
      : undefined,
  };
}

function toBatch(batch: BatchWithRelations): ProductionBatchView {
  return {
    id: batch.id,
    created_at: batch.created_at,
    note: batch.note,
    production_inputs: (batch.production_inputs ?? []).map(toLine),
    production_outputs: (batch.production_outputs ?? []).map(toLine),
    production_wastage: (batch.production_wastage ?? []).map((line) => ({
      id: line.id,
      batch_id: line.batch_id,
      item_id: line.item_id,
      qty: Number(line.qty),
      reason: line.reason,
    })),
  };
}

export const productionService = {
  async listItems() {
    return inventoryService.listItems({ activeOnly: true });
  },

  async listBatches() {
    const { data, error } = await supabase
      .from("production_batches")
      .select(
        "*, production_inputs(*, items(name, units(code))), production_outputs(*, items(name, units(code))), production_wastage(*)",
      )
      .order("created_at", { ascending: false })
      .limit(20);

    raiseIfError(error, "Could not load production batches");
    return ((data ?? []) as BatchWithRelations[]).map(toBatch);
  },

  async applyProduction(payload: ProductionPayload) {
    const { error } = await supabase.rpc("apply_production", {
      _payload: payload as unknown as Json,
    });

    raiseIfError(error, "Could not save production batch");
  },
};
