import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import type { CartItemModifier } from "@/lib/website-cart";

export function PizzaCrustDialog({
  open, onClose, modifiers, onSelect,
}: {
  open: boolean;
  onClose: () => void;
  modifiers: CartItemModifier[];
  onSelect: (m: CartItemModifier) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Choose pizza base</DialogTitle>
          <DialogDescription>Thick or thin dough base.</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3 py-4">
          {modifiers.map((m) => (
            <button
              key={m.modifier_id}
              onClick={() => onSelect(m)}
              className="rounded-lg border border-border p-4 text-center font-medium hover:border-primary hover:bg-primary/10 transition"
            >
              {m.name}
            </button>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
