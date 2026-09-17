"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase, CHAVE_LEMBRAR_DE_MIM } from "@/lib/supabaseClient";

type Modo = "entrar" | "cadastrar";

export default function LoginPage() {
  const router = useRouter();
  const [modo, setModo] = useState<Modo>("entrar");
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [confirmarSenha, setConfirmarSenha] = useState("");
  const [lembrarDeMim, setLembrarDeMim] = useState(true);
  const [erro, setErro] = useState("");
  const [mensagem, setMensagem] = useState("");
  const [carregando, setCarregando] = useState(false);
  // Mesma preferência lida em app/page.tsx (chave "prospeccao-tema"). A
  // tela de login roda antes do usuário entrar, então precisa ler e
  // aplicar o tema salvo por conta própria — sem isso, o data-theme nunca
  // era setado aqui e a página sempre caía no modo claro.
  const [tema, setTema] = useState<"claro" | "escuro">("claro");

  useEffect(() => {
    const salvo = (window.localStorage.getItem("prospeccao-tema") as "claro" | "escuro") || "claro";
    setTema(salvo);
    document.documentElement.setAttribute("data-theme", salvo === "escuro" ? "dark" : "light");
  }, []);

  function alternarModo(novoModo: Modo) {
    setModo(novoModo);
    setErro("");
    setMensagem("");
    setConfirmarSenha("");
  }

  async function entrar(evento: FormEvent) {
    evento.preventDefault();
    setErro("");
    setMensagem("");
    setCarregando(true);

    // Precisa ser gravado ANTES do login: é essa preferência que o
    // supabaseClient consulta na hora de decidir onde guardar a sessão.
    window.localStorage.setItem(CHAVE_LEMBRAR_DE_MIM, lembrarDeMim ? "true" : "false");

    const { error } = await supabase.auth.signInWithPassword({
      email,
      password: senha,
    });

    setCarregando(false);

    if (error) {
      setErro("E-mail ou senha inválidos.");
      return;
    }

    router.push("/");
    router.refresh();
  }

  async function cadastrar(evento: FormEvent) {
    evento.preventDefault();
    setErro("");
    setMensagem("");

    if (senha !== confirmarSenha) {
      setErro("As senhas não coincidem.");
      return;
    }
    if (senha.length < 6) {
      setErro("A senha precisa ter pelo menos 6 caracteres.");
      return;
    }

    setCarregando(true);
    const { data, error } = await supabase.auth.signUp({
      email,
      password: senha,
    });
    setCarregando(false);

    if (error) {
      setErro(
        error.message === "User already registered"
          ? "Esse e-mail já tem uma conta cadastrada."
          : "Não foi possível criar a conta. Tente novamente."
      );
      return;
    }

    // Se a confirmação por e-mail estiver desativada no Supabase, o
    // usuário já sai logado do signUp; se estiver ativada, precisa
    // confirmar antes de conseguir entrar.
    if (data.session) {
      setMensagem("Conta criada! Um administrador precisa aprovar seu acesso antes que você possa entrar.");
      setModo("entrar");
      await supabase.auth.signOut();
      return;
    }

    setMensagem("Conta criada! Verifique seu e-mail para confirmar, e depois aguarde um administrador aprovar seu acesso.");
    setModo("entrar");
    setSenha("");
    setConfirmarSenha("");
  }

  return (
    <main className="login-container">
      <form className="login-card" onSubmit={modo === "entrar" ? entrar : cadastrar}>
        <img
          src={tema === "escuro" ? "/logo-neodo-horizontal-dark.png" : "/logo-neodo-horizontal.png"}
          alt="NEODO"
          className="login-logo"
        />
        <h1>Prospecção</h1>
        <p className="subtitle">
          {modo === "entrar" ? "Entre com sua conta da equipe" : "Crie sua conta da equipe"}
        </p>

        <label>
          E-mail
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
            required
          />
        </label>

        <label>
          Senha
          <input
            type="password"
            value={senha}
            onChange={(e) => setSenha(e.target.value)}
            autoComplete={modo === "entrar" ? "current-password" : "new-password"}
            required
          />
        </label>

        {modo === "cadastrar" && (
          <label>
            Confirmar senha
            <input
              type="password"
              value={confirmarSenha}
              onChange={(e) => setConfirmarSenha(e.target.value)}
              autoComplete="new-password"
              required
            />
          </label>
        )}

        {modo === "entrar" && (
          <label className="login-checkbox">
            <input
              type="checkbox"
              checked={lembrarDeMim}
              onChange={(e) => setLembrarDeMim(e.target.checked)}
            />
            Lembrar de mim
          </label>
        )}

        {erro && <p className="erro">{erro}</p>}
        {mensagem && <p className="mensagem-sucesso">{mensagem}</p>}

        <button type="submit" disabled={carregando}>
          {carregando
            ? modo === "entrar"
              ? "Entrando..."
              : "Criando conta..."
            : modo === "entrar"
              ? "Entrar"
              : "Cadastrar"}
        </button>

        <p className="login-alternar">
          {modo === "entrar" ? (
            <>
              Não tem conta?{" "}
              <button type="button" onClick={() => alternarModo("cadastrar")}>
                Cadastrar
              </button>
            </>
          ) : (
            <>
              Já tem conta?{" "}
              <button type="button" onClick={() => alternarModo("entrar")}>
                Entrar
              </button>
            </>
          )}
        </p>
      </form>
      <p className="login-rodape">Desenvolvido por NEODO SEI · v1.0.0</p>
    </main>
  );
}
