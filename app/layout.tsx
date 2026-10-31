import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Euronics — μηχανή διαθεσιμότητας",
  description: "Εσωτερική υπηρεσία συγχρονισμού στοκ των μελών Euronics",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="el" className="h-full antialiased">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
