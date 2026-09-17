"use client";

import { useEffect } from "react";

/**
 * Registra o service worker só quando o app está rodando como PWA/site
 * normal (navegador, ou empacotado como TWA via PWABuilder). Dentro do
 * app nativo gerado pelo Capacitor os arquivos já vêm embutidos no APK,
 * então um service worker ali seria redundante (e podia atrapalhar,
 * cacheando por cima dos arquivos locais).
 */
export default function PwaInit() {
  useEffect(() => {
    if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;

    (async () => {
      try {
        const { Capacitor } = await import("@capacitor/core");
        if (Capacitor.isNativePlatform()) return;
      } catch {
        // @capacitor/core não carregou — segue como site normal.
      }

      navigator.serviceWorker.register("/sw.js").catch(() => {
        // Falha de registro não deve quebrar o app — só perde o modo offline.
      });
    })();
  }, []);

  return null;
}
