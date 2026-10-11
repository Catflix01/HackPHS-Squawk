import type { Metadata } from "next";

export const metadata: Metadata = { title: "Cross-country lesson" };

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
