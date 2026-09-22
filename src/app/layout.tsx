import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

// Derleme sırasında indirilip uygulamayla birlikte sunulur (çalışırken Google'a istek gitmez)
const inter = Inter({ subsets: ["latin", "latin-ext"], display: "swap", variable: "--font-inter" });

export const metadata: Metadata = {
  title: { default: "AI Sales OS", template: "%s · AI Sales OS" },
  description: "Siz ürününüzü anlatın. Müşteriyi AI bulsun.",
  // Uygulama giriş gerektirir; arama motorlarında listelenmesin
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f5f6f8" },
    { media: "(prefers-color-scheme: dark)", color: "#0a0b0f" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="tr" className={inter.variable}>
      <body className="min-h-dvh">{children}</body>
    </html>
  );
}
