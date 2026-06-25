import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useSuspenseQuery } from "@tanstack/react-query";
import { useWebsiteCart } from "@/lib/website-cart";
import { menuService } from "@/services/menuService";
import { BaseModifierDialog } from "@/components/website/BaseModifierDialog";
import { useState, useMemo, useCallback } from "react";

const formatMK = (n: number) => `MK ${n.toLocaleString("en-US")}`;

export const Route = createFileRoute("/website/menu")({
  head: () => ({
    meta: [
      { title: "Menu — Jungle Pepper" },
      {
        name: "description",
        content:
          "Full menu: Portuguese starters, salads, wood-fired pizza, burgers, pasta, prego, frango, prawns, drinks & more.",
      },
    ],
  }),
  loader: ({ context }) =>
    context.queryClient.ensureQueryData({
      queryKey: ["website-menu"],
      queryFn: () => menuService.listWebsiteMenuItems(),
    }),
  component: MenuPage,
  errorComponent: ({ error }) => (
    <div className="p-8 text-center">Couldn't load menu: {error.message}</div>
  ),
});

function MenuPage() {
  const { data: items } = useSuspenseQuery({
    queryKey: ["website-menu"],
    queryFn: () => menuService.listWebsiteMenuItems(),
  });

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

  const filterMods = useCallback((item: any, mods: any[]) => {
    if (item.kind === "pizza")
      return mods.filter((m: any) => /^(thin|thick)\s*crust$/i.test(m.name));
    if (item.kind === "pasta")
      return mods.filter((m: any) => /^(spaghetti|penne|fettucine)$/i.test(m.name));
    return mods;
  }, []);

  const categories = useMemo(() => {
    const seen = new Set<string>();
    return items
      .filter((i) => {
        const name = i.category_name ?? "Other";
        if (seen.has(name)) return false;
        seen.add(name);
        return true;
      })
      .map((i) => ({
        slug: i.category_id,
        name: i.category_name ?? "Other",
      }));
  }, [items]);

  const byCat = (catId: string) => items.filter((i) => i.category_id === catId);

  const handleAdd = (item: any) => {
    if (item.kind === "pizza" || item.kind === "pasta") {
      const mods = filterMods(
        item,
        (allModifiers ?? []).filter((m: any) => m.menu_item_id === item.id),
      );
      if (mods.length > 0) {
        setModifierDialog({ item, modifiers: mods, kind: item.kind });
        return;
      }
    }
    add(
      { id: item.id, slug: item.slug, name: item.name, price_mwk: item.price, kind: item.kind },
      1,
    );
  };

  return (
    <div>
      <section className="bg-[color:var(--brand-red)] py-8 text-center text-[color:var(--brand-paper)] sm:py-12">
        <p className="font-script text-xl text-[color:var(--brand-yellow)] sm:text-3xl">
          Welcome to
        </p>
        <h1 className="font-display text-4xl leading-none tracking-wide sm:text-6xl md:text-7xl">
          JUNGLE PEPPER
        </h1>
        <p className="mt-2 text-[10px] uppercase tracking-[0.25em] opacity-90 sm:text-sm sm:tracking-[0.3em]">
          Malawi's Own Pizza · Portuguese Cuisine
        </p>
      </section>

      <nav className="sticky top-[57px] z-30 border-y border-[color:var(--border)] bg-[color:var(--brand-paper)]/95 backdrop-blur sm:top-[68px]">
        <div className="mx-auto flex max-w-6xl gap-2 overflow-x-auto px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wider scrollbar-thin sm:text-xs">
          {categories.map((c) => (
            <a
              key={c.slug}
              href={`#cat-${c.slug}`}
              className="whitespace-nowrap rounded-full border border-[color:var(--brand-red)]/30 px-3 py-1.5 active:bg-[color:var(--brand-red)] active:text-white hover:bg-[color:var(--brand-red)] hover:text-white"
            >
              {c.name}
            </a>
          ))}
        </div>
      </nav>

      <div className="mx-auto max-w-3xl px-3 py-8 sm:px-4 sm:py-12">
        {categories.map((cat) => {
          const list = byCat(cat.slug);
          if (!list.length) return null;
          return (
            <section key={cat.slug} id={`cat-${cat.slug}`} className="scroll-mt-36 mb-10 sm:mb-14">
              <div className="mb-4 text-center sm:mb-6">
                <h2 className="font-display text-2xl text-[color:var(--brand-red)] sm:text-4xl md:text-5xl">
                  {cat.name.toUpperCase()}
                </h2>
                <div className="mx-auto mt-1.5 h-1 w-12 rounded-full bg-[color:var(--brand-yellow)] sm:w-16" />
              </div>
              <ul>
                {list.map((item) => (
                  <MenuRow key={item.id} item={item} onAdd={() => handleAdd(item)} />
                ))}
              </ul>
            </section>
          );
        })}

        <p className="mt-10 text-center text-[11px] italic text-muted-foreground">
          Some items subject to availability. Prices in Malawi Kwacha (MK).
        </p>
      </div>

      <BaseModifierDialog
        open={modifierDialog !== null}
        title={modifierDialog?.kind === "pizza" ? "Choose pizza base" : "Choose pasta shape"}
        description={
          modifierDialog?.kind === "pizza"
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
            d.kind === "pizza" ? `${d.item.name} (${mod.name})` : `${mod.name} ${d.item.name}`;
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

function MenuRow({ item, onAdd }: { item: any; onAdd: () => void }) {
  return (
    <li>
      <button
        type="button"
        onClick={onAdd}
        className="menu-line w-full text-left"
        aria-label={`Add ${item.name} to order`}
      >
        <span className="min-w-0 text-left">
          <span className="font-display text-base uppercase leading-tight tracking-wide sm:text-lg">
            {item.name}
          </span>
          {item.description && (
            <span className="mt-0.5 block text-xs text-muted-foreground sm:text-sm">
              {item.description}
            </span>
          )}
        </span>
        <span className="font-display text-base text-[color:var(--brand-red)] whitespace-nowrap sm:text-lg">
          {formatMK(item.price)}
        </span>
      </button>
    </li>
  );
}
