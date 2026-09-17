import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "br.com.neodo.prospeccao",
  appName: "Prospecção",
  webDir: "out",
  server: {
    // Faz o WebView carregar os arquivos via https://localhost em vez de
    // file://, o que evita problemas de CORS/cookies com o Supabase e com
    // o localStorage usado para "lembrar de mim".
    androidScheme: "https",
  },
};

export default config;
