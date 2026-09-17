"use client";

import { useEffect } from "react";

/**
 * Ajustes que só fazem sentido dentro do app nativo (Android/iOS) gerado
 * pelo Capacitor — no navegador e no Electron essas APIs simplesmente não
 * existem, então tudo aqui é protegido por try/catch e por
 * Capacitor.isNativePlatform().
 */
export default function CapacitorInit() {
  useEffect(() => {
    (async () => {
      try {
        const { Capacitor } = await import("@capacitor/core");
        if (!Capacitor.isNativePlatform()) return;

        const { StatusBar, Style } = await import("@capacitor/status-bar");
        await StatusBar.setStyle({ style: Style.Light }).catch(() => {});

        const { SplashScreen } = await import("@capacitor/splash-screen");
        await SplashScreen.hide().catch(() => {});
      } catch {
        // @capacitor/* só existe quando empacotado como app nativo.
      }
    })();
  }, []);

  return null;
}
