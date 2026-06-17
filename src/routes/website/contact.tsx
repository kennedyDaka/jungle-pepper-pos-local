import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/website/contact")({
  head: () => ({
    meta: [
      { title: "Contact — Jungle Pepper" },
      { name: "description", content: "Get in touch with Jungle Pepper in Blantyre, Malawi. Call or visit us on Kidney Crescent Road." },
    ],
  }),
  component: ContactPage,
});

function ContactPage() {
  return (
    <div>
      <section className="bg-[color:var(--brand-ink)]/5 py-10 sm:py-16">
        <div className="mx-auto max-w-3xl px-4 text-center">
          <p className="font-script text-xl text-[color:var(--brand-red)] sm:text-3xl">Get in touch</p>
          <h1 className="font-display text-4xl leading-none sm:text-6xl md:text-7xl">CONTACT</h1>
        </div>
      </section>

      <section className="mx-auto grid max-w-4xl gap-8 px-4 py-10 sm:gap-12 sm:py-16 md:grid-cols-2">
        <div className="space-y-6 text-sm sm:text-base">
          <div>
            <h2 className="font-display text-xl text-[color:var(--brand-red)] sm:text-2xl">Location</h2>
            <p className="mt-1 leading-relaxed text-muted-foreground">
              Kidney Crescent Road,<br />
              Opposite O. Jussabs, Next to OMG.<br />
              Blantyre, Malawi.
            </p>
          </div>
          <div>
            <h2 className="font-display text-xl text-[color:var(--brand-red)] sm:text-2xl">Hours</h2>
            <p className="mt-1 leading-relaxed text-muted-foreground">
              Wednesday – Sunday: 11:30 – 21:00<br />
              Monday & Tuesday: Closed
            </p>
          </div>
          <div>
            <h2 className="font-display text-xl text-[color:var(--brand-red)] sm:text-2xl">Call us</h2>
            <p className="mt-1">
              <a href="tel:+265999826229" className="text-lg font-semibold hover:underline">0999 826 229</a>
            </p>
            <p>
              <a href="tel:+265888826229" className="text-lg font-semibold hover:underline">0888 826 229</a>
            </p>
          </div>
          <div>
            <h2 className="font-display text-xl text-[color:var(--brand-red)] sm:text-2xl">Social</h2>
            <p className="mt-1">
              <a href="https://wa.me/265999826229" target="_blank" rel="noreferrer" className="font-semibold hover:underline">WhatsApp</a>
              {" · "}
              <a href="https://facebook.com/junglepeppermw" target="_blank" rel="noreferrer" className="font-semibold hover:underline">Facebook</a>
              {" · "}
              <a href="https://instagram.com/jungle_pepper_mw" target="_blank" rel="noreferrer" className="font-semibold hover:underline">Instagram</a>
            </p>
          </div>
        </div>
        <div className="aspect-[4/3] w-full overflow-hidden rounded-2xl border border-[color:var(--border)]">
          <iframe
            title="Jungle Pepper location"
            src="https://www.google.com/maps/embed?pb=!1m18!1m12!1m3!1d3847.3053316658367!2d35.00193847574118!3d-15.78459132367478!2m3!1f0!2f0!3f0!3m2!1i1024!2i768!4f13.1!3m3!1m2!1s0x18d859e6ee4e40a7%3A0xcf1e96b50770ba86!2sJungle+Pepper!5e0!3m2!1sen!2smw!4v1"
            width="100%"
            height="100%"
            style={{ border: 0 }}
            allowFullScreen
            loading="lazy"
            referrerPolicy="no-referrer-when-downgrade"
          />
        </div>
      </section>
    </div>
  );
}
