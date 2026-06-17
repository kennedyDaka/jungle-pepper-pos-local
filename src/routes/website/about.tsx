import { createFileRoute } from "@tanstack/react-router";
import { IMAGES } from "@/lib/website-images";

export const Route = createFileRoute("/website/about")({
  head: () => ({
    meta: [
      { title: "About — Jungle Pepper" },
      { name: "description", content: "The story of Jungle Pepper: Malawi's own pizza and authentic Portuguese cuisine in Blantyre." },
    ],
  }),
  component: AboutPage,
});

function AboutPage() {
  return (
    <div>
      <section className="bg-[color:var(--brand-ink)]/5 py-10 sm:py-16">
        <div className="mx-auto max-w-3xl px-4 text-center">
          <p className="font-script text-xl text-[color:var(--brand-red)] sm:text-3xl">Our story</p>
          <h1 className="font-display text-4xl leading-none sm:text-6xl md:text-7xl">ABOUT US</h1>
        </div>
      </section>

      <section className="mx-auto grid max-w-6xl items-center gap-8 px-4 py-10 sm:gap-12 sm:py-16 md:grid-cols-2">
        <img src={IMAGES.interior} alt="Jungle Pepper interior" className="aspect-[4/3] w-full rounded-2xl object-cover shadow-[var(--shadow-card)]" />
        <div>
          <p className="font-script text-lg text-[color:var(--brand-red)] sm:text-2xl">Welcome to Jungle Pepper</p>
          <h2 className="font-display text-2xl sm:text-4xl">MALAWI'S OWN PIZZA & AUTHENTIC PORTUGUESE CUISINE</h2>
          <p className="mt-3 text-sm leading-relaxed sm:text-base">
            Nestled on Kidney Crescent Road in Blantyre, Jungle Pepper brings together the best of Portuguese culinary
            tradition with a bold Malawian spirit. From our wood-fired pizzas to our signature peri-peri chicken,
            every dish is crafted with care and passion.
          </p>
          <p className="mt-3 text-sm leading-relaxed sm:text-base">
            Whether you're dining under the lanterns on our outdoor patio, grabbing takeaway, or ordering online,
            we promise an unforgettable experience.
          </p>
          <p className="mt-8 font-display text-xl text-[color:var(--brand-red)] sm:text-2xl">Wed – Sun · 11:30 – 21:00</p>
        </div>
      </section>
    </div>
  );
}
