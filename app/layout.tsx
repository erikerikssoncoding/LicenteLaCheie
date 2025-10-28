import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://www.licentelacheie.ro"),
  title: {
    default: "Lucrari de Licenta Premium | Licente la Cheie",
    template: "%s | Licente la Cheie"
  },
  description:
    "Licente la Cheie ofera servicii complete pentru lucrari de licenta, disertatie si doctorat, cu suport profesional, consultanta personalizata si livrabile originale.",
  keywords: [
    "lucrari de licenta",
    "servicii lucrari de licenta",
    "consultanta academica",
    "disertatie",
    "doctorat",
    "redactare academica",
    "Licente la Cheie"
  ],
  alternates: {
    canonical: "/"
  },
  openGraph: {
    title: "Lucrari de Licenta Premium | Licente la Cheie",
    description:
      "Solutii profesionale pentru lucrari de licenta si cercetare academica, cu metodologie riguroasa si suport integral.",
    url: "https://www.licentelacheie.ro/",
    siteName: "Licente la Cheie",
    locale: "ro_RO",
    type: "website"
  },
  twitter: {
    card: "summary_large_image",
    title: "Lucrari de Licenta Premium | Licente la Cheie",
    description:
      "Expertiza completa pentru lucrari de licenta, master si doctorat cu rezultate verificate.",
    creator: "@licentelacheie"
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      maxSnippet: -1,
      maxImagePreview: "large",
      maxVideoPreview: -1
    }
  }
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
