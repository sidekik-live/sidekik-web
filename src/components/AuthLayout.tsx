import type { ReactNode } from "react";

/**
 * Sign-in and sign-up: a dark blue backdrop in the logo's colours, the brand on the left and the
 * form card on the right (stacked on small screens).
 */
export function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="relative flex min-h-screen items-center overflow-hidden bg-gradient-to-br from-[#060b26] via-[#0d1a4f] to-[#1a0f5c] px-4 py-10">
      {/* Soft glows echoing the orb's purple and blue. */}
      <div
        aria-hidden
        className="pointer-events-none absolute -left-32 top-1/4 size-[28rem] rounded-full bg-fuchsia-500/20 blur-3xl"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -right-24 -bottom-24 size-[28rem] rounded-full bg-blue-400/20 blur-3xl"
      />

      <div className="relative mx-auto flex w-full max-w-6xl flex-col items-center gap-10 lg:flex-row lg:justify-between lg:gap-16">
        <div className="flex flex-col items-center text-center lg:items-start lg:text-left">
          <img
            src="/logo-large.png"
            alt=""
            width={224}
            height={224}
            className="size-32 drop-shadow-2xl lg:size-56"
          />
          <p className="mt-6 text-5xl font-bold tracking-tight text-white lg:text-7xl">sidekik</p>
          <p className="mt-3 max-w-md text-lg text-blue-100/80">
            Learns how your experts work. Coaches the next hire.
          </p>
        </div>

        <div className="w-full max-w-md rounded-xl bg-card p-8 shadow-2xl">{children}</div>
      </div>
    </div>
  );
}
