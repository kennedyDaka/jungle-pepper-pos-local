import { createFileRoute } from "@tanstack/react-router";
import { useMutation } from "@tanstack/react-query";
import { supabase } from "@/services/repositories/supabaseClient";
import { useState, type FormEvent } from "react";

export const Route = createFileRoute("/website/reservations")({
  head: () => ({
    meta: [
      { title: "Reservations — Jungle Pepper" },
      {
        name: "description",
        content: "Book a table at Jungle Pepper in Blantyre. Reserve online for dine-in.",
      },
    ],
  }),
  component: ReservationsPage,
});

function ReservationsPage() {
  const [form, setForm] = useState({
    name: "",
    phone: "",
    email: "",
    date: "",
    time: "12:00",
    guests: "2",
    occasion: "",
    notes: "",
  });
  const [result, setResult] = useState<{ ref: string; name: string } | null>(null);

  const mutation = useMutation({
    mutationFn: async () => {
      const { data, error } = await (supabase as any).rpc("create_reservation", {
        _customer_name: form.name.trim(),
        _customer_phone: form.phone.trim(),
        _customer_email: form.email.trim() || null,
        _date: form.date,
        _time: form.time + ":00",
        _guests: parseInt(form.guests, 10),
        _occasion: form.occasion.trim() || null,
        _notes: form.notes.trim() || null,
      });
      if (error) throw new Error(error.message);
      return data as any;
    },
    onSuccess: (data) => {
      setResult({
        ref: data.id ?? "N/A",
        name: data.customer_name ?? form.name,
      });
    },
    onError: (err: Error) => {
      alert("Could not complete reservation: " + err.message);
    },
  });

  const today = new Date().toISOString().slice(0, 10);

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!form.name.trim() || !form.phone.trim() || !form.date) return;
    mutation.mutate();
  };

  if (result) {
    return (
      <div className="mx-auto flex max-w-lg flex-col items-center px-4 py-16 text-center">
        <div className="mb-4 grid h-20 w-20 place-items-center rounded-full bg-green-100">
          <svg
            className="h-10 w-10 text-green-600"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth="2.8"
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <h2 className="font-display text-3xl sm:text-4xl">
          THANK YOU, {result.name.toUpperCase()}!
        </h2>
        <p className="mt-3 text-base text-muted-foreground">
          Your reservation request has been received (ref{" "}
          <span className="font-mono text-sm text-[color:var(--brand-red)]">
            {result.ref.slice(0, 8)}
          </span>
          ). We'll confirm shortly.
        </p>
        <p className="mt-2 text-sm text-muted-foreground">
          Questions? Call{" "}
          <a
            href="tel:+265999826229"
            className="font-semibold text-[color:var(--brand-red)] hover:underline"
          >
            0999 826 229
          </a>
        </p>
      </div>
    );
  }

  return (
    <div>
      <section className="bg-[color:var(--brand-ink)]/5 py-10 sm:py-16">
        <div className="mx-auto max-w-3xl px-4 text-center">
          <p className="font-script text-xl text-[color:var(--brand-red)] sm:text-3xl">
            Book a table
          </p>
          <h1 className="font-display text-4xl leading-none sm:text-6xl md:text-7xl">
            RESERVATIONS
          </h1>
          <p className="mt-3 text-sm text-muted-foreground sm:text-base">
            Reserve your spot under the lanterns at Jungle Pepper. Walk-ins always welcome too.
          </p>
        </div>
      </section>

      <form onSubmit={handleSubmit} className="mx-auto max-w-lg px-4 py-8 sm:py-12">
        <div className="grid gap-4 sm:gap-5">
          <div className="grid gap-1.5">
            <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Name *
            </label>
            <input
              required
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              className="rounded-lg border border-[color:var(--border)] bg-background px-3.5 py-2.5 text-sm outline-none ring-[color:var(--brand-red)] focus:ring-2"
              placeholder="Your name"
            />
          </div>
          <div className="grid gap-1.5">
            <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Phone *
            </label>
            <input
              required
              value={form.phone}
              onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
              className="rounded-lg border border-[color:var(--border)] bg-background px-3.5 py-2.5 text-sm outline-none ring-[color:var(--brand-red)] focus:ring-2"
              placeholder="0999 826 229"
            />
          </div>
          <div className="grid gap-1.5">
            <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Email
            </label>
            <input
              type="email"
              value={form.email}
              onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
              className="rounded-lg border border-[color:var(--border)] bg-background px-3.5 py-2.5 text-sm outline-none ring-[color:var(--brand-red)] focus:ring-2"
              placeholder="you@example.com"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Date *
              </label>
              <input
                required
                type="date"
                min={today}
                value={form.date}
                onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))}
                className="rounded-lg border border-[color:var(--border)] bg-background px-3.5 py-2.5 text-sm outline-none ring-[color:var(--brand-red)] focus:ring-2"
              />
            </div>
            <div className="grid gap-1.5">
              <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Time *
              </label>
              <select
                value={form.time}
                onChange={(e) => setForm((f) => ({ ...f, time: e.target.value }))}
                className="rounded-lg border border-[color:var(--border)] bg-background px-3.5 py-2.5 text-sm outline-none ring-[color:var(--brand-red)] focus:ring-2"
              >
                {[
                  "12:00",
                  "12:30",
                  "13:00",
                  "13:30",
                  "14:00",
                  "14:30",
                  "15:00",
                  "15:30",
                  "16:00",
                  "16:30",
                  "17:00",
                  "17:30",
                  "18:00",
                  "18:30",
                  "19:00",
                  "19:30",
                  "20:00",
                  "20:30",
                ].map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Guests *
              </label>
              <select
                value={form.guests}
                onChange={(e) => setForm((f) => ({ ...f, guests: e.target.value }))}
                className="rounded-lg border border-[color:var(--border)] bg-background px-3.5 py-2.5 text-sm outline-none ring-[color:var(--brand-red)] focus:ring-2"
              >
                {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((n) => (
                  <option key={n} value={n}>
                    {n} {n === 1 ? "guest" : "guests"}
                  </option>
                ))}
              </select>
            </div>
            <div className="grid gap-1.5">
              <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Occasion
              </label>
              <select
                value={form.occasion}
                onChange={(e) => setForm((f) => ({ ...f, occasion: e.target.value }))}
                className="rounded-lg border border-[color:var(--border)] bg-background px-3.5 py-2.5 text-sm outline-none ring-[color:var(--brand-red)] focus:ring-2"
              >
                <option value="">None</option>
                {[
                  "Birthday",
                  "Anniversary",
                  "Date night",
                  "Business",
                  "Family outing",
                  "Other",
                ].map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="grid gap-1.5">
            <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Notes
            </label>
            <textarea
              rows={3}
              value={form.notes}
              onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
              className="rounded-lg border border-[color:var(--border)] bg-background px-3.5 py-2.5 text-sm outline-none ring-[color:var(--brand-red)] focus:ring-2"
              placeholder="Allergies, seating preference, etc."
            />
          </div>
        </div>
        <button
          type="submit"
          disabled={mutation.isPending}
          className="mt-6 w-full rounded-full bg-[color:var(--brand-red)] px-5 py-3 text-sm font-bold uppercase tracking-wider text-white disabled:opacity-50"
        >
          {mutation.isPending ? "Submitting..." : "Confirm Reservation"}
        </button>
      </form>
    </div>
  );
}
