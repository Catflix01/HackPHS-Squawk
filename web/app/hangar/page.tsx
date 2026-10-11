"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { fetchWithFallback } from "../lib/api";

type Role = "Student pilot" | "CFI" | "ATC" | "Commercial pilot" | "Drone pilot";
type Post = { id: string; role: Role; airport: "KCDW" | "KSQK"; text: string; likes: number };
const mockPosts: Post[] = [
  { id: "1", role: "Student pilot", airport: "KCDW", text: "N123SQ ready for taxi practice. Any tips for keeping calls concise?", likes: 8 },
  { id: "2", role: "CFI", airport: "KCDW", text: "Say who you are, where you are, and what you need. Then listen.", likes: 14 },
  { id: "3", role: "ATC", airport: "KSQK", text: "The best radio calls are the ones I never have to ask you to repeat.", likes: 21 },
  { id: "4", role: "Commercial pilot", airport: "KSQK", text: "Pattern work is where calm habits become automatic.", likes: 11 },
  { id: "5", role: "Drone pilot", airport: "KCDW", text: "Learning the same phraseology helps every aircraft share the sky.", likes: 6 },
];

export default function HangarPage() {
  const [posts, setPosts] = useState(mockPosts);
  const [role, setRole] = useState("All");
  const [airport, setAirport] = useState("All");
  useEffect(() => { void fetchWithFallback<Post[]>("/feed", mockPosts).then(setPosts); }, []);
  const visible = useMemo(() => posts.filter((post) => (role === "All" || post.role === role) && (airport === "All" || post.airport === airport)), [airport, posts, role]);
  return <main className="min-h-screen bg-slate-950 p-4 text-slate-100 sm:p-8"><div className="mx-auto max-w-3xl space-y-5"><div className="flex items-center justify-between"><Link className="text-sm text-sky-300 underline" href="/">← The Hangar</Link><Link className="text-sm text-amber-200 underline" href="/join">Join network</Link></div><header><p className="font-mono text-xs uppercase text-sky-300">Squawk network</p><h1 className="text-3xl font-black text-sky-100">The Hangar feed</h1></header><section className="grid gap-3 sm:grid-cols-2"><label className="text-sm text-slate-300">Role<select className="mt-1 w-full rounded-lg bg-slate-900 p-3" onChange={(e) => setRole(e.target.value)} value={role}><option>All</option>{["Student pilot", "CFI", "ATC", "Commercial pilot", "Drone pilot"].map((item) => <option key={item}>{item}</option>)}</select></label><label className="text-sm text-slate-300">Airport<select className="mt-1 w-full rounded-lg bg-slate-900 p-3 font-mono" onChange={(e) => setAirport(e.target.value)} value={airport}><option>All</option><option>KCDW</option><option>KSQK</option></select></label></section><section className="space-y-3">{visible.map((post) => <article className="rounded-2xl border border-sky-400/20 bg-slate-900 p-4" key={post.id}><div className="flex items-center justify-between"><p className="font-bold text-sky-200">{post.role}</p><span className="font-mono text-xs text-amber-200">{post.airport}</span></div><p className="mt-3 text-slate-300">{post.text}</p><p className="mt-3 text-xs text-slate-500">♥ {post.likes}</p></article>)}</section></div></main>;
}
