import { createFileRoute, notFound } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useWebsiteCart } from "@/lib/website-cart";
import { menuService, slugify } from "@/services/menuService";
import { BaseModifierDialog } from "@/components/website/BaseModifierDialog";
import { useState, useCallback } from "react";
import { Link } from "@tanstack/react-router";

const formatMK = (n: number) => `MK ${n.toLocaleString("en-US")}`;
type WebsiteMenuItem = Awaited<ReturnType<typeof menuService.listWebsiteMenuItems>>[number];

export const Route = createFileRoute("/website/menu/$slug")({
  head: ({ loaderData }) => ({
    meta: [
      {
        title: `${(loaderData as WebsiteMenuItem | undefined)?.name ?? "Menu Item"} - Jungle Pepper`,
      },
    ],
  }),
  loader: async ({ params: { slug }, context }) => {
    const items = await context.queryClient.ensureQueryData({
      queryKey: ["website-menu"],
      queryFn: () => menuService.listWebsiteMenuItems(),
    });
    const item = items.find((i) => slugify(i.name) === slug);
    if (!item) throw notFound();
    return item;
  },
  component: MenuItemPage,
  errorComponent: ({ error }) => (
    <div className="p-8 text-center">Item not found: {error.message}</div>
  ),
});

function MenuItemPage() {
  const item = Route.useLoaderData() as WebsiteMenuItem;
  const { data: allModifiers } = useQuery({
    queryKey: ["website-modifiers"],
    queryFn: () => menuService.listModifiers(),
  });
  const { add } = useWebsiteCart();
  const [modifierDialog, setModifierDialog] = useState<{
    item: any;
    modifiers: any[];
    kind: string;
  } | null>(null);

  const filterMods = useCallback(
    (mods: any[]) => {
      if (item.kind === "pizza")
        return mods.filter((m: any) => /^(thin|thick)\s*crust$/i.test(m.name));
      if (item.kind === "pasta")
        return mods.filter((m: any) => /^(spaghetti|penne)$/i.test(m.name));
      return mods;
    },
    [item.kind],
  );

  const itemModifiers = filterMods(
    (allModifiers ?? []).filter((m: any) => m.menu_item_id === item.id),
  );

  const handleAdd = () => {
    const crustMods = itemModifiers.filter((m: any) => /^(thin|thick)\s*crust$/i.test(m.name));
    if (item.kind === "pizza" || crustMods.length > 0) {
      setModifierDialog({ item, modifiers: crustMods.length > 0 ? crustMods : itemModifiers, kind: "base" });
      return;
    }
    if (item.kind === "pasta" && itemModifiers.length > 0) {
      setModifierDialog({ item, modifiers: itemModifiers, kind: item.kind });
      return;
    }
    add(
      {
        id: item.id,
        slug: item.slug,
        name: item.name,
        price_mwk: item.price,
        kind: item.kind,
      },
      1,
    );
  };

  return (
    <div className="mx-auto max-w-3xl px-3 py-8 sm:px-4 sm:py-12">
      <Link
        to="/website/menu"
        className="mb-4 inline-block text-sm text-muted-foreground hover:underline"
      >
        &larr; Back to menu
      </Link>
      <div className="overflow-hidden rounded-2xl border border-[color:var(--border)] bg-card shadow-[var(--shadow-card)]">
        <div className="aspect-[4/3] w-full bg-[color:var(--brand-ink)]/5">
          {item.image_url && (
            <img src={item.image_url} alt={item.name} className="h-full w-full object-cover" />
          )}
        </div>
        <div className="p-5 sm:p-8">
          <div className="flex flex-wrap items-center gap-2 text-xs uppercase tracking-wider">
            <span className="rounded-full bg-[color:var(--brand-yellow)]/40 px-2.5 py-0.5 font-semibold text-[color:var(--brand-red)]">
              {item.category_name ?? "Item"}
            </span>
            {item.spicy && (
              <span className="rounded-full bg-red-100 px-2.5 py-0.5 font-semibold text-red-700">
                Spicy
              </span>
            )}
            {item.vegetarian && (
              <span className="rounded-full bg-green-100 px-2.5 py-0.5 font-semibold text-green-700">
                Vegetarian
              </span>
            )}
            {item.featured && (
              <span className="rounded-full bg-amber-100 px-2.5 py-0.5 font-semibold text-amber-800">
                Featured
              </span>
            )}
          </div>
          <h1 className="mt-2 font-display text-3xl sm:text-5xl">{item.name}</h1>
          <p className="mt-2 text-lg text-muted-foreground">{item.description}</p>
          <div className="mt-6 flex items-center gap-4">
            <span className="font-display text-3xl text-[color:var(--brand-red)]">
              {formatMK(item.price)}
            </span>
            <button
              type="button"
              onClick={handleAdd}
              className="rounded-full bg-[color:var(--brand-red)] px-6 py-2.5 text-sm font-semibold text-white active:scale-[0.98] sm:px-8 sm:py-3 sm:text-base"
            >
              Add to Order
            </button>
          </div>
        </div>
      </div>

      <BaseModifierDialog
        open={modifierDialog !== null}
        title={
          modifierDialog?.kind === "pizza" || modifierDialog?.kind === "base"
            ? "Choose dough base"
            : "Choose pasta shape"
        }
        description={
          modifierDialog?.kind === "pizza" || modifierDialog?.kind === "base"
            ? "Thick or thin dough base."
            : `Select the pasta type for ${modifierDialog?.item?.name ?? ""}.`
        }
        modifiers={
          modifierDialog?.modifiers?.map((m: any) => ({
            modifier_id: m.id,
            name: m.name,
            price_delta: Number(m.price_delta),
          })) ?? []
        }
        onSelect={(mod) => {
          const d = modifierDialog!;
          const label =
            d.kind === "pizza" || d.kind === "base"
              ? `${d.item.name} (${mod.name})`
              : `${mod.name} ${d.item.name}`;
          add(
            {
              id: d.item.id,
              slug: d.item.slug,
              name: label,
              price_mwk: d.item.price,
              kind: d.item.kind,
              modifiers: [mod],
            },
            1,
          );
          setModifierDialog(null);
        }}
        onClose={() => setModifierDialog(null)}
      />
    </div>
  );
}
