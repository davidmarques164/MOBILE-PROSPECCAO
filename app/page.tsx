"use client";

import React, { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase, Empresa, Observacao, Perfil, Preferencias, FiltroProspeccao, FiltroValidade } from "@/lib/supabaseClient";
import { ColunaId, MENSAGEM_PADRAO, TODAS_COLUNAS, normalizarOrdem } from "@/lib/colunas";
import cnaeDescricoes from "@/lib/cnaeDescricoes.json";

const VERSAO_APP = "2.0.0";

declare global {
  interface Window {
    electronAPI?: {
      iniciarAtualizacaoCnpj: (params: { cidades: string[]; portes: string[]; excluirMei: boolean; email: string; senha: string }) => void;
      pararAtualizacaoCnpj: () => void;
      onAtualizacaoLog: (callback: (linha: string) => void) => () => void;
      onAtualizacaoFim: (callback: (codigo: number | null) => void) => () => void;
    };
  }
}

const CIDADES = [
  "Fortaleza", "Caucaia", "Maracanau", "Maranguape", "Pacatuba", "Eusebio",
  "Aquiraz", "Itaitinga", "Guaiuba", "Chorozinho", "Pindoretama",
  "Sao Goncalo do Amarante", "Cascavel", "Horizonte", "Pacajus", "Sobral",
  "Juazeiro do Norte", "Crato", "Itapipoca", "Iguatu"
];

const PORTES = [
  "Micro Empresa",
  "Empresa de Pequeno Porte",
  "Demais (Médio/Grande)",
  "Não informado",
];

const ETAPAS_ATUALIZACAO = [
  "Baixando arquivos da Receita",
  "Filtrando estabelecimentos e montando lista",
  "Enviando para o Supabase",
];

function calcularProgressoAtualizacao(etapa: string, atual: number | null, total: number | null): number {
  if (etapa === "Concluído") return 100;
  const indice = ETAPAS_ATUALIZACAO.indexOf(etapa);
  if (indice === -1) return 0;
  const fatia = 100 / ETAPAS_ATUALIZACAO.length;
  const base = indice * fatia;
  const fracaoInterna = atual != null && total ? Math.min(atual / total, 1) : 0;
  return Math.min(100, base + fracaoInterna * fatia);
}

const ROTULO_COLUNA: Record<ColunaId, string> = Object.fromEntries(
  TODAS_COLUNAS.map((c) => [c.id, c.rotulo])
) as Record<ColunaId, string>;

function formatarData(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("pt-BR", {
    day: "2-digit", month: "2-digit", year: "numeric",
  });
}

function numeroWhatsapp(telefone: string | null): string | null {
  if (!telefone) return null;
  const digitos = telefone.replace(/\D/g, "");
  if (digitos.length < 10) return null;
  return `55${digitos}`;
}

function montarMensagem(template: string, empresa: Empresa, nomeConsultor: string): string {
  const nomeEmpresa = empresa.nome_fantasia || empresa.nome || "sua empresa";
  return template
    .replace(/\{empresa\}/g, nomeEmpresa)
    .replace(/\{consultor\}/g, nomeConsultor)
    .replace(/\{cnpj\}/g, empresa.cnpj || "");
}

const DESCRICOES_CNAE: Record<string, string> = cnaeDescricoes;

function formatarCnae(codigo: string): string {
  const digitos = codigo.replace(/\D/g, "");
  if (digitos.length !== 7) return codigo;
  return `${digitos.slice(0, 2)}.${digitos.slice(2, 4)}-${digitos.slice(4, 5)}/${digitos.slice(5)}`;
}

function descricaoCnae(codigo: string): string | null {
  const digitos = codigo.replace(/\D/g, "");
  return DESCRICOES_CNAE[digitos] ?? null;
}

function listaCnaesSecundarios(valor: string | string[] | null | undefined): string[] {
  if (valor == null) return [];
  const partes: string[] = [];

  if (Array.isArray(valor)) {
    partes.push(...valor.map((item) => String(item)));
  } else {
    const texto = String(valor).trim();
    if (!texto) return [];
    try {
      const parsed: unknown = JSON.parse(texto);
      if (Array.isArray(parsed)) {
        partes.push(...parsed.map((item) => String(item)));
      } else {
        partes.push(texto);
      }
    } catch {
      partes.push(texto);
    }
  }

  const resultado: string[] = [];
  for (const parte of partes) {
    const encontrados = parte.match(/\d{2}\.?\d{2}-?\d\/?\d{2}/g);
    if (encontrados?.length) {
      resultado.push(...encontrados.map((codigo) => codigo.replace(/\D/g, "")));
      continue;
    }
    const codigo = parte.replace(/\D/g, "");
    if (codigo.length === 7) {
      resultado.push(codigo);
    }
  }
  return [...new Set(resultado)].filter((codigo) => codigo.length === 7);
}

function celulaEmpresa(empresa: Empresa, coluna: ColunaId) {
  switch (coluna) {
    case "nome":
      return (
        <div className="flex-col">
          <span className="font-medium text-main">{empresa.nome}</span>
          {empresa.nome_fantasia && <span className="text-sm text-muted">{empresa.nome_fantasia}</span>}
        </div>
      );
    case "nome_fantasia": return empresa.nome_fantasia || "—";
    case "cidade": return empresa.cidade || "—";
    case "telefone": return <span className="text-mono">{empresa.telefone || "—"}</span>;
    case "email": return empresa.email || "—";
    case "cnpj": return <span className="text-mono">{empresa.cnpj}</span>;
    case "socio": return empresa.socio || "—";
    case "porte": return <span className="badge badge-neutral">{empresa.porte}</span>;
    case "cnae_principal": return <span className="text-mono">{empresa.cnae_principal ? formatarCnae(empresa.cnae_principal) : "—"}</span>;
    case "situacao": return empresa.situacao ? <span className="badge badge-status">{empresa.situacao}</span> : "—";
    case "capital_social":
      return empresa.capital_social != null
        ? empresa.capital_social.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })
        : "—";
    default: return "—";
  }
}

// --- Ícones SVG Inline ---
const IconSearch = () => <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"><circle cx="11" cy="11" r="8"></circle><path d="m21 21-4.3-4.3"></path></svg>;
const IconSettings = () => <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>;
const IconLogout = () => <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path><polyline points="16 17 21 12 16 7"></polyline><line x1="21" y1="12" x2="9" y2="12"></line></svg>;
const IconWhatsApp = () => <svg width="16" height="16" fill="currentColor" viewBox="0 0 24 24"><path d="M17.47 6.46A8.9 8.9 0 0 0 12 3.86h-.02A8.96 8.96 0 0 0 3.05 12.8a8.94 8.94 0 0 0 1.2 4.28L3 21l4.05-1.06a8.95 8.95 0 0 0 4.93 1.45h.02a8.96 8.96 0 0 0 8.93-8.94 8.9 8.9 0 0 0-2.61-6.31M12 19.98a7.48 7.48 0 0 1-3.82-1.05l-.27-.16-2.84.74.76-2.77-.18-.28A7.47 7.47 0 0 1 4.54 12.8a7.47 7.47 0 0 1 7.45-7.46 7.44 7.44 0 0 1 5.28 2.2 7.44 7.44 0 0 1 2.18 5.27 7.47 7.47 0 0 1-7.45 7.45m4.09-5.59c-.22-.12-1.33-.66-1.53-.73-.21-.08-.36-.12-.52.11-.15.23-.58.73-.71.88-.13.15-.27.18-.49.06-.23-.12-1-.37-1.9-1.18-.7-.63-1.17-1.4-1.3-1.63-.14-.23-.02-.35.09-.46.1-.11.23-.26.34-.39.12-.13.16-.23.23-.38.08-.15.04-.29-.02-.4-.06-.11-.52-1.25-.71-1.72-.19-.45-.38-.39-.52-.39-.14 0-.29-.02-.44-.02-.15 0-.4.06-.61.28-.21.23-.8.78-.8 1.9s.82 2.2 1.05 2.5c.23.3 1.7 2.6 4.12 3.64.58.25 1.03.4 1.38.5.58.19 1.11.16 1.53.1.48-.07 1.48-.6 1.69-1.18.21-.58.21-1.07.15-1.18-.07-.1-.23-.16-.45-.28"/></svg>;
const IconX = () => <svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>;
const IconCopy = () => <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>;
const IconCheck = () => <svg width="14" height="14" fill="none" stroke="var(--success)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"></polyline></svg>;
const IconMenu = () => <svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"><line x1="4" y1="6" x2="20" y2="6"></line><line x1="4" y1="12" x2="20" y2="12"></line><line x1="4" y1="18" x2="20" y2="18"></line></svg>;
const IconMapPin = () => <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0Z"></path><circle cx="12" cy="10" r="3"></circle></svg>;
const IconBuilding = () => <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"><rect x="4" y="2" width="16" height="20" rx="1"></rect><line x1="9" y1="6" x2="9" y2="6.01"></line><line x1="15" y1="6" x2="15" y2="6.01"></line><line x1="9" y1="10" x2="9" y2="10.01"></line><line x1="15" y1="10" x2="15" y2="10.01"></line><line x1="9" y1="14" x2="9" y2="14.01"></line><line x1="15" y1="14" x2="15" y2="14.01"></line><line x1="9" y1="18" x2="15" y2="18"></line></svg>;
const IconFilter = () => <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"></polygon></svg>;
const IconRefresh = () => <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"><polyline points="23 4 23 10 17 10"></polyline><polyline points="1 20 1 14 7 14"></polyline><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path></svg>;
const IconNote = () => <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="8" y1="13" x2="16" y2="13"></line><line x1="8" y1="17" x2="16" y2="17"></line></svg>;

export default function DashboardPage() {
  const router = useRouter();

  const [carregandoSessao, setCarregandoSessao] = useState(true);
  const [perfil, setPerfil] = useState<Perfil | null>(null);
  const [perfis, setPerfis] = useState<Record<string, string>>({});

  const [cidade, setCidade] = useState("");
  const [porte, setPorte] = useState("");
  const [busca, setBusca] = useState("");
  const [filtroProspeccao, setFiltroProspeccao] = useState<FiltroProspeccao>("todas");
  const [filtroValidade, setFiltroValidade] = useState<FiltroValidade>("todas");

  // --- Menu lateral & Click Outside ---
  const [sidebarAberta, setSidebarAberta] = useState(false);
  const [painelAtivo, setPainelAtivo] = useState<"local" | "porte" | "busca" | "filtros" | null>(null);
  const sidebarRef = useRef<HTMLElement>(null);
  const [popoverTop, setPopoverTop] = useState(0);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      const alvo = event.target as HTMLElement;
      // Os popovers/accordions (localização, porte, busca, filtros) são
      // renderizados fora da <aside>, então precisam ser checados à parte —
      // sem isso, clicar no <select> (ou até só na seta dele) contava como
      // "fora" e fechava o painel antes de dar tempo de escolher algo.
      const dentroPainel = alvo.closest(".sidebar-popover, .sidebar-accordion");
      // Só os botões que abrem/fecham um painel (data-painel-toggle) tratam
      // seu próprio clique — eles chamam alternarPainel no onClick. Qualquer
      // outro clique (avatar, Configurações, Sair, alternar menu, ou fora
      // de tudo) deve fechar o painel aberto, mesmo estando dentro da sidebar.
      const dentroBotaoToggle = alvo.closest("[data-painel-toggle]");
      if (!dentroPainel && !dentroBotaoToggle) {
        if (painelAtivo) setPainelAtivo(null);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [painelAtivo]);

  function alternarPainel(painel: "local" | "porte" | "busca" | "filtros", event: React.MouseEvent<HTMLButtonElement>) {
    if (painelAtivo === painel) {
      setPainelAtivo(null);
    } else {
      setPainelAtivo(painel);
      const rect = event.currentTarget.getBoundingClientRect();
      setPopoverTop(rect.top);
    }
  }

  // --- Linha selecionada ---
  const [linhaSelecionada, setLinhaSelecionada] = useState<string | null>(null);

  // --- Observações: só as do próprio usuário existem para ele ---
  const [obsEmHover, setObsEmHover] = useState<string | null>(null);

  // --- Popup de atualização de dados (cnpj_prospeccao.py) ---
  const [logAtualizacao, setLogAtualizacao] = useState<string[]>([]);
  const [atualizacaoRodando, setAtualizacaoRodando] = useState(false);
  const [etapaAtualizacao, setEtapaAtualizacao] = useState("");
  const [progressoAtualizacao, setProgressoAtualizacao] = useState(0);
  const logConsoleRef = useRef<HTMLDivElement>(null);
  const [cidadesAtualizacao, setCidadesAtualizacao] = useState<string[]>([]);
  const [portesAtualizacao, setPortesAtualizacao] = useState<string[]>([]);
  const [excluirMeiAtualizacao, setExcluirMeiAtualizacao] = useState(true);
  const [emailAtualizacao, setEmailAtualizacao] = useState("");
  const [senhaAtualizacao, setSenhaAtualizacao] = useState("");

  const [empresas, setEmpresas] = useState<Empresa[]>([]);
  const [carregandoEmpresas, setCarregandoEmpresas] = useState(false);
  const [totalRegistros, setTotalRegistros] = useState(0);
  const [pagina, setPagina] = useState(1);
  const [ordenacao, setOrdenacao] = useState<{ coluna: ColunaId; direcao: "asc" | "desc" }>({
    coluna: "nome",
    direcao: "asc",
  });

  const [linhaExpandida, setLinhaExpandida] = useState<string | null>(null);
  const [observacoesPorEmpresa, setObservacoesPorEmpresa] = useState<Record<string, Observacao[]>>({});
  const [novaObs, setNovaObs] = useState("");

  const [copiado, setCopiado] = useState<string | null>(null);
  const [modal, setModal] = useState<"cnae" | "config" | "atualizacao" | null>(null);
  const [toastAvisoProspeccao, setToastAvisoProspeccao] = useState<"visivel" | "saindo" | null>(null);
  const timeoutAvisoProspeccaoRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const timeoutAvisoProspeccaoSaidaRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function mostrarAvisoProspeccao() {
    if (timeoutAvisoProspeccaoRef.current) clearTimeout(timeoutAvisoProspeccaoRef.current);
    if (timeoutAvisoProspeccaoSaidaRef.current) clearTimeout(timeoutAvisoProspeccaoSaidaRef.current);
    setToastAvisoProspeccao("visivel");
    timeoutAvisoProspeccaoRef.current = setTimeout(() => {
      setToastAvisoProspeccao("saindo");
      timeoutAvisoProspeccaoSaidaRef.current = setTimeout(() => setToastAvisoProspeccao(null), 200);
    }, 3000);
  }

  useEffect(() => {
    return () => {
      if (timeoutAvisoProspeccaoRef.current) clearTimeout(timeoutAvisoProspeccaoRef.current);
      if (timeoutAvisoProspeccaoSaidaRef.current) clearTimeout(timeoutAvisoProspeccaoSaidaRef.current);
    };
  }, []);
  const [empresaModalCnae, setEmpresaModalCnae] = useState<Empresa | null>(null);

  const [ordemColunas, setOrdemColunas] = useState<ColunaId[]>(normalizarOrdem(undefined));
  const [colunasOcultas, setColunasOcultas] = useState<Set<ColunaId>>(new Set());
  const [mensagemContato, setMensagemContato] = useState(MENSAGEM_PADRAO);
  const [nomeConsultor, setNomeConsultor] = useState("");
  const [enviandoFoto, setEnviandoFoto] = useState(false);
  const inputFotoRef = useRef<HTMLInputElement>(null);
  const [usuarios, setUsuarios] = useState<Perfil[]>([]);
  const [carregandoUsuarios, setCarregandoUsuarios] = useState(false);
  const [tema, setTema] = useState<"claro" | "escuro">(() => {
    if (typeof window === "undefined") return "claro";
    return (window.localStorage.getItem("prospeccao-tema") as "claro" | "escuro") || "claro";
  });

  const colunasVisiveis = useMemo(
    () => ordemColunas.filter((id) => !colunasOcultas.has(id)),
    [ordemColunas, colunasOcultas]
  );

  useEffect(() => {
    function aoTeclar(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setModal(null);
        setEmpresaModalCnae(null);
      }
    }
    window.addEventListener("keydown", aoTeclar);
    return () => window.removeEventListener("keydown", aoTeclar);
  }, []);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", tema === "escuro" ? "dark" : "light");
    window.localStorage.setItem("prospeccao-tema", tema);
  }, [tema]);

  useEffect(() => {
    async function iniciar() {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        router.push("/login");
        return;
      }

      const { data: perfilData } = await supabase
        .from("profiles")
        .select("id, nome, preferencias, aprovado, is_admin, avatar_url")
        .eq("id", session.user.id)
        .single();

      const perfilCarregado = perfilData as Perfil | null;
      setPerfil(perfilCarregado);
      setNomeConsultor(perfilCarregado?.nome ?? "");

      const prefs: Preferencias = perfilCarregado?.preferencias ?? {};
      setOrdemColunas(normalizarOrdem(prefs.ordemColunas));
      setColunasOcultas(new Set((prefs.colunasOcultas ?? []) as ColunaId[]));
      if (prefs.tema) setTema(prefs.tema);
      setMensagemContato(prefs.mensagemContato || MENSAGEM_PADRAO);

      const { data: todosPerfis } = await supabase.from("profiles").select("id, nome");
      const mapa: Record<string, string> = {};
      (todosPerfis ?? []).forEach((p) => {
        mapa[p.id] = p.nome;
      });
      setPerfis(mapa);
      setCarregandoSessao(false);
    }

    iniciar();
    const { data: assinatura } = supabase.auth.onAuthStateChange((_evento, session) => {
      if (!session) router.push("/login");
    });
    return () => assinatura.subscription.unsubscribe();
  }, [router]);

  const TAMANHO_PAGINA = 500;

  const buscarEmpresas = useCallback(async () => {
    setCarregandoEmpresas(true);
    const inicio = (pagina - 1) * TAMANHO_PAGINA;

    const { data, error } = await supabase.rpc("listar_empresas", {
      p_cidade: cidade || null,
      p_porte: porte || null,
      p_busca: busca.trim() || null,
      p_prospeccao: filtroProspeccao,
      p_validade: filtroValidade,
      p_ordenar_por: ordenacao.coluna,
      p_ordenar_direcao: ordenacao.direcao,
      p_limite: TAMANHO_PAGINA,
      p_offset: inicio,
    });

    if (error) {
      console.error(error);
      setEmpresas([]);
      setTotalRegistros(0);
    } else {
      const linhas = (data ?? []) as (Empresa & { total_count: number })[];
      setEmpresas(linhas);
      setTotalRegistros(linhas.length > 0 ? linhas[0].total_count : 0);
    }
    setCarregandoEmpresas(false);
  }, [cidade, porte, busca, filtroProspeccao, filtroValidade, ordenacao, pagina]);

  useEffect(() => {
    if (!carregandoSessao) buscarEmpresas();
  }, [carregandoSessao, buscarEmpresas]);

  useEffect(() => {
    setPagina(1);
  }, [cidade, porte, busca, filtroProspeccao, filtroValidade, ordenacao]);

  const totalPaginas = Math.max(1, Math.ceil(totalRegistros / TAMANHO_PAGINA));

  useEffect(() => {
    if (pagina > totalPaginas) setPagina(totalPaginas);
  }, [pagina, totalPaginas]);

  function alternarOrdenacao(coluna: ColunaId) {
    setOrdenacao((atual) => {
      if (atual.coluna === coluna) {
        return { coluna, direcao: atual.direcao === "asc" ? "desc" : "asc" };
      }
      return { coluna, direcao: "asc" };
    });
  }

  function irParaPagina(novaPagina: number) {
    setPagina(Math.min(Math.max(1, novaPagina), totalPaginas));
  }

  function numerosDePagina(paginaAtual: number, total: number): (number | "...")[ ] {
    const janela = 1;
    const paginas: (number | "...")[ ] = [];
    for (let p = 1; p <= total; p++) {
      const dentroDaJanela = p >= paginaAtual - janela && p <= paginaAtual + janela;
      if (p === 1 || p === total || dentroDaJanela) {
        paginas.push(p);
      } else if (paginas[paginas.length - 1] !== "...") {
        paginas.push("...");
      }
    }
    return paginas;
  }

  function abrirWhatsappEregistrar(empresa: Empresa) {
    const numero = numeroWhatsapp(empresa.telefone);
    if (!numero) {
      alert("Essa empresa não tem um telefone válido cadastrado.");
      return;
    }
    const mensagem = montarMensagem(mensagemContato, empresa, perfil?.nome ?? "consultor do SENAI");
    window.open(`https://wa.me/${numero}?text=${encodeURIComponent(mensagem)}`, "_blank");

    if (perfil) {
      supabase.from("mensagens_whatsapp").insert({
        empresa_id: empresa.id,
        usuario_id: perfil.id,
        direcao: "enviada",
        conteudo: mensagem,
        status: "aberto_no_whatsapp",
      });
    }
  }

  async function marcarProspectada(empresa: Empresa, novoValor: boolean) {
    if (!perfil) return false;
    if (empresa.prospectada && empresa.prospectada_por !== perfil.id) return false;

    const atualizacao = novoValor
      ? { prospectada: true, prospectada_por: perfil.id, prospectada_em: new Date().toISOString() }
      : { prospectada: false, prospectada_por: null, prospectada_em: null };

    const { error } = await supabase.from("empresas").update(atualizacao).eq("id", empresa.id);
    if (error) {
      console.error(error);
      alert(`Não foi possível ${novoValor ? "marcar" : "desmarcar"} esta empresa.\n\nDetalhe do banco: ${error.message}`);
      return false;
    }
    setEmpresas((atual) => atual.map((e) => (e.id === empresa.id ? { ...e, ...atualizacao } : e)));
    if (novoValor) mostrarAvisoProspeccao();
    return true;
  }

  async function clicarProspectar(empresa: Empresa) {
    if (empresa.prospectada && empresa.prospectada_por !== perfil?.id) return;
    if (!empresa.prospectada) {
      const marcou = await marcarProspectada(empresa, true);
      if (!marcou) return;
    }
    abrirWhatsappEregistrar(empresa);
  }

  function alternarCheckboxProspectada(empresa: Empresa) {
    marcarProspectada(empresa, !empresa.prospectada);
  }

  async function clicarSemRequisitos(empresa: Empresa) {
    if (!perfil) return;
    const novoValor = !empresa.invalida;

    if (novoValor) {
      const { error } = await supabase.from("invalidas").insert({ empresa_id: empresa.id, usuario_id: perfil.id });
      if (error) {
        console.error(error);
        alert(`Não foi possível marcar como inválida.\n\nDetalhe do banco: ${error.message}`);
        return;
      }
    } else {
      const { error } = await supabase.from("invalidas").delete().eq("empresa_id", empresa.id).eq("usuario_id", perfil.id);
      if (error) {
        console.error(error);
        alert(`Não foi possível desmarcar como inválida.\n\nDetalhe do banco: ${error.message}`);
        return;
      }
    }
    setEmpresas((atual) => atual.map((e) => (e.id === empresa.id ? { ...e, invalida: novoValor } : e)));
  }

  async function copiarValor(empresaId: string, campo: "telefone" | "email" | "cnpj", valor: string | null) {
    if (!valor) return;
    try {
      await navigator.clipboard.writeText(valor);
      setCopiado(`${empresaId}:${campo}`);
      setTimeout(() => setCopiado(null), 1500);
    } catch {}
  }

  async function carregarMinhasObservacoes(empresaId: string) {
    if (!perfil || observacoesPorEmpresa[empresaId]) return;
    const { data } = await supabase
      .from("observacoes")
      .select("*")
      .eq("empresa_id", empresaId)
      .eq("usuario_id", perfil.id)
      .order("criado_em", { ascending: false });
    setObservacoesPorEmpresa((atual) => ({ ...atual, [empresaId]: (data ?? []) as Observacao[] }));
  }

  function aoPassarMouseNaLinha(empresaId: string) {
    setObsEmHover(empresaId);
    carregarMinhasObservacoes(empresaId);
  }

  async function abrirObservacoes(empresaId: string) {
    if (linhaExpandida === empresaId) {
      setLinhaExpandida(null);
      return;
    }
    setLinhaExpandida(empresaId);
    setNovaObs("");
    await carregarMinhasObservacoes(empresaId);
  }

  async function adicionarObservacao(empresaId: string) {
    if (!novaObs.trim() || !perfil) return;
    const { data, error } = await supabase.from("observacoes").insert({ empresa_id: empresaId, usuario_id: perfil.id, texto: novaObs.trim() }).select().single();
    if (error || !data) return;
    setObservacoesPorEmpresa((atual) => ({ ...atual, [empresaId]: [data as Observacao, ...(atual[empresaId] ?? [])] }));
    setNovaObs("");
  }

  function moverColuna(id: ColunaId, direcao: -1 | 1) {
    setOrdemColunas((atual) => {
      const indice = atual.indexOf(id);
      const novoIndice = indice + direcao;
      if (novoIndice < 0 || novoIndice >= atual.length) return atual;
      const copia = [...atual];
      [copia[indice], copia[novoIndice]] = [copia[novoIndice], copia[indice]];
      return copia;
    });
  }

  function alternarVisibilidade(id: ColunaId) {
    setColunasOcultas((atual) => {
      const copia = new Set(atual);
      if (copia.has(id)) copia.delete(id);
      else copia.add(id);
      return copia;
    });
  }

  async function salvarConfiguracoes() {
    if (!perfil) return;
    const preferencias: Preferencias = { ordemColunas, colunasOcultas: Array.from(colunasOcultas), mensagemContato, tema };
    const nomeFinal = nomeConsultor.trim() || perfil.nome;
    await supabase.from("profiles").update({ preferencias, nome: nomeFinal }).eq("id", perfil.id);
    setPerfil({ ...perfil, preferencias, nome: nomeFinal });
    setPerfis((atual) => ({ ...atual, [perfil.id]: nomeFinal }));
    setModal(null);
  }

  async function trocarFotoPerfil(arquivo: File) {
    if (!perfil) return;
    if (!arquivo.type.startsWith("image/")) {
      alert("Escolha um arquivo de imagem (JPG, PNG, WEBP...).");
      return;
    }
    if (arquivo.size > 3 * 1024 * 1024) {
      alert("A imagem precisa ter no máximo 3 MB.");
      return;
    }
    setEnviandoFoto(true);
    const extensao = arquivo.name.split(".").pop()?.toLowerCase() || "jpg";
    const caminho = `${perfil.id}/avatar.${extensao}`;
    const { error: erroUpload } = await supabase.storage
      .from("avatares")
      .upload(caminho, arquivo, { upsert: true, cacheControl: "3600" });
    if (erroUpload) {
      alert(`Não foi possível enviar a foto: ${erroUpload.message}`);
      setEnviandoFoto(false);
      return;
    }
    const { data } = supabase.storage.from("avatares").getPublicUrl(caminho);
    const urlComVersao = `${data.publicUrl}?v=${Date.now()}`;
    await supabase.from("profiles").update({ avatar_url: urlComVersao }).eq("id", perfil.id);
    setPerfil({ ...perfil, avatar_url: urlComVersao });
    setEnviandoFoto(false);
  }

  async function removerFotoPerfil() {
    if (!perfil) return;
    setEnviandoFoto(true);
    await supabase.from("profiles").update({ avatar_url: null }).eq("id", perfil.id);
    setPerfil({ ...perfil, avatar_url: null });
    setEnviandoFoto(false);
  }

  async function alternarTema() {
    const novoTema = tema === "escuro" ? "claro" : "escuro";
    setTema(novoTema);
    if (!perfil) return;
    await supabase
      .from("profiles")
      .update({ preferencias: { ordemColunas, colunasOcultas: Array.from(colunasOcultas), mensagemContato, tema: novoTema } })
      .eq("id", perfil.id);
  }

  async function sair() {
    await supabase.auth.signOut();
    router.push("/login");
  }

  async function carregarUsuarios() {
    setCarregandoUsuarios(true);
    const { data } = await supabase
      .from("profiles")
      .select("id, nome, preferencias, aprovado, is_admin")
      .order("nome");
    setUsuarios((data ?? []) as Perfil[]);
    setCarregandoUsuarios(false);
  }

  function abrirConfiguracoes() {
    setModal("config");
    if (perfil?.is_admin) carregarUsuarios();
  }

  useEffect(() => {
    if (!window.electronAPI) return;
    const pararLog = window.electronAPI.onAtualizacaoLog((linha) => {
      const match = linha.match(/^PROGRESSO\|(.+)\|(-|\d+)\|(-|\d+)$/);
      if (match) {
        const [, etapa, atualTexto, totalTexto] = match;
        const atual = atualTexto === "-" ? null : Number(atualTexto);
        const total = totalTexto === "-" ? null : Number(totalTexto);
        setEtapaAtualizacao(etapa);
        setProgressoAtualizacao(calcularProgressoAtualizacao(etapa, atual, total));
        return;
      }
      setLogAtualizacao((atual) => [...atual, linha]);
    });
    const pararFim = window.electronAPI.onAtualizacaoFim((codigo) => {
      setAtualizacaoRodando(false);
      if (codigo === 0) {
        setEtapaAtualizacao("Concluído");
        setProgressoAtualizacao(100);
      }
      setLogAtualizacao((atual) => [
        ...atual,
        codigo === 0 ? "✅ Atualização concluída com sucesso." : `⚠️ Processo encerrado (código ${codigo ?? "desconhecido"}).`,
      ]);
    });
    return () => { pararLog(); pararFim(); };
  }, []);

  useEffect(() => {
    if (logConsoleRef.current) {
      logConsoleRef.current.scrollTop = logConsoleRef.current.scrollHeight;
    }
  }, [logAtualizacao]);

  function alternarSelecaoAtualizacao(lista: string[], set: (v: string[]) => void, valor: string) {
    set(lista.includes(valor) ? lista.filter((v) => v !== valor) : [...lista, valor]);
  }

  function iniciarAtualizacao() {
    if (!window.electronAPI) {
      alert("Essa função só funciona no aplicativo desktop (Prospeccao.exe), instalado num PC com Python.");
      return;
    }
    if (cidadesAtualizacao.length === 0 || portesAtualizacao.length === 0) {
      alert("Selecione pelo menos uma cidade e um porte.");
      return;
    }
    if (!emailAtualizacao || !senhaAtualizacao) {
      alert("Informe o e-mail e a senha da sua conta do sistema Prospecção (necessário para enviar os dados ao Supabase).");
      return;
    }
    setLogAtualizacao([]);
    setEtapaAtualizacao("Iniciando...");
    setProgressoAtualizacao(0);
    setAtualizacaoRodando(true);
    window.electronAPI.iniciarAtualizacaoCnpj({
      cidades: cidadesAtualizacao,
      portes: portesAtualizacao,
      excluirMei: excluirMeiAtualizacao,
      email: emailAtualizacao,
      senha: senhaAtualizacao,
    });
  }

  function pararAtualizacao() {
    window.electronAPI?.pararAtualizacaoCnpj();
    setAtualizacaoRodando(false);
  }

  async function alternarAprovacao(usuario: Perfil) {
    const { error } = await supabase
      .from("profiles")
      .update({ aprovado: !usuario.aprovado })
      .eq("id", usuario.id);
    if (error) {
      alert("Não foi possível alterar essa conta.\n\n" + error.message);
      return;
    }
    setUsuarios((atual) =>
      atual.map((u) => (u.id === usuario.id ? { ...u, aprovado: !usuario.aprovado } : u))
    );
  }

  async function alternarAdmin(usuario: Perfil) {
    const { error } = await supabase
      .from("profiles")
      .update({ is_admin: !usuario.is_admin })
      .eq("id", usuario.id);
    if (error) {
      alert("Não foi possível alterar essa conta.\n\n" + error.message);
      return;
    }
    setUsuarios((atual) =>
      atual.map((u) => (u.id === usuario.id ? { ...u, is_admin: !usuario.is_admin } : u))
    );
  }

  if (carregandoSessao) {
    return (
      <div className="flex-center full-screen">
        <div className="spinner"></div>
      </div>
    );
  }

  if (perfil && !perfil.aprovado) {
    return (
      <div className="flex-center full-screen aguardando-aprovacao">
        <div className="aguardando-card">
          <img
            src={tema === "escuro" ? "/logo-neodo-horizontal-dark.png" : "/logo-neodo-horizontal.png"}
            alt="NEODO"
            className="aguardando-logo"
          />
          <h2>Conta aguardando aprovação</h2>
          <p>
            Olá, {perfil.nome}. Sua conta foi criada, mas ainda precisa ser aprovada por um
            administrador antes que você possa acessar o sistema.
          </p>
          <button className="btn btn-outline" onClick={sair}>Sair</button>
        </div>
      </div>
    );
  }

  const iniciais = (perfil?.nome ?? "?").trim().slice(0, 1).toUpperCase();

  return (
    <div className={`app-shell ${sidebarAberta ? "sidebar-aberta" : ""}`}>
      <aside className="sidebar" ref={sidebarRef}>
        <button className="sidebar-item sidebar-toggle" onClick={() => { setSidebarAberta((a) => !a); setPainelAtivo(null); }} title="Menu">
          <IconMenu />
          {sidebarAberta && <span className="sidebar-label">Menu</span>}
        </button>

        <button className="sidebar-item sidebar-avatar-btn" onClick={abrirConfiguracoes} title="Perfil">
          <div className="avatar-circle">
            {perfil?.avatar_url ? (
              <img src={perfil.avatar_url} alt="" className="avatar-foto" />
            ) : (
              iniciais
            )}
          </div>
          {sidebarAberta && <span className="sidebar-label">{perfil?.nome}</span>}
        </button>

        <nav className="sidebar-nav">
          <button data-painel-toggle className={`sidebar-item ${painelAtivo === "local" ? "ativo" : ""}`} onClick={(e) => alternarPainel("local", e)} title="Localização">
            <IconMapPin />
            {sidebarAberta && <span className="sidebar-label">Localização</span>}
          </button>
          {sidebarAberta && painelAtivo === "local" && (
            <div className="sidebar-accordion">
              <select className="input" value={cidade} onChange={(e) => setCidade(e.target.value)} autoFocus>
                <option value="">Todas as cidades</option>
                {CIDADES.map((c) => (<option key={c} value={c}>{c}</option>))}
              </select>
            </div>
          )}

          <button data-painel-toggle className={`sidebar-item ${painelAtivo === "porte" ? "ativo" : ""}`} onClick={(e) => alternarPainel("porte", e)} title="Porte da empresa">
            <IconBuilding />
            {sidebarAberta && <span className="sidebar-label">Porte</span>}
          </button>
          {sidebarAberta && painelAtivo === "porte" && (
            <div className="sidebar-accordion">
              <select className="input" value={porte} onChange={(e) => setPorte(e.target.value)} autoFocus>
                <option value="">Todos os portes</option>
                {PORTES.map((p) => (<option key={p} value={p}>{p}</option>))}
              </select>
            </div>
          )}

          <button data-painel-toggle className={`sidebar-item ${painelAtivo === "busca" ? "ativo" : ""}`} onClick={(e) => alternarPainel("busca", e)} title="Pesquisar">
            <IconSearch />
            {sidebarAberta && <span className="sidebar-label">Pesquisar</span>}
          </button>
          {sidebarAberta && painelAtivo === "busca" && (
            <div className="sidebar-accordion">
              <div className="input-with-icon">
                <IconSearch />
                <input className="input pl-10" type="text" placeholder="Nome ou Fantasia..." value={busca} onChange={(e) => setBusca(e.target.value)} autoFocus />
              </div>
            </div>
          )}

          <button data-painel-toggle className={`sidebar-item ${painelAtivo === "filtros" ? "ativo" : ""}`} onClick={(e) => alternarPainel("filtros", e)} title="Filtros">
            <IconFilter />
            {sidebarAberta && <span className="sidebar-label">Filtros</span>}
          </button>
          {sidebarAberta && painelAtivo === "filtros" && (
            <div className="sidebar-accordion">
              <div className="filtro-grupo">
                <label className="text-sm font-medium text-main">Prospecção</label>
                <div className="filtro-botoes">
                  <button type="button" className={filtroProspeccao === "todas" ? "ativo" : ""} onClick={() => setFiltroProspeccao("todas")}>Todas</button>
                  <button type="button" className={filtroProspeccao === "prospectadas" ? "ativo" : ""} onClick={() => setFiltroProspeccao("prospectadas")}>Prospectadas</button>
                  <button type="button" className={filtroProspeccao === "nao_prospectadas" ? "ativo" : ""} onClick={() => setFiltroProspeccao("nao_prospectadas")}>Não prospectadas</button>
                </div>
              </div>
              <div className="filtro-grupo">
                <label className="text-sm font-medium text-main">Validade</label>
                <div className="filtro-botoes">
                  <button type="button" className={filtroValidade === "todas" ? "ativo" : ""} onClick={() => setFiltroValidade("todas")}>Todas</button>
                  <button type="button" className={filtroValidade === "validas" ? "ativo" : ""} onClick={() => setFiltroValidade("validas")}>Válidas</button>
                  <button type="button" className={filtroValidade === "invalidas" ? "ativo" : ""} onClick={() => setFiltroValidade("invalidas")}>Inválidas</button>
                </div>
              </div>
              <button type="button" className="btn btn-primary w-full mt-2" onClick={() => setPainelAtivo(null)}>Aplicar Filtros</button>
            </div>
          )}

          <button className="sidebar-item" onClick={abrirConfiguracoes} title="Configurações">
            <IconSettings />
            {sidebarAberta && <span className="sidebar-label">Configurações</span>}
          </button>
        </nav>


        <div className="sidebar-bottom">
          <button className="sidebar-item text-danger" onClick={sair} title="Sair">
            <IconLogout />
            {sidebarAberta && <span className="sidebar-label">Sair</span>}
          </button>
        </div>
      </aside>

      {!sidebarAberta && painelAtivo === "local" && (
        <div className="sidebar-popover" style={{ top: popoverTop }}>
          <label>Localização</label>
          <select className="input" value={cidade} onChange={(e) => setCidade(e.target.value)} autoFocus>
            <option value="">Todas as cidades</option>
            {CIDADES.map((c) => (<option key={c} value={c}>{c}</option>))}
          </select>
        </div>
      )}

      {!sidebarAberta && painelAtivo === "porte" && (
        <div className="sidebar-popover" style={{ top: popoverTop }}>
          <label>Porte</label>
          <select className="input" value={porte} onChange={(e) => setPorte(e.target.value)} autoFocus>
            <option value="">Todos os portes</option>
            {PORTES.map((p) => (<option key={p} value={p}>{p}</option>))}
          </select>
        </div>
      )}

      {!sidebarAberta && painelAtivo === "busca" && (
        <div className="sidebar-popover" style={{ top: popoverTop }}>
          <label>Pesquisar</label>
          <div className="input-with-icon">
            <IconSearch />
            <input className="input pl-10" type="text" placeholder="Nome ou Fantasia..." value={busca} onChange={(e) => setBusca(e.target.value)} autoFocus />
          </div>
        </div>
      )}

      {!sidebarAberta && painelAtivo === "filtros" && (
        <div className="sidebar-popover pop-filtros" style={{ top: popoverTop }}>
          <div className="filtros-lado-a-lado">
            <div className="filtro-grupo">
              <label>Prospecção</label>
              <div className="filtro-botoes">
                <button type="button" className={filtroProspeccao === "todas" ? "ativo" : ""} onClick={() => setFiltroProspeccao("todas")}>Todas</button>
                <button type="button" className={filtroProspeccao === "prospectadas" ? "ativo" : ""} onClick={() => setFiltroProspeccao("prospectadas")}>Prospectadas</button>
                <button type="button" className={filtroProspeccao === "nao_prospectadas" ? "ativo" : ""} onClick={() => setFiltroProspeccao("nao_prospectadas")}>Não prospectadas</button>
              </div>
            </div>
            <div className="filtro-grupo">
              <label>Validade</label>
              <div className="filtro-botoes">
                <button type="button" className={filtroValidade === "todas" ? "ativo" : ""} onClick={() => setFiltroValidade("todas")}>Todas</button>
                <button type="button" className={filtroValidade === "validas" ? "ativo" : ""} onClick={() => setFiltroValidade("validas")}>Válidas</button>
                <button type="button" className={filtroValidade === "invalidas" ? "ativo" : ""} onClick={() => setFiltroValidade("invalidas")}>Inválidas</button>
              </div>
            </div>
          </div>
          <button type="button" className="btn btn-primary w-full" onClick={() => setPainelAtivo(null)}>Aplicar Filtros</button>
        </div>
      )}

      <div className="app-main">
        <header className="topbar">
          <img
            src={tema === "escuro" ? "/logo-neodo-horizontal-dark.png" : "/logo-neodo-horizontal.png"}
            alt="NEODO Soluções Elétricas Inteligentes"
            className="brand-neodo-logo-h"
          />
        </header>

      <main className="main-content">
        <div className="results-count-left">
          {carregandoEmpresas ? "Buscando..." : totalRegistros === 0 ? "Nenhuma empresa encontrada." 
            : `Mostrando ${(pagina - 1) * TAMANHO_PAGINA + 1}–${Math.min(pagina * TAMANHO_PAGINA, totalRegistros)} de ${totalRegistros}`}
        </div>

        <div className="table-container">
          {empresas.length === 0 && !carregandoEmpresas ? (
            <div className="empty-state">
              <div className="empty-icon"><IconSearch /></div>
              <p>Nenhuma empresa encontrada com esses filtros.</p>
            </div>
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  {colunasVisiveis.map((id) => {
                    const ativa = ordenacao.coluna === id;
                    return (
                      <th key={id} className="sortable-header" onClick={() => alternarOrdenacao(id)}>
                        <div className="header-content">
                          {ROTULO_COLUNA[id]}
                          <span className={`sort-arrow ${ativa ? 'active' : ''} ${ordenacao.direcao === 'desc' ? 'desc' : ''}`}>↑</span>
                        </div>
                      </th>
                    );
                  })}
                  <th>Obs.</th>
                  <th className="col-actions">Status & Ações</th>
                </tr>
              </thead>
              <tbody>
                {empresas.map((empresa) => {
                  const isProspectada = empresa.prospectada;
                  const isInvalida = empresa.invalida;
                  const classeLinha = [
                    isProspectada ? "row-success" : isInvalida ? "row-danger" : "",
                    linhaSelecionada === empresa.id ? "row-selecionada" : "",
                  ].filter(Boolean).join(" ");
                  const podeProspectar = !isProspectada || empresa.prospectada_por === perfil?.id;
                  const minhasObs = observacoesPorEmpresa[empresa.id] ?? [];
                  const temObs = minhasObs.length > 0;

                  return (
                    <Fragment key={empresa.id}>
                      <tr
                        className={classeLinha}
                        onMouseEnter={() => aoPassarMouseNaLinha(empresa.id)}
                        onMouseLeave={() => setObsEmHover((atual) => (atual === empresa.id ? null : atual))}
                        onClick={() => {
                          setLinhaSelecionada(empresa.id);
                          setEmpresaModalCnae(empresa);
                          setModal("cnae");
                          if (linhaExpandida && linhaExpandida !== empresa.id) setLinhaExpandida(null);
                        }}
                      >
                        {colunasVisiveis.map((id) => {
                          if (id === "telefone" || id === "email" || id === "cnpj") {
                            const valor = id === "telefone" ? empresa.telefone : id === "email" ? empresa.email : empresa.cnpj;
                            const marcado = copiado === `${empresa.id}:${id}`;
                            return (
                              <td key={id} className="cell-copyable" title={valor ? "Copiar" : undefined} onClick={(e) => { e.stopPropagation(); copiarValor(empresa.id, id, valor); }}>
                                <div className="copy-content">
                                  {id === "cnpj" ? <span className="text-mono">{valor || "—"}</span> : valor || "—"}
                                  {valor && <span className="copy-icon">{marcado ? <IconCheck /> : <IconCopy />}</span>}
                                </div>
                              </td>
                            );
                          }
                          return <td key={id}>{celulaEmpresa(empresa, id)}</td>;
                        })}
                        <td onClick={(e) => e.stopPropagation()} className="td-obs">
                          <div className="obs-hover-wrap">
                            <button className={`btn btn-outline btn-sm ${temObs ? "btn-tem-obs" : ""}`} onClick={() => abrirObservacoes(empresa.id)}>
                              {temObs && <IconNote />}
                              {linhaExpandida === empresa.id ? "Fechar" : "Ver"}
                            </button>
                            {obsEmHover === empresa.id && linhaExpandida !== empresa.id && temObs && (
                              <div className="obs-tooltip">
                                {minhasObs.slice(0, 3).map((obs) => (
                                  <p key={obs.id}>{obs.texto}</p>
                                ))}
                              </div>
                            )}
                          </div>
                        </td>
                        <td className="col-actions" onClick={(e) => e.stopPropagation()}>
                          <div className="actions-group">
                            <label className="action-toggle" title={podeProspectar ? "Prospectada" : `Prospectada por ${perfis[empresa.prospectada_por ?? ""] ?? "outro"}`}>
                              <input type="checkbox" checked={isProspectada} disabled={!podeProspectar} onChange={() => alternarCheckboxProspectada(empresa)} />
                              <span className="toggle-label">Prospectada</span>
                            </label>
                            
                            <button className="btn btn-whatsapp btn-icon" disabled={!podeProspectar} onClick={() => clicarProspectar(empresa)} title="Abrir WhatsApp">
                              <IconWhatsApp />
                            </button>

                            <div className="divider-v"></div>

                            <label className="action-toggle action-toggle-danger" title="Inválida (só para você)">
                              <input type="checkbox" checked={isInvalida} onChange={() => clicarSemRequisitos(empresa)} />
                              <span className="toggle-label">Inválida</span>
                            </label>
                          </div>
                        </td>
                      </tr>
                      {linhaExpandida === empresa.id && (
                        <tr className="row-expanded">
                          <td colSpan={colunasVisiveis.length + 2} className="expanded-content">
                            <div className="obs-panel">
                              <p className="obs-aviso">Suas observações — só você vê o que escrever aqui.</p>
                              <div className="obs-list">
                                {minhasObs.length === 0 ? (
                                  <div className="obs-empty">Nenhuma observação registrada.</div>
                                ) : (
                                  minhasObs.map((obs) => (
                                    <div key={obs.id} className="obs-bubble">
                                      <p>{obs.texto}</p>
                                      <span className="obs-meta">{formatarData(obs.criado_em)}</span>
                                    </div>
                                  ))
                                )}
                              </div>
                              <div className="obs-input-group">
                                <textarea className="input" placeholder="Nova observação..." value={novaObs} onChange={(e) => setNovaObs(e.target.value)} />
                                <button className="btn btn-primary" onClick={() => adicionarObservacao(empresa.id)}>Salvar</button>
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        {totalPaginas > 1 && (
          <nav className="pagination">
            <button className="btn btn-outline btn-icon" onClick={() => irParaPagina(pagina - 1)} disabled={pagina === 1}>‹</button>
            <div className="page-numbers">
              {numerosDePagina(pagina, totalPaginas).map((p, i) =>
                p === "..." ? <span key={`ret-${i}`} className="page-dots">…</span> : (
                  <button key={p} className={`btn btn-page ${p === pagina ? "active" : ""}`} onClick={() => irParaPagina(p as number)}>{p}</button>
                )
              )}
            </div>
            <button className="btn btn-outline btn-icon" onClick={() => irParaPagina(pagina + 1)} disabled={pagina === totalPaginas}>›</button>
          </nav>
        )}
      </main>

      <footer className="app-footer">
        Desenvolvido por NEODO SEI · v{VERSAO_APP}
      </footer>
      </div>

      {/* MODAL CNAE */}
      {modal === "cnae" && empresaModalCnae && (
        <div className="modal-backdrop" onClick={() => setModal(null)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <button className="modal-close" onClick={() => setModal(null)}><IconX /></button>
            <div className="modal-header">
              <h2>{empresaModalCnae.nome_fantasia || empresaModalCnae.nome}</h2>
              <span className="text-mono text-muted">{empresaModalCnae.cnpj}</span>
            </div>
            
            <div className="modal-body">
              <div className="cnae-section">
                <h3>Capital Social</h3>
                <p className="capital-social-valor">
                  {empresaModalCnae.capital_social != null
                    ? empresaModalCnae.capital_social.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })
                    : "Não informado"}
                </p>
              </div>

              <div className="cnae-section">
                <h3>CNAE Principal</h3>
                {empresaModalCnae.cnae_principal ? (
                  <div className="cnae-card">
                    <strong>{formatarCnae(empresaModalCnae.cnae_principal)}</strong>
                    <p>{descricaoCnae(empresaModalCnae.cnae_principal) ?? "Descrição não encontrada"}</p>
                  </div>
                ) : <p className="text-muted">Não informado</p>}
              </div>

              <div className="cnae-section">
                <h3>CNAEs Secundários</h3>
                {(() => {
                  const secs = listaCnaesSecundarios(empresaModalCnae.cnae_secundario);
                  if (secs.length === 0) return <p className="text-muted">Nenhum registrado.</p>;
                  return (
                    <div className="cnae-grid">
                      {secs.map((cod) => (
                        <div key={cod} className="cnae-card secondary">
                          <strong>{formatarCnae(cod)}</strong>
                          <p>{descricaoCnae(cod) ?? "Descrição não encontrada"}</p>
                        </div>
                      ))}
                    </div>
                  );
                })()}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* MODAL CONFIG */}
      {modal === "config" && (
        <div className="modal-backdrop" onClick={() => setModal(null)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <button className="modal-close" onClick={() => setModal(null)}><IconX /></button>
            <div className="modal-header">
              <h2>Configurações do Painel</h2>
            </div>
            <div className="modal-body">
              <div className="config-group">
                <label>Foto de perfil</label>
                <div className="foto-perfil-linha">
                  {perfil?.avatar_url ? (
                    <img src={perfil.avatar_url} alt="" className="avatar-circle avatar-foto avatar-foto-grande" />
                  ) : (
                    <span className="avatar-circle avatar-foto-grande">{iniciais}</span>
                  )}
                  <div className="foto-perfil-botoes">
                    <input
                      ref={inputFotoRef}
                      type="file"
                      accept="image/*"
                      style={{ display: "none" }}
                      onChange={(e) => {
                        const arquivo = e.target.files?.[0];
                        if (arquivo) trocarFotoPerfil(arquivo);
                        e.target.value = "";
                      }}
                    />
                    <button type="button" className="btn btn-outline btn-sm" disabled={enviandoFoto} onClick={() => inputFotoRef.current?.click()}>
                      {enviandoFoto ? "Enviando..." : "Alterar foto"}
                    </button>
                    {perfil?.avatar_url && (
                      <button type="button" className="btn btn-outline btn-sm" disabled={enviandoFoto} onClick={removerFotoPerfil}>
                        Remover
                      </button>
                    )}
                  </div>
                </div>
              </div>

              <div className="config-group">
                <label>Aparência</label>
                <button type="button" className="toggle-tema" onClick={alternarTema}>
                  <span className={`toggle-track ${tema === "escuro" ? "ativo" : ""}`}>
                    <span className="toggle-thumb" />
                  </span>
                  <span className="toggle-texto">{tema === "escuro" ? "Modo escuro" : "Modo claro"}</span>
                </button>
              </div>

              <div className="config-group">
                <label>Seu Nome (Para a mensagem)</label>
                <input type="text" className="input" value={nomeConsultor} onChange={(e) => setNomeConsultor(e.target.value)} placeholder="Como você se apresenta..." />
              </div>
              
              <div className="config-group">
                <label>Template do WhatsApp</label>
                <p className="text-sm text-muted mb-2">Variáveis: <code>{"{empresa}"}</code>, <code>{"{consultor}"}</code> e <code>{"{cnpj}"}</code></p>
                <textarea className="input" rows={4} value={mensagemContato} onChange={(e) => setMensagemContato(e.target.value)} />
              </div>

              <div className="config-group">
                <label>Visibilidade e Ordem das Colunas</label>
                <div className="col-config-list">
                  {ordemColunas.map((id, index) => (
                    <div key={id} className="col-config-item">
                      <label className="checkbox-label">
                        <input type="checkbox" checked={!colunasOcultas.has(id)} onChange={() => alternarVisibilidade(id)} />
                        {ROTULO_COLUNA[id]}
                      </label>
                      <div className="col-arrows">
                        <button disabled={index === 0} onClick={() => moverColuna(id, -1)}>↑</button>
                        <button disabled={index === ordemColunas.length - 1} onClick={() => moverColuna(id, 1)}>↓</button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {perfil?.is_admin && (
                <div className="config-group">
                  <label>Atualização de dados (admin)</label>
                  <p className="text-sm text-muted mb-2">
                    Roda o script <code>cnpj_prospeccao.py</code> para baixar a base
                    mais recente da Receita e enviar para o Supabase. Só funciona no
                    aplicativo desktop, num PC com Python instalado.
                  </p>
                  <button
                    type="button"
                    className="btn btn-outline"
                    onClick={() => { setModal("atualizacao"); setLogAtualizacao([]); }}
                  >
                    <IconRefresh /> Atualizar dados (cnpj_prospeccao.py)
                  </button>
                </div>
              )}

              {perfil?.is_admin && (
                <div className="config-group">
                  <label>Usuários do sistema (admin)</label>
                  <p className="text-sm text-muted mb-2">
                    Aprove novos cadastros ou promova alguém a administrador.
                  </p>
                  {carregandoUsuarios ? (
                    <p className="text-sm text-muted">Carregando...</p>
                  ) : (
                    <ul className="lista-usuarios">
                      {usuarios.map((usuario) => (
                        <li key={usuario.id} className="usuario-item">
                          <div className="usuario-info">
                            <strong>{usuario.nome}</strong>
                            {usuario.id === perfil.id && <span className="tag-voce">você</span>}
                            {usuario.is_admin && <span className="tag-admin">admin</span>}
                            {!usuario.aprovado && <span className="tag-pendente">pendente</span>}
                          </div>
                          <div className="usuario-acoes">
                            <button
                              className={usuario.aprovado ? "btn btn-outline btn-sm" : "btn btn-primary btn-sm"}
                              onClick={() => alternarAprovacao(usuario)}
                              disabled={usuario.id === perfil.id}
                            >
                              {usuario.aprovado ? "Revogar acesso" : "Aprovar"}
                            </button>
                            <button
                              className="btn btn-outline btn-sm"
                              onClick={() => alternarAdmin(usuario)}
                              disabled={usuario.id === perfil.id}
                            >
                              {usuario.is_admin ? "Remover admin" : "Tornar admin"}
                            </button>
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </div>
            <div className="modal-footer">
              <button className="btn btn-outline" onClick={() => setModal(null)}>Cancelar</button>
              <button className="btn btn-primary" onClick={salvarConfiguracoes}>Salvar Alterações</button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL ATUALIZAÇÃO DE DADOS (cnpj_prospeccao.py) */}
      {modal === "atualizacao" && (
        <div className="modal-backdrop" onClick={() => { if (!atualizacaoRodando) setModal(null); }}>
          <div className="modal-content modal-wide" onClick={(e) => e.stopPropagation()}>
            <button className="modal-close" onClick={() => { if (!atualizacaoRodando) setModal(null); }}><IconX /></button>
            <div className="modal-header">
              <h2>Atualizar dados (cnpj_prospeccao.py)</h2>
            </div>
            <div className="modal-body">
              {!window.electronAPI && (
                <p className="text-sm text-danger">
                  Essa função só roda no aplicativo desktop (Prospeccao.exe), num PC com Python
                  instalado — no navegador ela fica apenas de exibição.
                </p>
              )}

              <div className="config-group">
                <label>Cidades</label>
                <div className="chip-list">
                  {CIDADES.map((c) => (
                    <button
                      type="button"
                      key={c}
                      className={`chip ${cidadesAtualizacao.includes(c) ? "ativo" : ""}`}
                      disabled={atualizacaoRodando}
                      onClick={() => alternarSelecaoAtualizacao(cidadesAtualizacao, setCidadesAtualizacao, c)}
                    >
                      {c}
                    </button>
                  ))}
                </div>
              </div>

              <div className="config-group">
                <label>Porte</label>
                <div className="chip-list">
                  {PORTES.map((p) => (
                    <button
                      type="button"
                      key={p}
                      className={`chip ${portesAtualizacao.includes(p) ? "ativo" : ""}`}
                      disabled={atualizacaoRodando}
                      onClick={() => alternarSelecaoAtualizacao(portesAtualizacao, setPortesAtualizacao, p)}
                    >
                      {p}
                    </button>
                  ))}
                </div>
              </div>

              <label className="checkbox-label">
                <input type="checkbox" checked={excluirMeiAtualizacao} disabled={atualizacaoRodando} onChange={(e) => setExcluirMeiAtualizacao(e.target.checked)} />
                Excluir MEI da lista
              </label>

              <div className="config-group">
                <label>Login (conta do sistema Prospecção, para enviar ao Supabase)</label>
                <input className="input" type="email" placeholder="E-mail" disabled={atualizacaoRodando} value={emailAtualizacao} onChange={(e) => setEmailAtualizacao(e.target.value)} />
                <input className="input mt-2" type="password" placeholder="Senha" disabled={atualizacaoRodando} value={senhaAtualizacao} onChange={(e) => setSenhaAtualizacao(e.target.value)} />
              </div>

              <div className="config-group">
                <label>Log</label>
                {(atualizacaoRodando || progressoAtualizacao > 0) && (
                  <div className="progresso-atualizacao">
                    <div className="progresso-atualizacao-topo">
                      <span>{etapaAtualizacao || "Aguardando início..."}</span>
                      <span>{Math.round(progressoAtualizacao)}%</span>
                    </div>
                    <div className="progresso-atualizacao-barra">
                      <div className="progresso-atualizacao-preenchida" style={{ width: `${progressoAtualizacao}%` }} />
                    </div>
                  </div>
                )}
                <div className="log-console" ref={logConsoleRef}>
                  {logAtualizacao.length === 0 ? (
                    <span className="text-muted">O andamento do download e envio aparece aqui...</span>
                  ) : (
                    logAtualizacao.map((linha, i) => <div key={i}>{linha}</div>)
                  )}
                </div>
              </div>
            </div>
            <div className="modal-footer">
              {atualizacaoRodando ? (
                <button className="btn btn-outline text-danger" onClick={pararAtualizacao}>Parar</button>
              ) : (
                <>
                  <button className="btn btn-outline" onClick={() => setModal(null)}>Fechar</button>
                  <button className="btn btn-primary" onClick={iniciarAtualizacao}><IconRefresh /> Iniciar atualização</button>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* TOAST AVISO DE PROSPECÇÃO — não bloqueia a ação, fecha sozinho em 3s */}
      {toastAvisoProspeccao && (
        <div className="toast-wrap">
          <div className={`toast${toastAvisoProspeccao === "saindo" ? " toast-saindo" : ""}`}>
            <p>A empresa permanecerá prospectada por um mês. Após esse período, voltará a ficar disponível.</p>
            <button
              className="modal-close"
              onClick={() => {
                if (timeoutAvisoProspeccaoRef.current) clearTimeout(timeoutAvisoProspeccaoRef.current);
                if (timeoutAvisoProspeccaoSaidaRef.current) clearTimeout(timeoutAvisoProspeccaoSaidaRef.current);
                setToastAvisoProspeccao(null);
              }}
            >
              <IconX />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}