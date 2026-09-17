"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  supabase,
  Empresa,
  Observacao,
  Perfil,
  Preferencias,
  FiltroProspeccao,
  FiltroValidade,
} from "@/lib/supabaseClient";
import { ColunaId, MENSAGEM_PADRAO, normalizarOrdem } from "@/lib/colunas";
import cnaeDescricoes from "@/lib/cnaeDescricoes.json";

const VERSAO_APP = "2.1.0-mobile";

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

const OPCOES_ORDENACAO: { id: ColunaId; rotulo: string }[] = [
  { id: "nome", rotulo: "Nome" },
  { id: "cidade", rotulo: "Cidade" },
  { id: "porte", rotulo: "Porte" },
  { id: "capital_social", rotulo: "Capital social" },
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

function formatarData(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
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
      if (Array.isArray(parsed)) partes.push(...parsed.map((item) => String(item)));
      else partes.push(texto);
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
    if (codigo.length === 7) resultado.push(codigo);
  }
  return [...new Set(resultado)].filter((codigo) => codigo.length === 7);
}

// --- Ícones SVG Inline ---
const IconSearch = () => <svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"><circle cx="11" cy="11" r="8"></circle><path d="m21 21-4.3-4.3"></path></svg>;
const IconFilter = () => <svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"></polygon></svg>;
const IconHome = () => <svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"><path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path><polyline points="9 22 9 12 15 12 15 22"></polyline></svg>;
const IconSettings = () => <svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>;
const IconWhatsApp = () => <svg width="16" height="16" fill="currentColor" viewBox="0 0 24 24"><path d="M17.47 6.46A8.9 8.9 0 0 0 12 3.86h-.02A8.96 8.96 0 0 0 3.05 12.8a8.94 8.94 0 0 0 1.2 4.28L3 21l4.05-1.06a8.95 8.95 0 0 0 4.93 1.45h.02a8.96 8.96 0 0 0 8.93-8.94 8.9 8.9 0 0 0-2.61-6.31M12 19.98a7.48 7.48 0 0 1-3.82-1.05l-.27-.16-2.84.74.76-2.77-.18-.28A7.47 7.47 0 0 1 4.54 12.8a7.47 7.47 0 0 1 7.45-7.46 7.44 7.44 0 0 1 5.28 2.2 7.44 7.44 0 0 1 2.18 5.27 7.47 7.47 0 0 1-7.45 7.45m4.09-5.59c-.22-.12-1.33-.66-1.53-.73-.21-.08-.36-.12-.52.11-.15.23-.58.73-.71.88-.13.15-.27.18-.49.06-.23-.12-1-.37-1.9-1.18-.7-.63-1.17-1.4-1.3-1.63-.14-.23-.02-.35.09-.46.1-.11.23-.26.34-.39.12-.13.16-.23.23-.38.08-.15.04-.29-.02-.4-.06-.11-.52-1.25-.71-1.72-.19-.45-.38-.39-.52-.39-.14 0-.29-.02-.44-.02-.15 0-.4.06-.61.28-.21.23-.8.78-.8 1.9s.82 2.2 1.05 2.5c.23.3 1.7 2.6 4.12 3.64.58.25 1.03.4 1.38.5.58.19 1.11.16 1.53.1.48-.07 1.48-.6 1.69-1.18.21-.58.21-1.07.15-1.18-.07-.1-.23-.16-.45-.28"/></svg>;
const IconX = () => <svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>;
const IconCopy = () => <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>;
const IconCheck = () => <svg width="14" height="14" fill="none" stroke="var(--success)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"></polyline></svg>;
const IconRefresh = () => <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"><polyline points="23 4 23 10 17 10"></polyline><polyline points="1 20 1 14 7 14"></polyline><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path></svg>;
const IconLogout = () => <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path><polyline points="16 17 21 12 16 7"></polyline><line x1="21" y1="12" x2="9" y2="12"></line></svg>;

export default function MobileDashboard() {
  const router = useRouter();

  const [carregandoSessao, setCarregandoSessao] = useState(true);
  const [perfil, setPerfil] = useState<Perfil | null>(null);
  const [perfis, setPerfis] = useState<Record<string, string>>({});

  // --- Filtros e busca ---
  const [cidade, setCidade] = useState("");
  const [porte, setPorte] = useState("");
  const [busca, setBusca] = useState("");
  const [filtroProspeccao, setFiltroProspeccao] = useState<FiltroProspeccao>("todas");
  const [filtroValidade, setFiltroValidade] = useState<FiltroValidade>("todas");
  const [ordenarPor, setOrdenarPor] = useState<ColunaId>("nome");

  // --- Navegação inferior (também controla os modais de filtros/config) ---
  const [abaAtiva, setAbaAtiva] = useState<"home" | "busca" | "filtros" | "config">("home");

  // --- Lista de empresas ---
  const [empresas, setEmpresas] = useState<Empresa[]>([]);
  const [carregandoEmpresas, setCarregandoEmpresas] = useState(false);
  const [totalRegistros, setTotalRegistros] = useState(0);
  const [pagina, setPagina] = useState(1);
  const TAMANHO_PAGINA = 20; // Paginação menor para performance mobile

  // --- Modal de detalhes da empresa (CNAE, observações, ações) ---
  const [empresaSelecionadaDetalhes, setEmpresaSelecionadaDetalhes] = useState<Empresa | null>(null);
  const [observacoesPorEmpresa, setObservacoesPorEmpresa] = useState<Record<string, Observacao[]>>({});
  const [novaObs, setNovaObs] = useState("");
  const [copiado, setCopiado] = useState<string | null>(null);

  // --- Preferências do perfil ---
  const [tema, setTema] = useState<"claro" | "escuro">("claro");
  const [mensagemContato, setMensagemContato] = useState(MENSAGEM_PADRAO);
  const [nomeConsultor, setNomeConsultor] = useState("");
  const [ordemColunas, setOrdemColunas] = useState<ColunaId[]>(normalizarOrdem(undefined));
  const [colunasOcultas, setColunasOcultas] = useState<Set<ColunaId>>(new Set());
  const [enviandoFoto, setEnviandoFoto] = useState(false);
  const inputFotoRef = useRef<HTMLInputElement>(null);

  // --- Admin: usuários ---
  const [usuarios, setUsuarios] = useState<Perfil[]>([]);
  const [carregandoUsuarios, setCarregandoUsuarios] = useState(false);

  // --- Admin: atualização de dados (cnpj_prospeccao.py, só no desktop/Electron) ---
  const [modal, setModal] = useState<"atualizacao" | null>(null);
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

  // --- Toast de aviso de prospecção ---
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

  // --- Sessão, perfil e preferências ---
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
      // ordemColunas/colunasOcultas não têm UI no mobile, mas são preservadas
      // e regravadas do jeito que vieram para não bagunçar a versão desktop.
      setOrdemColunas(normalizarOrdem(prefs.ordemColunas));
      setColunasOcultas(new Set((prefs.colunasOcultas ?? []) as ColunaId[]));
      if (prefs.tema) setTema(prefs.tema);
      setMensagemContato(prefs.mensagemContato || MENSAGEM_PADRAO);

      const { data: todosPerfis } = await supabase.from("profiles").select("id, nome");
      const mapa: Record<string, string> = {};
      (todosPerfis ?? []).forEach((p) => { mapa[p.id] = p.nome; });
      setPerfis(mapa);
      setCarregandoSessao(false);
    }

    iniciar();
    const { data: assinatura } = supabase.auth.onAuthStateChange((_evento, session) => {
      if (!session) router.push("/login");
    });
    return () => assinatura.subscription.unsubscribe();
  }, [router]);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", tema === "escuro" ? "dark" : "light");
  }, [tema]);

  // --- Busca de empresas (paginada) ---
  const buscarEmpresas = useCallback(async () => {
    setCarregandoEmpresas(true);
    const inicio = (pagina - 1) * TAMANHO_PAGINA;

    const { data, error } = await supabase.rpc("listar_empresas", {
      p_cidade: cidade || null,
      p_porte: porte || null,
      p_busca: busca.trim() || null,
      p_prospeccao: filtroProspeccao,
      p_validade: filtroValidade,
      p_ordenar_por: ordenarPor,
      p_ordenar_direcao: "asc",
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
  }, [cidade, porte, busca, filtroProspeccao, filtroValidade, ordenarPor, pagina]);

  useEffect(() => {
    if (!carregandoSessao) buscarEmpresas();
  }, [carregandoSessao, buscarEmpresas]);

  useEffect(() => {
    setPagina(1);
  }, [cidade, porte, busca, filtroProspeccao, filtroValidade, ordenarPor]);

  const totalPaginas = Math.max(1, Math.ceil(totalRegistros / TAMANHO_PAGINA));

  useEffect(() => {
    if (pagina > totalPaginas) setPagina(totalPaginas);
  }, [pagina, totalPaginas]);

  function irParaPagina(novaPagina: number) {
    setPagina(Math.min(Math.max(1, novaPagina), totalPaginas));
  }

  // --- Ações sobre a empresa (prospecção / inválida / WhatsApp) ---
  function atualizarEmpresaLocal(id: string, campos: Partial<Empresa>) {
    setEmpresas((atual) => atual.map((e) => (e.id === id ? { ...e, ...campos } : e)));
    setEmpresaSelecionadaDetalhes((atual) => (atual && atual.id === id ? { ...atual, ...campos } : atual));
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
    atualizarEmpresaLocal(empresa.id, atualizacao);
    if (novoValor) mostrarAvisoProspeccao();
    return true;
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
    atualizarEmpresaLocal(empresa.id, { invalida: novoValor });
  }

  async function copiarValor(empresaId: string, campo: "telefone" | "email" | "cnpj", valor: string | null) {
    if (!valor) return;
    try {
      await navigator.clipboard.writeText(valor);
      setCopiado(`${empresaId}:${campo}`);
      setTimeout(() => setCopiado(null), 1500);
    } catch {}
  }

  // --- Observações (só as do próprio usuário) ---
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

  async function adicionarObservacao(empresaId: string) {
    if (!novaObs.trim() || !perfil) return;
    const { data, error } = await supabase
      .from("observacoes")
      .insert({ empresa_id: empresaId, usuario_id: perfil.id, texto: novaObs.trim() })
      .select()
      .single();
    if (error || !data) return;
    setObservacoesPorEmpresa((atual) => ({ ...atual, [empresaId]: [data as Observacao, ...(atual[empresaId] ?? [])] }));
    setNovaObs("");
  }

  useEffect(() => {
    if (empresaSelecionadaDetalhes) {
      setNovaObs("");
      carregarMinhasObservacoes(empresaSelecionadaDetalhes.id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [empresaSelecionadaDetalhes?.id]);

  // --- Configurações do perfil ---
  async function salvarConfiguracoes() {
    if (!perfil) return;
    const preferencias: Preferencias = { ordemColunas, colunasOcultas: Array.from(colunasOcultas), mensagemContato, tema };
    const nomeFinal = nomeConsultor.trim() || perfil.nome;
    await supabase.from("profiles").update({ preferencias, nome: nomeFinal }).eq("id", perfil.id);
    setPerfil({ ...perfil, preferencias, nome: nomeFinal });
    setPerfis((atual) => ({ ...atual, [perfil.id]: nomeFinal }));
    setAbaAtiva("home");
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
    setAbaAtiva("config");
    if (perfil?.is_admin) carregarUsuarios();
  }

  // --- Atualização de dados (cnpj_prospeccao.py) — só funciona empacotado no Electron ---
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
    if (logConsoleRef.current) logConsoleRef.current.scrollTop = logConsoleRef.current.scrollHeight;
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
    const { error } = await supabase.from("profiles").update({ aprovado: !usuario.aprovado }).eq("id", usuario.id);
    if (error) { alert("Não foi possível alterar essa conta.\n\n" + error.message); return; }
    setUsuarios((atual) => atual.map((u) => (u.id === usuario.id ? { ...u, aprovado: !usuario.aprovado } : u)));
  }

  async function alternarAdmin(usuario: Perfil) {
    const { error } = await supabase.from("profiles").update({ is_admin: !usuario.is_admin }).eq("id", usuario.id);
    if (error) { alert("Não foi possível alterar essa conta.\n\n" + error.message); return; }
    setUsuarios((atual) => atual.map((u) => (u.id === usuario.id ? { ...u, is_admin: !usuario.is_admin } : u)));
  }

  // --- Telas de guarda ---
  if (carregandoSessao) {
    return (
      <div style={{ display: "flex", justifyContent: "center", alignItems: "center", height: "100vh" }}>
        <div className="spinner"></div>
      </div>
    );
  }

  if (perfil && !perfil.aprovado) {
    return (
      <div className="aguardando-aprovacao">
        <div className="aguardando-card">
          <img
            src={tema === "escuro" ? "/logo-neodo-horizontal-dark.png" : "/logo-neodo-horizontal.png"}
            alt="NEODO"
            className="aguardando-logo"
          />
          <h2>Conta aguardando aprovação</h2>
          <p>Olá, {perfil.nome}. Sua conta foi criada, mas ainda precisa ser aprovada por um administrador antes que você possa acessar o sistema.</p>
          <button className="btn btn-outline" onClick={sair}>Sair</button>
        </div>
      </div>
    );
  }

  const iniciais = (perfil?.nome ?? "?").trim().slice(0, 1).toUpperCase();

  return (
    <div className="app-shell">
      {/* Topbar Mobile */}
      <header className="topbar">
        <img
          src={tema === "escuro" ? "/logo-neodo-horizontal-dark.png" : "/logo-neodo-horizontal.png"}
          alt="NEODO"
          className="brand-neodo-logo-h"
        />
        <span className="results-count">
          {carregandoEmpresas ? "Buscando..." : `${totalRegistros} empresa${totalRegistros === 1 ? "" : "s"}`}
        </span>
      </header>

      {/* Conteúdo Principal (Feed de Cards) */}
      <main className="main-content">
        {abaAtiva === "busca" && (
          <div style={{ marginBottom: "0.25rem" }}>
            <input
              type="text"
              className="input"
              placeholder="Digite o nome ou fantasia..."
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              autoFocus
            />
          </div>
        )}

        {carregandoEmpresas ? (
          <div style={{ display: "flex", justifyContent: "center", padding: "3rem" }}>
            <div className="spinner"></div>
          </div>
        ) : empresas.length === 0 ? (
          <div className="empty-state">
            <p>Nenhuma empresa encontrada com os filtros atuais.</p>
          </div>
        ) : (
          empresas.map((empresa) => {
            const podeProspectar = !empresa.prospectada || empresa.prospectada_por === perfil?.id;
            return (
              <div
                key={empresa.id}
                className={`empresa-card ${empresa.prospectada ? "is-prospectada" : ""} ${empresa.invalida ? "is-invalida" : ""}`}
                onClick={() => setEmpresaSelecionadaDetalhes(empresa)}
              >
                <div className="empresa-header">
                  <div className="empresa-info-principal">
                    <h3>{empresa.nome}</h3>
                    {empresa.nome_fantasia && <span>{empresa.nome_fantasia}</span>}
                  </div>
                  <span className="badge-porte">{empresa.porte || "Porte N/D"}</span>
                </div>

                <div className="empresa-detalhes">
                  <div>Cidade: <span>{empresa.cidade || "—"}</span></div>
                  <div>Telefone: <span>{empresa.telefone || "—"}</span></div>
                </div>

                {empresa.prospectada && !podeProspectar && (
                  <p className="prospectada-por">
                    Prospectada por {perfis[empresa.prospectada_por ?? ""] ?? "outro usuário"}
                  </p>
                )}

                <div className="empresa-acoes-footer" onClick={(e) => e.stopPropagation()}>
                  <label className="acao-check" title={podeProspectar ? undefined : "Prospectada por outro usuário"}>
                    <input
                      type="checkbox"
                      checked={empresa.prospectada}
                      disabled={!podeProspectar}
                      onChange={() => alternarCheckboxProspectada(empresa)}
                    />
                    Prospectada
                  </label>

                  <div className="acoes-direita">
                    <button
                      className="btn btn-whatsapp btn-sm"
                      disabled={!podeProspectar}
                      onClick={() => clicarProspectar(empresa)}
                    >
                      <IconWhatsApp /> WhatsApp
                    </button>
                  </div>
                </div>
              </div>
            );
          })
        )}

        {totalPaginas > 1 && (
          <nav className="pagination-mobile">
            <button className="btn btn-outline btn-sm" onClick={() => irParaPagina(pagina - 1)} disabled={pagina === 1}>‹ Anterior</button>
            <span className="pagination-mobile-info">Página {pagina} de {totalPaginas}</span>
            <button className="btn btn-outline btn-sm" onClick={() => irParaPagina(pagina + 1)} disabled={pagina === totalPaginas}>Próxima ›</button>
          </nav>
        )}
      </main>

      {/* MODAL DE DETALHES (CNAE, cópia rápida, prospecção, observações) */}
      {empresaSelecionadaDetalhes && (() => {
        const empresa = empresaSelecionadaDetalhes;
        const podeProspectar = !empresa.prospectada || empresa.prospectada_por === perfil?.id;
        const minhasObs = observacoesPorEmpresa[empresa.id] ?? [];
        const secundarios = listaCnaesSecundarios(empresa.cnae_secundario);

        function linhaCopiavel(rotulo: string, campo: "telefone" | "email" | "cnpj", valor: string | null, mono?: boolean) {
          const marcado = copiado === `${empresa.id}:${campo}`;
          return (
            <div className="detalhe-linha-copiavel" onClick={() => copiarValor(empresa.id, campo, valor)}>
              <span className="text-muted text-sm">{rotulo}</span>
              <span className="copy-content">
                <span className={mono ? "text-mono" : ""}>{valor || "—"}</span>
                {valor && <span className="copy-icon">{marcado ? <IconCheck /> : <IconCopy />}</span>}
              </span>
            </div>
          );
        }

        return (
          <div className="modal-backdrop" onClick={() => setEmpresaSelecionadaDetalhes(null)}>
            <div className="modal-content" onClick={(e) => e.stopPropagation()}>
              <div className="modal-header">
                <h2>{empresa.nome_fantasia || empresa.nome}</h2>
                <button className="btn btn-outline btn-icon" onClick={() => setEmpresaSelecionadaDetalhes(null)}><IconX /></button>
              </div>
              <div className="modal-body">
                {linhaCopiavel("CNPJ", "cnpj", empresa.cnpj, true)}
                {linhaCopiavel("Telefone", "telefone", empresa.telefone)}
                {linhaCopiavel("E-mail", "email", empresa.email)}

                <p><strong>Sócio:</strong> {empresa.socio || "—"}</p>
                <p><strong>Situação:</strong> {empresa.situacao ? <span className="badge badge-status">{empresa.situacao}</span> : "—"}</p>
                <p><strong>Capital Social:</strong> {empresa.capital_social != null ? empresa.capital_social.toLocaleString("pt-BR", { style: "currency", currency: "BRL" }) : "—"}</p>

                <div className="cnae-section">
                  <h3>CNAE Principal</h3>
                  {empresa.cnae_principal ? (
                    <div className="cnae-card">
                      <strong>{formatarCnae(empresa.cnae_principal)}</strong>
                      <p>{descricaoCnae(empresa.cnae_principal) ?? "Descrição não encontrada"}</p>
                    </div>
                  ) : <p className="text-muted">Não informado</p>}
                </div>

                {secundarios.length > 0 && (
                  <div className="cnae-section">
                    <h3>CNAEs Secundários</h3>
                    <div className="cnae-grid">
                      {secundarios.map((cod) => (
                        <div key={cod} className="cnae-card secondary">
                          <strong>{formatarCnae(cod)}</strong>
                          <p>{descricaoCnae(cod) ?? "Descrição não encontrada"}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <div className="empresa-acoes-footer">
                  <label className="action-toggle" title={podeProspectar ? "Prospectada" : `Prospectada por ${perfis[empresa.prospectada_por ?? ""] ?? "outro"}`}>
                    <input type="checkbox" checked={empresa.prospectada} disabled={!podeProspectar} onChange={() => alternarCheckboxProspectada(empresa)} />
                    <span className="toggle-label">Prospectada</span>
                  </label>
                  <div className="divider-v"></div>
                  <label className="action-toggle action-toggle-danger" title="Inválida (só para você)">
                    <input type="checkbox" checked={!!empresa.invalida} onChange={() => clicarSemRequisitos(empresa)} />
                    <span className="toggle-label">Inválida</span>
                  </label>
                </div>

                <div className="cnae-section">
                  <h3>Suas observações</h3>
                  <p className="obs-aviso">Só você vê o que escrever aqui.</p>
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
              </div>
              <div className="modal-footer">
                <button
                  className="btn btn-whatsapp w-full"
                  disabled={!podeProspectar}
                  onClick={() => { clicarProspectar(empresa); setEmpresaSelecionadaDetalhes(null); }}
                >
                  <IconWhatsApp /> Iniciar Contato via WhatsApp
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* MODAL / GAVETA DE FILTROS */}
      {abaAtiva === "filtros" && (
        <div className="modal-backdrop" onClick={() => setAbaAtiva("home")}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Filtrar Empresas</h2>
              <button className="btn btn-outline btn-icon" onClick={() => setAbaAtiva("home")}><IconX /></button>
            </div>
            <div className="modal-body">
              <div>
                <label className="rotulo-campo">Cidade</label>
                <select className="input" value={cidade} onChange={(e) => setCidade(e.target.value)}>
                  <option value="">Todas as cidades</option>
                  {CIDADES.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>

              <div>
                <label className="rotulo-campo">Porte</label>
                <select className="input" value={porte} onChange={(e) => setPorte(e.target.value)}>
                  <option value="">Todos os portes</option>
                  {PORTES.map(p => <option key={p} value={p}>{p}</option>)}
                </select>
              </div>

              <div>
                <label className="rotulo-campo">Status de Prospecção</label>
                <select className="input" value={filtroProspeccao} onChange={(e) => setFiltroProspeccao(e.target.value as FiltroProspeccao)}>
                  <option value="todas">Todas</option>
                  <option value="prospectadas">Prospectadas</option>
                  <option value="nao_prospectadas">Não prospectadas</option>
                </select>
              </div>

              <div>
                <label className="rotulo-campo">Validade</label>
                <select className="input" value={filtroValidade} onChange={(e) => setFiltroValidade(e.target.value as FiltroValidade)}>
                  <option value="todas">Todas</option>
                  <option value="validas">Válidas</option>
                  <option value="invalidas">Inválidas</option>
                </select>
              </div>

              <div>
                <label className="rotulo-campo">Ordenar por</label>
                <select className="input" value={ordenarPor} onChange={(e) => setOrdenarPor(e.target.value as ColunaId)}>
                  {OPCOES_ORDENACAO.map(o => <option key={o.id} value={o.id}>{o.rotulo}</option>)}
                </select>
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-primary w-full" onClick={() => setAbaAtiva("home")}>Aplicar Filtros</button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL DE CONFIGURAÇÕES */}
      {abaAtiva === "config" && (
        <div className="modal-backdrop" onClick={() => setAbaAtiva("home")}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Configurações</h2>
              <button className="btn btn-outline btn-icon" onClick={() => setAbaAtiva("home")}><IconX /></button>
            </div>
            <div className="modal-body">
              <div className="config-group">
                <label className="rotulo-campo">Foto de perfil</label>
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
                      <button type="button" className="btn btn-outline btn-sm" disabled={enviandoFoto} onClick={removerFotoPerfil}>Remover</button>
                    )}
                  </div>
                </div>
              </div>

              <div className="config-group">
                <label className="rotulo-campo">Aparência</label>
                <button type="button" className="toggle-tema" onClick={alternarTema}>
                  <span className={`toggle-track ${tema === "escuro" ? "ativo" : ""}`}><span className="toggle-thumb" /></span>
                  <span className="toggle-texto">{tema === "escuro" ? "Modo escuro" : "Modo claro"}</span>
                </button>
              </div>

              <div className="config-group">
                <label className="rotulo-campo">Seu Nome (Para a mensagem)</label>
                <input type="text" className="input" value={nomeConsultor} onChange={(e) => setNomeConsultor(e.target.value)} placeholder="Como você se apresenta..." />
              </div>

              <div className="config-group">
                <label className="rotulo-campo">Template do WhatsApp</label>
                <p className="text-sm text-muted mb-2">Variáveis: <code>{"{empresa}"}</code>, <code>{"{consultor}"}</code> e <code>{"{cnpj}"}</code></p>
                <textarea className="input" rows={4} value={mensagemContato} onChange={(e) => setMensagemContato(e.target.value)} />
              </div>

              {perfil?.is_admin && (
                <div className="config-group">
                  <label className="rotulo-campo">Atualização de dados (admin)</label>
                  <p className="text-sm text-muted mb-2">
                    Roda o script <code>cnpj_prospeccao.py</code> para baixar a base mais recente da Receita e enviar
                    para o Supabase. Só funciona no aplicativo desktop, num PC com Python instalado.
                  </p>
                  <button type="button" className="btn btn-outline" onClick={() => { setModal("atualizacao"); setLogAtualizacao([]); }}>
                    <IconRefresh /> Atualizar dados
                  </button>
                </div>
              )}

              {perfil?.is_admin && (
                <div className="config-group">
                  <label className="rotulo-campo">Usuários do sistema (admin)</label>
                  <p className="text-sm text-muted mb-2">Aprove novos cadastros ou promova alguém a administrador.</p>
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
                            <button className="btn btn-outline btn-sm" onClick={() => alternarAdmin(usuario)} disabled={usuario.id === perfil.id}>
                              {usuario.is_admin ? "Remover admin" : "Tornar admin"}
                            </button>
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}

              <p className="text-sm text-muted versao-app">v{VERSAO_APP}</p>
            </div>
            <div className="modal-footer">
              <button className="btn btn-outline" onClick={sair}><IconLogout /> Sair</button>
              <button className="btn btn-primary w-full" onClick={salvarConfiguracoes}>Salvar Alterações</button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL ATUALIZAÇÃO DE DADOS (cnpj_prospeccao.py) */}
      {modal === "atualizacao" && (
        <div className="modal-backdrop" onClick={() => { if (!atualizacaoRodando) setModal(null); }}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Atualizar dados</h2>
              <button className="btn btn-outline btn-icon" onClick={() => { if (!atualizacaoRodando) setModal(null); }}><IconX /></button>
            </div>
            <div className="modal-body">
              {!window.electronAPI && (
                <p className="text-sm text-danger">
                  Essa função só roda no aplicativo desktop (Prospeccao.exe), num PC com Python instalado — aqui ela
                  fica apenas de exibição.
                </p>
              )}

              <div className="config-group">
                <label className="rotulo-campo">Cidades</label>
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
                <label className="rotulo-campo">Porte</label>
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
                <label className="rotulo-campo">Login (conta do sistema Prospecção, para enviar ao Supabase)</label>
                <input className="input" type="email" placeholder="E-mail" disabled={atualizacaoRodando} value={emailAtualizacao} onChange={(e) => setEmailAtualizacao(e.target.value)} />
                <input className="input mt-2" type="password" placeholder="Senha" disabled={atualizacaoRodando} value={senhaAtualizacao} onChange={(e) => setSenhaAtualizacao(e.target.value)} />
              </div>

              <div className="config-group">
                <label className="rotulo-campo">Log</label>
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

      {/* TOAST AVISO DE PROSPECÇÃO */}
      {toastAvisoProspeccao && (
        <div className="toast-wrap">
          <div className={`toast${toastAvisoProspeccao === "saindo" ? " toast-saindo" : ""}`}>
            <p>A empresa permanecerá prospectada por um mês. Após esse período, voltará a ficar disponível.</p>
            <button
              className="btn btn-outline btn-icon"
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

      {/* BARRA DE NAVEGAÇÃO INFERIOR */}
      <nav className="bottom-nav">
        <button className={`nav-item ${abaAtiva === "home" ? "ativo" : ""}`} onClick={() => setAbaAtiva("home")}>
          <IconHome />
          <span>Início</span>
        </button>
        <button className={`nav-item ${abaAtiva === "busca" ? "ativo" : ""}`} onClick={() => setAbaAtiva("busca")}>
          <IconSearch />
          <span>Buscar</span>
        </button>
        <button className={`nav-item ${abaAtiva === "filtros" ? "ativo" : ""}`} onClick={() => setAbaAtiva("filtros")}>
          <IconFilter />
          <span>Filtros</span>
        </button>
        <button className={`nav-item ${abaAtiva === "config" ? "ativo" : ""}`} onClick={abrirConfiguracoes}>
          <IconSettings />
          <span>Config</span>
        </button>
      </nav>
    </div>
  );
}
