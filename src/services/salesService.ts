import { posService, type FinalizeOrderPayload } from "@/services/posService";
import { reportService } from "@/services/reportService";

export type { FinalizeOrderPayload };

export const salesService = {
  finalizeOrder: posService.finalizeOrder,
  listSales: reportService.listSales,
};
