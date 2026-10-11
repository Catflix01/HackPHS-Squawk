"use client";

import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useState } from "react";
import { Wilco } from "../components/Wilco";

const roles = ["Student pilot", "CFI", "ATC", "Commercial pilot", "Drone pilot"];

export default function JoinPage() {
  const [selected, setSelected] = useState<string[]>([]);
  const [saved, setSaved] = useState(false);
  const router = useRouter();

  useEffect(() => {
    const savedRoles = localStorage.getItem("squawk-roles");
    if (savedRoles) {
      try {
        Promise.resolve(JSON.parse(savedRoles) as string[]).then(setSelected);
      } catch {
        // Keep the picker empty when saved data is invalid.
      }
    }
  }, []);

  function submit(event: FormEvent) {
    event.preventDefault();
    localStorage.setItem("squawk-roles", JSON.stringify(selected));
    setSaved(true);
    window.setTimeout(() => router.push("/"), 500);
  }

  return (
    <main className="min-h-screen bg-transparent px-4 py-8 text-[#E6EDF5] sm:px-8">
      <div className="mx-auto max-w-xl space-y-5">
        <section className="border border-[#29466B] bg-[#10203A] p-5 sm:p-7">
          <div className="flex items-center gap-3"><Wilco mood={saved ? "salute" : "headset"} size={72} /><div><p className="font-mono text-xs uppercase tracking-[0.18em] text-[#4A9BD9]">The Hangar</p><h1 className="font-display text-3xl font-semibold">Join the network</h1></div></div>
          <form className="mt-6 space-y-3" onSubmit={submit}>
            <p className="text-[#9FB2C8]">Choose your roles.</p>
            {roles.map((role) => <label className="flex min-h-11 items-center gap-3 border border-[#29466B] bg-[#0B1526] p-3 text-[#E6EDF5] hover:border-[#F5B83D]" key={role}><input checked={selected.includes(role)} onChange={(event) => setSelected((current) => event.target.checked ? [...current, role] : current.filter((item) => item !== role))} type="checkbox" />{role}</label>)}
            <button className="mt-2 min-h-11 w-full border border-[#F5B83D] bg-[#F5B83D] px-4 py-3 font-semibold text-[#0B1526] hover:bg-[#E6A92D]" type="submit">Save my profile</button>
            {saved && <p className="text-center text-sm text-[#3FB27F]">Profile saved.</p>}
          </form>
        </section>
      </div>
    </main>
  );
}
