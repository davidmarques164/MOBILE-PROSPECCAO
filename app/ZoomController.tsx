"use client";

import { useEffect } from "react";

const CHAVE_ZOOM = "prospeccao-zoom";
const ZOOM_MIN = 0.6;
const ZOOM_MAX = 2;
const PASSO_ZOOM = 0.1;

/**
 * Habilita zoom da interface com Ctrl + Scroll (e Cmd + Scroll no macOS),
 * de forma parecida com o zoom nativo do navegador/Electron, mas controlado
 * pela própria aplicação (para não depender do zoom da janela do Electron).
 * O nível de zoom é salvo no localStorage e restaurado ao reabrir o app.
 */
export default function ZoomController() {
  useEffect(() => {
    const raiz = document.documentElement;

    function aplicarZoom(nivel: number) {
      const nivelLimitado = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, nivel));
      raiz.style.zoom = String(nivelLimitado);
      try {
        window.localStorage.setItem(CHAVE_ZOOM, String(nivelLimitado));
      } catch {
        // localStorage pode estar indisponível; zoom continua funcionando na sessão atual
      }
      return nivelLimitado;
    }

    // Restaura o zoom salvo anteriormente, se houver
    try {
      const salvo = window.localStorage.getItem(CHAVE_ZOOM);
      if (salvo) aplicarZoom(parseFloat(salvo));
    } catch {
      // ignora indisponibilidade do localStorage
    }

    function aoRolar(evento: WheelEvent) {
      if (!evento.ctrlKey && !evento.metaKey) return;

      evento.preventDefault();

      const zoomAtual = parseFloat(raiz.style.zoom || "1") || 1;
      const direcao = evento.deltaY > 0 ? -1 : 1;
      aplicarZoom(zoomAtual + direcao * PASSO_ZOOM);
    }

    function aoTeclar(evento: KeyboardEvent) {
      // Ctrl/Cmd + 0 reseta o zoom, como no navegador
      if ((evento.ctrlKey || evento.metaKey) && evento.key === "0") {
        evento.preventDefault();
        aplicarZoom(1);
      }
    }

    window.addEventListener("wheel", aoRolar, { passive: false });
    window.addEventListener("keydown", aoTeclar);

    return () => {
      window.removeEventListener("wheel", aoRolar);
      window.removeEventListener("keydown", aoTeclar);
    };
  }, []);

  return null;
}
