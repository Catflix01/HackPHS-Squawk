import type { Metadata, Viewport } from "next";
import { B612, B612_Mono, Big_Shoulders_Stencil } from "next/font/google";
import "./globals.css";

// "Big Shoulders Stencil Display" is now the opsz axis of Big Shoulders Stencil (set to 72 in globals.css).
const display = Big_Shoulders_Stencil({ subsets: ["latin"], axes: ["opsz"], variable: "--font-big-shoulders", display: "swap" });
const body = B612({ subsets: ["latin"], weight: ["400", "700"], variable: "--font-b612", display: "swap" });
const mono = B612_Mono({ subsets: ["latin"], weight: ["400", "700"], variable: "--font-b612-mono", display: "swap" });

export const metadata: Metadata = {
  title: { default: "Squawk | Radio practice for pilots", template: "%s | Squawk" },
  description:
    "Practice ATC radio calls with an AI tower and AI flight instructor. Lessons, study planner, and a network for everyone in aviation.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#0B1526",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${display.variable} ${body.variable} ${mono.variable} h-full antialiased`} suppressHydrationWarning>
      <body className="flex min-h-screen flex-col overflow-x-hidden font-sans" suppressHydrationWarning>{children}</body>
    </html>
  );
}
