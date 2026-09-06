import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Solmere Free Roam | Take the scenic route",
  description: "Explore a fictional coastal state in a playable 3D driving sandbox. Coastal roads, five original vehicles, and fourteen province destinations.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
