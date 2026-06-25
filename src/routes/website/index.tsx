import { createFileRoute, Link } from "@tanstack/react-router";
import { IMAGES } from "@/lib/website-images";

export const Route = createFileRoute("/website/")({
  head: () => ({
    meta: [
      { title: "Jungle Pepper — Authentic Portuguese Cuisine in Blantyre" },
      {
        name: "description",
        content:
          "Wood-fired pizza, Portuguese braai chicken, prego rolls, prawns and more in Blantyre. Dine in, take away or order on WhatsApp.",
      },
    ],
  }),
  component: WebsiteHome,
});

function WebsiteHome() {
  return (
    <div>
      <section className="relative overflow-hidden bg-[color:var(--brand-ink)] text-[color:var(--brand-paper)]">
        <img
          src={IMAGES.hero}
          alt=""
          aria-hidden
          className="absolute inset-0 h-full w-full object-cover opacity-50 sm:opacity-60"
        />
        <div className="absolute inset-0 bg-gradient-to-b from-[color:var(--brand-ink)]/70 via-[color:var(--brand-ink)]/85 to-[color:var(--brand-ink)] sm:bg-gradient-to-r sm:from-[color:var(--brand-ink)] sm:via-[color:var(--brand-ink)]/80 sm:to-transparent" />
        <div className="relative mx-auto grid max-w-6xl gap-6 px-4 py-16 sm:py-24 md:py-32 md:grid-cols-2">
          <div>
            <p className="font-script text-2xl text-[color:var(--brand-yellow)] sm:text-3xl">
              Try Our
            </p>
            <h1 className="mt-1 font-display text-4xl leading-[0.95] sm:text-6xl md:text-7xl">
              AUTHENTIC
              <br />
              PORTUGUESE
              <br />
              <span className="text-[color:var(--brand-yellow)]">CUISINE</span>
            </h1>
            <p className="mt-4 max-w-md text-base opacity-90 sm:mt-6 sm:text-lg">
              Wood-fired pizza, peri-peri chicken, prego rolls and prawns — served jungle style in
              Blantyre.
            </p>
            <div className="mt-6 grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:gap-3">
              <Link
                to="/website/menu"
                className="rounded-full bg-[color:var(--brand-yellow)] px-5 py-3 text-center text-sm font-bold uppercase tracking-wider text-[color:var(--brand-ink)] active:scale-[0.98] sm:text-base sm:normal-case sm:tracking-normal"
              >
                Order Now
              </Link>
              <Link
                to="/website/reservations"
                className="rounded-full border-2 border-[color:var(--brand-paper)] px-5 py-3 text-center text-sm font-bold uppercase tracking-wider active:scale-[0.98] sm:text-base sm:normal-case sm:tracking-normal"
              >
                Reserve
              </Link>
            </div>
            <p className="mt-6 text-xs opacity-80 sm:text-sm">
              Wed – Sun · 11:30 – 21:00 · Mon & Tue Closed
            </p>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 py-10 sm:py-16">
        <div className="text-center">
          <p className="font-script text-xl text-[color:var(--brand-red)] sm:text-2xl">
            Crowd favourites
          </p>
          <h2 className="font-display text-3xl sm:text-4xl md:text-5xl">SIGNATURE DISHES</h2>
        </div>
        <div className="mt-6 grid gap-4 sm:mt-10 sm:gap-6 md:grid-cols-3">
          {[
            {
              img: IMAGES.burger,
              name: "Jungle Burger",
              to: "/website/menu/$slug" as const,
              params: { slug: "jungle-pepper-burger" },
              desc: "Cheese, coleslaw, onion & our signature Jungle Pepper sauce.",
            },
            {
              img: IMAGES.bitoque,
              name: "Portuguese Bitoque",
              to: "/website/menu/$slug" as const,
              params: { slug: "beef-bitoque" },
              desc: "Steak crowned with a fried egg, served with chips & tomato rice.",
            },
            {
              img: IMAGES.frango,
              name: "Frango no Churrasco",
              to: "/website/menu/$slug" as const,
              params: { slug: "half-churrasco-chicken" },
              desc: "Famous piri-piri grilled chicken on crispy fries & flavorful rice.",
            },
          ].map((d) => (
            <Link
              key={d.name}
              to={d.to}
              params={d.params}
              className="group overflow-hidden rounded-2xl bg-card shadow-[var(--shadow-card)] transition-transform hover:-translate-y-1"
            >
              <div className="aspect-[4/3] overflow-hidden">
                <img
                  src={d.img}
                  alt={d.name}
                  className="h-full w-full object-cover transition-transform group-hover:scale-105"
                />
              </div>
              <div className="p-4 sm:p-5">
                <h3 className="font-display text-xl sm:text-2xl">{d.name}</h3>
                <p className="mt-1 text-sm text-muted-foreground">{d.desc}</p>
              </div>
            </Link>
          ))}
        </div>
      </section>

      <section className="bg-[color:var(--brand-yellow)]/30">
        <div className="mx-auto grid max-w-6xl items-center gap-6 px-4 py-10 sm:gap-10 sm:py-16 md:grid-cols-2">
          <img
            src={IMAGES.interior}
            alt="Jungle Pepper outdoor seating"
            className="aspect-[4/3] w-full rounded-2xl object-cover shadow-[var(--shadow-card)]"
          />
          <div>
            <p className="font-script text-xl text-[color:var(--brand-red)] sm:text-2xl">
              Our story
            </p>
            <h2 className="font-display text-3xl sm:text-4xl md:text-5xl">
              BOLD FLAVOUR. JUNGLE STYLE.
            </h2>
            <p className="mt-3 text-base sm:text-lg">
              From wood-fired Portuguese pizza to slow-marinated peri-peri chicken, Jungle Pepper
              brings Lisbon-meets-Blantyre to your table. Come sit under the lanterns on Kidney
              Crescent and taste why we're Malawi's own.
            </p>
            <Link
              to="/website/about"
              className="mt-5 inline-block rounded-full bg-[color:var(--brand-red)] px-5 py-2.5 text-sm font-semibold text-white sm:px-6 sm:py-3"
            >
              Read more
            </Link>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 py-10 sm:py-16">
        <div className="text-center">
          <p className="font-script text-xl text-[color:var(--brand-red)] sm:text-2xl">
            From the kitchen
          </p>
          <h2 className="font-display text-3xl sm:text-4xl">A TASTE OF JUNGLE PEPPER</h2>
        </div>
        <div className="mt-6 grid grid-cols-2 gap-2 sm:mt-8 sm:gap-4 md:grid-cols-4">
          {[IMAGES.prawns, IMAGES.frango, IMAGES.bitoque, IMAGES.burger].map((src) => (
            <img
              key={src}
              src={src}
              alt=""
              className="aspect-square w-full rounded-xl object-cover"
            />
          ))}
        </div>
      </section>

      <section className="bg-[color:var(--brand-red)] text-white">
        <div className="mx-auto flex max-w-6xl flex-col items-center gap-4 px-4 py-10 text-center sm:py-12">
          <img src={IMAGES.logo} alt="" className="h-14 w-14 sm:h-16 sm:w-16" />
          <h2 className="font-display text-2xl sm:text-3xl md:text-4xl">
            HUNGRY? ORDER NOW OR RESERVE A TABLE.
          </h2>
          <div className="grid w-full max-w-sm grid-cols-2 gap-2 sm:flex sm:w-auto sm:gap-3">
            <Link
              to="/website/menu"
              className="rounded-full bg-[color:var(--brand-yellow)] px-5 py-3 text-sm font-bold uppercase text-[color:var(--brand-ink)]"
            >
              Order
            </Link>
            <Link
              to="/website/reservations"
              className="rounded-full border-2 border-white px-5 py-3 text-sm font-bold uppercase"
            >
              Reserve
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
