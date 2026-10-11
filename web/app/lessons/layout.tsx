import type { Metadata } from "next";

// Re-declare the template: a plain string title here would drop " | Squawk" for child routes.
export const metadata: Metadata = { title: { default: "Lessons", template: "%s | Squawk" } };

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
