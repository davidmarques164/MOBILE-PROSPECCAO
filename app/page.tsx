"use client";

import React, { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase, Empresa, Observacao, Perfil, Preferencias, FiltroProspeccao, FiltroValidade } from "@/lib/supabaseClient";
import { ColunaId, MENSAGEM_PADRAO, TODAS_COLUNAS, normalizarOrdem } from "@/lib/colunas";
import cnaeDescricoes from "@/lib/cnaeDescricoes.json";

const VERSAO_APP = "2.1.0-mobile";

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

// --- Ícones Mobile SVG ---
const IconSearch = () => <svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"><circle cx="11" cy="11" r="8"></circle><path d="m21 21-4.3-4.3"></path></svg>;
const IconFilter = () => <svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"></polygon></svg>;
const IconHome = () => <svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"><path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path><polyline points="9 22 9 12 15 12 15 22"></polyline></svg>;
const IconSettings = () => <svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>;
const IconWhatsApp = () => <svg width="16" height="16" fill="currentColor" viewBox="0 0 24 24"><path d="M17.47 6.46A8.9 8.9 0 0 0 12 3.86h-.02A8.96 8.96 0 0 0 3.05 12.8a8.94 8.94 0 0 0 1.2 4.28L3 21l4.05-1.06a8.95 8.95 0 0 0 4.93 1.45h.02a8.96 8.96 0 0 0 8.93-8.94 8.9 8.9 0 0 0-2.61-6.31M12 19.98a7.48 7.48 0 0 1-3.82-1.05l-.27-.16-2.84.74.76-2.77-.18-.28A7.47 7.47 0 0 1 4.54 12.8a7.47 7.47 0 0 1 7.45-7.46 7.44 7.44 0 0 1 5.28 2.2 7.44 7.44 0 0 1 2.18 5.27 7.47 7.47 0 0 1-7.45 7.45m4.09-5.59c-.22-.12-1.33-.66-1.53-.73-.21-.08-.36-.12-.52.11-.15.23-.58.73-.71.88-.13.15-.27.18-.49.06-.23-.12-1-.37-1.9-1.18-.7-.63-1.17-1.4-1.3-1.63-.14-.23-.02-.35.09-.46.1-.11.23-.26.34-.39.12-.13.16-.23.23-.38.08-.15.04-.29-.02-.4-.06-.11-.52-1.25-.71-1.72-.19-.45-.38-.39-.52-.39-.14 0-.29-.02-.44-.02-.15 0-.4.06-.61.28-.21.23-.8.78-.8 1.9s.82 2.2 1.05 2.5c.23.3 1.7 2.6 4.12 3.64.58.25 1.03.4 1.38.5.58.19 1.11.16 1.53.1.48-.07 1.48-.6 1.69-1.18.21-.58.21-1.07.15-1.18-.07-.1-.23-.16-.45-.28"/></svg>;
const IconX = () => <svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>;

export default function MobileDashboard() {
  const router = useRouter();
  const [carregandoSessao, setCarregandoSessao] = useState(true);
  const [perfil, setPerfil] = useState<Perfil | null>(null);

  // Estados de Filtros e Busca
  const [cidade, setCidade] = useState("");
  const [porte, setPorte] = useState("");
  const [busca, setBusca] = useState("");
  const [filtroProspeccao, setFiltroProspeccao] = useState<FiltroProspeccao>("todas");
  const [filtroValidade, setFiltroValidade] = useState<FiltroValidade>("todas");

  // Navegação inferior ativa (Tab)
  const [abaAtiva, setAbaAtiva] = useState<"home" | "busca" | "filtros" | "config">("home");

  // Dados da Lista
  const [empresas, setEmpresas] = useState<Empresa[]>([]);
  const [carregandoEmpresas, setCarregandoEmpresas] = useState(false);
  const [totalRegistros, setTotalRegistros] = useState(0);
  const [pagina, setPagina] = useState(1);
  const TAMANHO_PAGINA = 20; // Paginação menor para performance mobile

  // Modais específicos
  const [empresaSelecionadaDetalhes, setEmpresaSelecionadaDetalhes] = useState<Empresa | null>(null);
  const [tema, setTema] = useState<"claro" | "escuro">("claro");
  const [mensagemContato, setMensagemContato] = useState(MENSAGEM_PADRAO);
  const [nomeConsultor, setNomeConsultor] = useState("");

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

      const p = perfilData as Perfil | null;
      setPerfil(p);
      setNomeConsultor(p?.nome ?? "");
      if (p?.preferencias?.tema) setTema(p.preferencias.tema);
      if (p?.preferencias?.mensagemContato) setMensagemContato(p.preferencias.mensagemContato);
      setCarregandoSessao(false);
    }
    iniciar();
  }, [router]);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", tema === "escuro" ? "dark" : "light");
  }, [tema]);

  const buscarEmpresas = useCallback(async () => {
    setCarregandoEmpresas(true);
    const inicio = (pagina - 1) * TAMANHO_PAGINA;

    const { data, error } = await supabase.rpc("listar_empresas", {
      p_cidade: cidade || null,
      p_porte: porte || null,
      p_busca: busca.trim() || null,
      p_prospeccao: filtroProspeccao,
      p_validade: filtroValidade,
      p_ordenar_por: "nome",
      p_ordenar_direcao: "asc",
      p_limite: TAMANHO_PAGINA,
      p_offset: inicio,
    });

    if (!error && data) {
      const linhas = data as (Empresa & { total_count: number })[];
      setEmpresas(linhas);
      setTotalRegistros(linhas.length > 0 ? linhas[0].total_count : 0);
    }
    setCarregandoEmpresas(false);
  }, [cidade, porte, busca, filtroProspeccao, filtroValidade, pagina]);

  useEffect(() => {
    if (!carregandoSessao) buscarEmpresas();
  }, [carregandoSessao, buscarEmpresas]);

  async function abrirWhatsappEregistrar(empresa: Empresa) {
    const numero = numeroWhatsapp(empresa.telefone);
    if (!numero) {
      alert("Esta empresa não possui telefone válido.");
      return;
    }
    const msg = montarMensagem(mensagemContato, empresa, perfil?.nome ?? "Consultor");
    window.open(`https://wa.me/${numero}?text=${encodeURIComponent(msg)}`, "_blank");

    if (perfil) {
      await supabase.from("mensagens_whatsapp").insert({
        empresa_id: empresa.id,
        usuario_id: perfil.id,
        direcao: "enviada",
        conteudo: msg,
        status: "aberto_no_whatsapp",
      });
    }
  }

  async function alternarProspectada(empresa: Empresa) {
    if (!perfil) return;
    const novoValor = !empresa.prospectada;
    const atualizacao = novoValor
      ? { prospectada: true, prospectada_por: perfil.id, prospectada_em: new Date().toISOString() }
      : { prospectada: false, prospectada_por: null, prospectada_em: null };

    await supabase.from("empresas").update(atualizacao).eq("id", empresa.id);
    setEmpresas(atual => atual.map(e => e.id === empresa.id ? { ...e, ...atualizacao } : e));
  }

  if (carregandoSessao) {
    return (
      <div style={{ display: "flex", justifyContent: "center", alignItems: "center", height: "100vh" }}>
        <div className="spinner"></div>
      </div>
    );
  }

  return (
    <div className="app-shell">
      {/* Topbar Mobile */}
      <header className="topbar">
        <img
          src={tema === "escuro" ? "/logo-neodo-horizontal-dark.png" : "/logo-neodo-horizontal.png"}
          alt="NEODO"
          className="brand-neodo-logo-h"
        />
        <span className="results-count">{totalRegistros} empresas</span>
      </header>

      {/* Conteúdo Principal (Feed de Cards) */}
      <main className="main-content">
        {/* Barra rápida de busca se ativa */}
        {abaAtiva === "busca" && (
          <div style={{ marginBottom: "0.5rem" }}>
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
          empresas.map((empresa) => (
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

              <div className="empresa-acoes-footer" onClick={(e) => e.stopPropagation()}>
                <label className="acao-check">
                  <input
                    type="checkbox"
                    checked={empresa.prospectada}
                    onChange={() => alternarProspectada(empresa)}
                  />
                  Prospectada
                </label>

                <div className="acoes-direita">
                  <button
                    className="btn btn-whatsapp btn-sm"
                    onClick={() => abrirWhatsappEregistrar(empresa)}
                  >
                    <IconWhatsApp /> WhatsApp
                  </button>
                </div>
              </div>
            </div>
          ))
        )}
      </main>

      {/* MODAL DE DETALHES RÁPIDOS (Ao tocar no Card) */}
      {empresaSelecionadaDetalhes && (
        <div className="modal-backdrop" onClick={() => setEmpresaSelecionadaDetalhes(null)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>{empresaSelecionadaDetalhes.nome_fantasia || empresaSelecionadaDetalhes.nome}</h2>
              <button className="btn btn-outline btn-icon" onClick={() => setEmpresaSelecionadaDetalhes(null)}>
                <IconX />
              </button>
            </div>
            <div className="modal-body">
              <p><strong>CNPJ:</strong> {empresaSelecionadaDetalhes.cnpj || "—"}</p>
              <p><strong>Cidade:</strong> {empresaSelecionadaDetalhes.cidade || "—"}</p>
              <p><strong>Telefone:</strong> {empresaSelecionadaDetalhes.telefone || "—"}</p>
              <p><strong>E-mail:</strong> {empresaSelecionadaDetalhes.email || "—"}</p>
              <p><strong>Sócio:</strong> {empresaSelecionadaDetalhes.socio || "—"}</p>
              <p><strong>Capital Social:</strong> {empresaSelecionadaDetalhes.capital_social ? empresaSelecionadaDetalhes.capital_social.toLocaleString("pt-BR", { style: "currency", currency: "BRL" }) : "—"}</p>
              <p><strong>CNAE Principal:</strong> {empresaSelecionadaDetalhes.cnae_principal ? formatarCnae(empresaSelecionadaDetalhes.cnae_principal) : "—"}</p>
            </div>
            <div className="modal-footer">
              <button
                className="btn btn-whatsapp w-full"
                onClick={() => {
                  abrirWhatsappEregistrar(empresaSelecionadaDetalhes);
                  setEmpresaSelecionadaDetalhes(null);
                }}
              >
                <IconWhatsApp /> Iniciar Contato via WhatsApp
              </button>
            </div>
          </div>
        </div>
      )}

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
                <label style={{ fontSize: "0.85rem", fontWeight: 600, display: "block", marginBottom: "0.4rem" }}>Cidade</label>
                <select className="input" value={cidade} onChange={(e) => setCidade(e.target.value)}>
                  <option value="">Todas as cidades</option>
                  {CIDADES.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>

              <div>
                <label style={{ fontSize: "0.85rem", fontWeight: 600, display: "block", marginBottom: "0.4rem" }}>Porte</label>
                <select className="input" value={porte} onChange={(e) => setPorte(e.target.value)}>
                  <option value="">Todos os portes</option>
                  {PORTES.map(p => <option key={p} value={p}>{p}</option>)}
                </select>
              </div>

              <div>
                <label style={{ fontSize: "0.85rem", fontWeight: 600, display: "block", marginBottom: "0.4rem" }}>Status de Prospecção</label>
                <select className="input" value={filtroProspeccao} onChange={(e) => setFiltroProspeccao(e.target.value as FiltroProspeccao)}>
                  <option value="todas">Todas</option>
                  <option value="prospectadas">Prospectadas</option>
                  <option value="nao_prospectadas">Não prospectadas</option>
                </select>
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-primary w-full" onClick={() => setAbaAtiva("home")}>Aplicar Filtros</button>
            </div>
          </div>
        </div>
      )}

      {/* BOTTOM NAVIGATION BAR (Barra Inferior do App) */}
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
        <button className={`nav-item ${abaAtiva === "config" ? "ativo" : ""}`} onClick={() => {
          setTema(t => t === "escuro" ? "claro" : "escuro");
        }}>
          <IconSettings />
          <span>{tema === "escuro" ? "Claro" : "Escuro"}</span>
        </button>
      </nav>
    </div>
  );
}
