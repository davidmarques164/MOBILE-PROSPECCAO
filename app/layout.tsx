import type { Metadata, Viewport } from "next";
import "./globals.css";
import ZoomController from "./ZoomController";
import CapacitorInit from "./CapacitorInit";
import PwaInit from "./PwaInit";

export const metadata: Metadata = {
  title: "Prospecção",
  description: "Prospecção de empresas industriais",
  manifest: "/manifest.json",
  icons: {
    icon: [
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: "/icon-192.png",
  },
};

// Sem isso o WebView do Android/iOS renderiza a página como se fosse
// desktop (zoom out automático) em vez de usar a largura real da tela.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  themeColor: "#002760",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="pt-BR">
      <body>
        <ZoomController />
        <CapacitorInit />
        <PwaInit />
        {children}
      </body>
    </html>
  );
}
