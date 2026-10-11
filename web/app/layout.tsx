import type { Metadata, Viewport } from "next";
import "./globals.css";

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
    <html lang="en" className="h-full antialiased" suppressHydrationWarning>
      <body className="flex min-h-screen flex-col overflow-x-hidden" suppressHydrationWarning>{children}</body>
    </html>
  );
}
