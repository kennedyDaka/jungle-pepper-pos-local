import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { ErrorState, LoadingState } from "@/components/DataState";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import { toast } from "sonner";
import { MWK, fmtQty } from "@/lib/format";
import {
  appendReportSheet,
  createReportWorkbook,
  writeReportWorkbook,
  type ReportRow,
} from "@/lib/xlsxReport";
import { expenseService } from "@/services/expenseService";
import { inventoryService } from "@/services/inventoryService";
import { Download, Plus, Trash2 } from "lucide-react";

export const Route = createFileRoute("/_app/expenses")({ component: ExpensesPage });

type StockLine = { item_id: string; qty: number; unit_cost: number };

function ExpensesPage() {
  const qc = useQueryClient();
  const today = new Date().toISOString().slice(0, 10);
  const monthStart = new Date();
  monthStart.setDate(1);
  const [from, setFrom] = useState(monthStart.toISOString().slice(0, 10));
  const [to, setTo] = useState(today);

  const [date, setDate] = useState(today);
  const [categoryId, setCategoryId] = useState("");
  const [amount, setAmount] = useState<number>(0);
  const [method, setMethod] = useState("cash");
  const [supplierId, setSupplierId] = useState<string>("none");
  const [description, setDescription] = useState("");
  const [stockLines, setStockLines] = useState<StockLine[]>([
    { item_id: "", qty: 0, unit_cost: 0 },
  ]);
  const [busy, setBusy] = useState(false);

  const cats = useQuery({
    queryKey: ["exp", "cats"],
    queryFn: async () => {
      return expenseService.listCategories();
    },
  });
  const suppliers = useQuery({
    queryKey: ["exp", "sup"],
    queryFn: async () => {
      return expenseService.listSuppliers();
    },
  });
  const items = useQuery({
    queryKey: ["exp", "items"],
    queryFn: async () => {
      return inventoryService.listItems();
    },
  });
  const list = useQuery({
    queryKey: ["exp", "list", from, to],
    queryFn: async () => {
      return expenseService.listExpenses(from, to);
    },
  });

  const selectedCategoryName = cats.data?.find((c: any) => c.id === categoryId)?.name ?? "";
  const isStockPurchase = selectedCategoryName === "Stock Purchase";

  const stockTotal = useMemo(
    () => stockLines.reduce((s, l) => s + (Number(l.qty) || 0) * (Number(l.unit_cost) || 0), 0),
    [stockLines],
  );

  const itemMap = useMemo(() => {
    const m = new Map<string, any>();
    items.data?.forEach((i: any) => m.set(i.id, i));
    return m;
  }, [items.data]);

  const submit = async () => {
    if (!categoryId) {
      toast.error("Pick a category");
      return;
    }
    setBusy(true);
    try {
      if (isStockPurchase) {
        const lines = stockLines
          .filter((l) => l.item_id && Number(l.qty) > 0 && Number(l.unit_cost) >= 0)
          .map((l) => ({
            item_id: l.item_id,
            qty: Number(l.qty),
            unit_cost: Number(l.unit_cost),
          }));
        if (!lines.length) {
          toast.error("Add at least one item line");
          return;
        }

        const isBackdated = date < today;
        const affectStock =
          !isBackdated ||
          window.confirm(
            "This stock purchase is backdated. Add the quantities to stock now? Choose Cancel to record the expense only.",
          );

        await expenseService.recordStockPurchase({
          lines,
          payment_method: method as any,
          expense_date: date,
          description,
          supplier_id: supplierId === "none" ? null : supplierId,
          affect_stock: affectStock,
        });
        toast.success(
          affectStock
            ? `Stock purchase recorded (${MWK(stockTotal)}) and inventory updated`
            : `Backdated stock purchase recorded (${MWK(stockTotal)}) without changing inventory`,
        );
        setStockLines([{ item_id: "", qty: 0, unit_cost: 0 }]);
        setDescription("");
        setSupplierId("none");
        qc.invalidateQueries({ queryKey: ["exp"] });
        qc.invalidateQueries({ queryKey: ["inv"] });
        return;
      }
      if (!amount) {
        toast.error("Amount required");
        return;
      }
      await expenseService.recordExpense({
        category_id: categoryId,
        amount,
        payment_method: method as any,
        description,
        supplier_id: supplierId === "none" ? null : supplierId,
        expense_date: date,
      });
      toast.success("Expense recorded");
      setAmount(0);
      setDescription("");
      setSupplierId("none");
      qc.invalidateQueries({ queryKey: ["exp"] });
    } catch (e: any) {
      toast.error(e.message ?? "Could not save expense");
    } finally {
      setBusy(false);
    }
  };
  const dataError = cats.error || suppliers.error || items.error || list.error;

  const total = (list.data ?? []).reduce((s, e: any) => s + Number(e.amount), 0);
  const byCategory = new Map<string, number>();
  (list.data ?? []).forEach((e: any) => {
    const c = e.expense_categories?.name ?? "-";
    byCategory.set(c, (byCategory.get(c) ?? 0) + Number(e.amount));
  });

  const expenseRows = (): ReportRow[] =>
    (list.data ?? []).map((e: any) => ({
      Ref: e.ref_no,
      Date: e.expense_date,
      Category: e.expense_categories?.name ?? "",
      Amount: Number(e.amount),
      Method: e.payment_method,
      Supplier: e.suppliers?.name ?? "",
      Description: e.description ?? "",
      "Stock Item Lines": e.expense_stock_lines?.length ?? 0,
      "Recorded At": new Date(e.created_at).toLocaleString(),
    }));

  const expenseLineRows = (): ReportRow[] => {
    const rows: ReportRow[] = [];
    (list.data ?? []).forEach((e: any) => {
      const lines = e.expense_stock_lines ?? [];
      if (!lines.length) {
        rows.push({
          Ref: e.ref_no,
          Date: e.expense_date,
          Category: e.expense_categories?.name ?? "",
          Supplier: e.suppliers?.name ?? "",
          Method: e.payment_method,
          Description: e.description ?? "",
          Item: "",
          Qty: "",
          Unit: "",
          "Unit Cost": "",
          "Line Total": Number(e.amount),
          "Affects Stock": "No",
          "Movement Type": "",
          "Qty Before": "",
          "Qty After": "",
        });
        return;
      }

      lines.forEach((line: any) => {
        rows.push({
          Ref: e.ref_no,
          Date: e.expense_date,
          Category: e.expense_categories?.name ?? "",
          Supplier: e.suppliers?.name ?? "",
          Method: e.payment_method,
          Description: e.description ?? "",
          Item: line.items?.name ?? "",
          Qty: Number(line.qty),
          Unit: line.items?.units?.code ?? "",
          "Unit Cost": Number(line.unit_cost),
          "Line Total": Number(line.line_total),
          "Affects Stock": line.stock_movement_id ? "Yes" : "No",
          "Movement Type": line.stock_movements?.type ?? "",
          "Qty Before": line.stock_movements?.qty_before ?? "",
          "Qty After": line.stock_movements?.qty_after ?? "",
        });
      });
    });
    return rows;
  };

  const exportXlsx = () => {
    const wb = createReportWorkbook("Jungle Pepper Expense Report");
    const lineRows = expenseLineRows();
    appendReportSheet(
      wb,
      "Summary",
      [
        { Metric: "Total expenses", Value: total },
        { Metric: "Records", Value: list.data?.length ?? 0 },
        { Metric: "Expense item lines", Value: lineRows.length },
        ...[...byCategory.entries()].map(([c, a]) => ({ Metric: `Category: ${c}`, Value: a })),
      ],
      { title: "Expense Summary", rangeLabel: `${from} to ${to}` },
    );
    appendReportSheet(wb, "Expenses", expenseRows(), {
      title: "Expense Record Detail",
      rangeLabel: `${from} to ${to}`,
    });
    appendReportSheet(wb, "Expense Item Lines", lineRows, {
      title: "Expense Item And Stock Detail",
      rangeLabel: `${from} to ${to}`,
    });
    writeReportWorkbook(wb, `expenses-${from}_to_${to}.xlsx`);
  };

  const updateLine = (idx: number, patch: Partial<StockLine>) =>
    setStockLines(stockLines.map((l, i) => (i === idx ? { ...l, ...patch } : l)));

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Expenses</h1>
      {(cats.isLoading || suppliers.isLoading || items.isLoading || list.isLoading) && (
        <LoadingState label="Loading live expenses..." />
      )}
      {dataError && <ErrorState error={dataError} label="Could not load expense data" />}

      <Card className="p-4 space-y-3">
        <h2 className="font-semibold">Record expense</h2>
        <div className="grid md:grid-cols-3 gap-3">
          <div>
            <Label>Date</Label>
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          <div>
            <Label>Category</Label>
            <Select value={categoryId} onValueChange={setCategoryId}>
              <SelectTrigger>
                <SelectValue placeholder="Select category" />
              </SelectTrigger>
              <SelectContent>
                {cats.data?.map((c: any) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {isStockPurchase && (
              <p className="text-xs text-muted-foreground mt-1">
                Current purchases restock inventory. Backdated purchases will ask before stock is
                changed.
              </p>
            )}
          </div>
          <div>
            <Label>Payment method</Label>
            <Select value={method} onValueChange={setMethod}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="cash">Cash</SelectItem>
                <SelectItem value="mpamba">Mpamba</SelectItem>
                <SelectItem value="airtel_money">Airtel Money</SelectItem>
                <SelectItem value="bank_card">Bank Card</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Supplier (optional)</Label>
            <Select value={supplierId} onValueChange={setSupplierId}>
              <SelectTrigger>
                <SelectValue placeholder="—" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">—</SelectItem>
                {suppliers.data?.map((s: any) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {!isStockPurchase && (
            <div>
              <Label>Amount (MWK)</Label>
              <Input
                type="number"
                step="1"
                value={amount}
                onChange={(e) => setAmount(Number(e.target.value))}
              />
            </div>
          )}
          <div className="md:col-span-3">
            <Label>Description</Label>
            <Textarea
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
        </div>

        {isStockPurchase && (
          <div className="space-y-2 pt-2 border-t border-border">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-sm">Items purchased</h3>
              <div className="text-sm">
                Total: <span className="font-bold">{MWK(stockTotal)}</span>
              </div>
            </div>
            {stockLines.map((l, idx) => {
              const it = itemMap.get(l.item_id);
              const lineTotal = (Number(l.qty) || 0) * (Number(l.unit_cost) || 0);
              return (
                <div
                  key={idx}
                  className="grid grid-cols-12 gap-2 items-end p-2 border border-border rounded-md"
                >
                  <div className="col-span-5">
                    <Label className="text-xs">Item</Label>
                    <Select
                      value={l.item_id}
                      onValueChange={(v) => {
                        const itm = itemMap.get(v);
                        updateLine(idx, {
                          item_id: v,
                          unit_cost: l.unit_cost || Number(itm?.avg_cost) || 0,
                        });
                      }}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select inventory item" />
                      </SelectTrigger>
                      <SelectContent className="max-h-72">
                        {items.data?.map((i: any) => (
                          <SelectItem key={i.id} value={i.id}>
                            {i.categories?.name ? `[${i.categories.name}] ` : ""}
                            {i.name} ({i.units?.code})
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="col-span-2">
                    <Label className="text-xs">Qty {it ? `(${it.units?.code})` : ""}</Label>
                    <Input
                      type="number"
                      step="0.001"
                      value={l.qty || ""}
                      onChange={(e) => updateLine(idx, { qty: Number(e.target.value) })}
                    />
                  </div>
                  <div className="col-span-2">
                    <Label className="text-xs">Unit cost</Label>
                    <Input
                      type="number"
                      step="0.01"
                      value={l.unit_cost || ""}
                      onChange={(e) => updateLine(idx, { unit_cost: Number(e.target.value) })}
                    />
                  </div>
                  <div className="col-span-2 text-right text-sm font-medium pb-2">
                    {MWK(lineTotal)}
                  </div>
                  <div className="col-span-1 text-right">
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={() => setStockLines(stockLines.filter((_, i) => i !== idx))}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              );
            })}
            <Button
              size="sm"
              variant="secondary"
              onClick={() => setStockLines([...stockLines, { item_id: "", qty: 0, unit_cost: 0 }])}
            >
              <Plus className="h-3 w-3 mr-1" />
              Add item
            </Button>
          </div>
        )}

        <Button onClick={submit} disabled={busy}>
          {isStockPurchase ? "Save purchase & restock" : "Save expense"}
        </Button>
      </Card>

      <Card className="p-3 flex flex-wrap gap-3 items-end">
        <div>
          <Label>From</Label>
          <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </div>
        <div>
          <Label>To</Label>
          <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </div>
        <div className="ml-auto flex gap-2 items-center">
          <div className="text-sm">
            <span className="text-muted-foreground">Total:</span>{" "}
            <span className="font-bold">{MWK(total)}</span>
          </div>
          <Button onClick={exportXlsx}>
            <Download className="h-4 w-4 mr-1" />
            Export Excel
          </Button>
        </div>
      </Card>

      <Card className="p-4">
        <h2 className="font-semibold mb-2">Expenses</h2>
        <div className="overflow-auto max-h-[600px]">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase text-muted-foreground border-b border-border">
                <th className="p-1.5">Ref</th>
                <th className="p-1.5">Date</th>
                <th className="p-1.5">Category</th>
                <th className="p-1.5">Supplier</th>
                <th className="p-1.5">Method</th>
                <th className="p-1.5">Item details</th>
                <th className="p-1.5">Description</th>
                <th className="p-1.5 text-right">Amount</th>
              </tr>
            </thead>
            <tbody>
              {list.data?.map((e: any) => {
                const detail =
                  e.expense_stock_lines
                    ?.map(
                      (line: any) =>
                        `${line.items?.name ?? "Item"} ${fmtQty(line.qty)} ${line.items?.units?.code ?? ""} @ ${MWK(line.unit_cost)}`,
                    )
                    .join(" | ") || "-";
                return (
                  <tr key={e.id} className="border-b border-border">
                    <td className="p-1.5 font-mono text-xs">{e.ref_no}</td>
                    <td className="p-1.5">{e.expense_date}</td>
                    <td className="p-1.5">{e.expense_categories?.name}</td>
                    <td className="p-1.5">{e.suppliers?.name ?? "-"}</td>
                    <td className="p-1.5 capitalize text-xs">
                      {e.payment_method.replace("_", " ")}
                    </td>
                    <td className="p-1.5 text-muted-foreground">{detail}</td>
                    <td className="p-1.5 text-muted-foreground">{e.description}</td>
                    <td className="p-1.5 text-right font-medium">{MWK(e.amount)}</td>
                  </tr>
                );
              })}
              {!list.data?.length && (
                <tr>
                  <td colSpan={8} className="p-4 text-center text-muted-foreground">
                    No expenses in this range
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
