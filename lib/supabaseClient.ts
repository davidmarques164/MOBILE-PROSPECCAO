import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL as string;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY as string;

if (!supabaseUrl || !supabaseAnonKey) {
  // Erro claro em vez de falha silenciosa quando alguém esquece o .env.local
  throw new Error(
    "Configuração do Supabase ausente. Copie .env.local.example para .env.local e preencha os valores."
  );
}

/** Chave usada para lembrar se o usuário marcou "Lembrar de mim" no login. */
export const CHAVE_LEMBRAR_DE_MIM = "prospeccao-lembrar-de-mim";

/**
 * Storage híbrido: decide, no momento de gravar a sessão, se ela vai para o
 * localStorage (sobrevive ao fechar o navegador/app — "Lembrar de mim"
 * marcado) ou para o sessionStorage (some ao fechar a aba/janela —
 * "Lembrar de mim" desmarcado). A leitura procura nos dois lugares, então
 * uma sessão em andamento continua funcionando normalmente.
 */
const storageHibrido = {
  getItem(chave: string) {
    if (typeof window === "undefined") return null;
    return window.localStorage.getItem(chave) ?? window.sessionStorage.getItem(chave);
  },
  setItem(chave: string, valor: string) {
    if (typeof window === "undefined") return;
    const lembrar = window.localStorage.getItem(CHAVE_LEMBRAR_DE_MIM) !== "false";
    if (lembrar) {
      window.localStorage.setItem(chave, valor);
      window.sessionStorage.removeItem(chave);
    } else {
      window.sessionStorage.setItem(chave, valor);
      window.localStorage.removeItem(chave);
    }
  },
  removeItem(chave: string) {
    if (typeof window === "undefined") return;
    window.localStorage.removeItem(chave);
    window.sessionStorage.removeItem(chave);
  },
};

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: storageHibrido,
    persistSession: true,
    autoRefreshToken: true,
  },
});

export type Empresa = {
  id: string;
  cnpj: string;
  nome: string | null;
  nome_fantasia: string | null;
  cidade: string | null;
  telefone: string | null;
  email: string | null;
  socio: string | null;
  porte: string | null;
  cnae_principal: string | null;
  cnae_secundario: string | string[] | null;
  situacao: string | null;
  capital_social: number | null;
  prospectada: boolean;
  prospectada_por: string | null;
  prospectada_em: string | null;
  /** Calculado pela função listar_empresas: true só se O USUÁRIO ATUAL
   * marcou esta empresa como inválida — nunca reflete a marcação de outra
   * pessoa (regra: inválida é por usuário, não global). */
  invalida: boolean;
  criado_em: string;
};

/** Filtro de prospecção (lado a lado com o de validade no painel de filtros). */
export type FiltroProspeccao = "todas" | "prospectadas" | "nao_prospectadas";
/** Filtro de validade — calculado por usuário (ver tabela `invalidas`). */
export type FiltroValidade = "todas" | "validas" | "invalidas";

export type Observacao = {
  id: string;
  empresa_id: string;
  usuario_id: string;
  texto: string;
  criado_em: string;
};

export type Preferencias = {
  ordemColunas?: string[];
  colunasOcultas?: string[];
  mensagemContato?: string;
  tema?: "claro" | "escuro";
};

export type Perfil = {
  id: string;
  nome: string;
  preferencias: Preferencias | null;
  aprovado: boolean;
  is_admin: boolean;
  avatar_url: string | null;
};
