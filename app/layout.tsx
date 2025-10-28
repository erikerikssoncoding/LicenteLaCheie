import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Licente la Cheie | Expertiza Academica Personalizata",
  description:
    "Licente la Cheie ofera solutii complete pentru lucrari de licenta, disertatie si doctorat, cu suport profesional si consultanta personalizata.",
  keywords: [
    "licenta",
    "disertatie",
    "doctorat",
    "consultanta academica",
    "Licente la Cheie"
  ]
};

export default function RootLayout({
  children
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ro" className="bg-slate-50">
      <body className="min-h-screen bg-slate-50">
        {children}
      </body>
    </html>
  );
}
