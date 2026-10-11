"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useState } from "react";
import { Wilco } from "../components/Wilco";

const roles = ["Student pilot", "CFI", "ATC", "Commercial pilot", "Drone pilot"];

export default function JoinPage() {
  const [selected, setSelected] = useState<string[]>([]);
  const [saved, setSaved] = useState(false);
  const router = useRouter();
  useEffect(() => { const savedRoles = localStorage.getItem("squawk-roles"); if (savedRoles) { try { Promise.resolve(JSON.parse(savedRoles) as string[]).then(setSelected); } catch { /* Keep the empty picker. */ } } }, []);
  function submit(event: FormEvent) { event.preventDefault(); localStorage.setItem("squawk-roles", JSON.stringify(selected)); setSaved(true); setTimeout(() => router.push("/"), 500); }
  return <main className="min-h-screen bg-slate-950 p-4 text-slate-100 sm:p-8"><div className="mx-auto max-w-xl space-y-5"><Link className="text-sm text-sky-300 underline" href="/">← The Hangar</Link><section className="rounded-2xl border border-sky-400/30 bg-slate-900 p-6"><div className="flex items-center gap-3"><Wilco mood={saved ? "salute" : "headset"} size={72} /><h1 className="text-3xl font-black text-sky-100">Join the Hangar</h1></div><form className="mt-6 space-y-4" onSubmit={submit}><p className="text-slate-300">Choose your roles.</p>{roles.map((role) => <label className="flex items-center gap-3 rounded-lg border border-slate-700 bg-slate-800 p-3" key={role}><input checked={selected.includes(role)} onChange={(event) => setSelected((current) => event.target.checked ? [...current, role] : current.filter((item) => item !== role))} type="checkbox" />{role}</label>)}<button className="w-full rounded-xl bg-amber-300 px-4 py-3 font-bold text-slate-950" type="submit">Save my profile</button></form></section></div></main>;
}
