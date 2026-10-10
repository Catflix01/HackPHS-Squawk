import Link from "next/link";

export default function Home() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-950 p-6 text-slate-100">
      <div className="w-full max-w-xl rounded-2xl border border-sky-400/40 bg-slate-900 p-8 text-center shadow-xl">
        <h1 className="text-3xl font-bold text-sky-200">Squawk</h1>
        <p className="mt-3 text-slate-300">
          Duolingo-style ATC radio practice for student pilots.
        </p>
        <Link
          href="/fly"
          className="mt-6 inline-flex rounded-md border border-amber-300 bg-amber-300/20 px-5 py-3 font-semibold text-amber-100"
        >
          Open Flight Deck
        </Link>
      </div>
    </main>
  );
}
