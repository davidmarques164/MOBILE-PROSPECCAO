const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("path");
const http = require("http");
const fs = require("fs");
const { spawn } = require("child_process");

const PORTA = 5713;
const PASTA_SITE = path.join(__dirname, "..", "out");

const TIPOS_MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
};

function enviarArquivo(res, caminho) {
  const extensao = path.extname(caminho);
  fs.readFile(caminho, (erro, conteudo) => {
    if (erro) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Página não encontrada");
      return;
    }
    res.writeHead(200, { "Content-Type": TIPOS_MIME[extensao] || "application/octet-stream" });
    res.end(conteudo);
  });
}

// O `next build` com output "export" gera arquivos "achatados"
// (ex: /login vira login.html, não login/index.html), então a resolução
// de caminho tenta nessa ordem: arquivo exato -> "<caminho>.html" -> "/" -> index.html.
function resolverCaminho(urlPath) {
  const limpo = decodeURIComponent(urlPath.split("?")[0]);
  const semBarraFinal = limpo === "/" ? "/index" : limpo.replace(/\/$/, "");

  const candidatos = [
    path.join(PASTA_SITE, limpo), // arquivos estáticos: /_next/..., /favicon.ico etc
    path.join(PASTA_SITE, `${semBarraFinal}.html`),
    path.join(PASTA_SITE, semBarraFinal, "index.html"),
  ];

  return candidatos.find((candidato) => fs.existsSync(candidato) && fs.statSync(candidato).isFile());
}

function criarServidorEstatico() {
  return http.createServer((req, res) => {
    const caminhoResolvido = resolverCaminho(req.url) || path.join(PASTA_SITE, "404.html");
    enviarArquivo(res, caminhoResolvido);
  });
}

let janelaPrincipal;

function criarJanela() {
  janelaPrincipal = new BrowserWindow({
    width: 1320,
    height: 840,
    minWidth: 960,
    minHeight: 600,
    title: "Prospecção",
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, "preload.js"),
    },
  });

  janelaPrincipal.loadURL(`http://localhost:${PORTA}/`);
}

// ---------------------------------------------------------------------------
// Atualização de dados (cnpj_prospeccao.py) — item 2 do pedido: um botão no
// menu de admin abre um popup que roda o script de baixar CNPJs e enviar
// para o Supabase, direto de dentro do app desktop. O script roda em modo
// "--headless" (sem os menus interativos de terminal) para poder ser
// controlado por esses parâmetros vindos da tela, com o log transmitido
// linha a linha de volta para o popup.
// Quando empacotado, __dirname aponta pra dentro do app.asar — e o Python,
// rodando como processo externo, não consegue ler arquivos de lá dentro
// (asar é um arquivo único, só Electron/Node sabem abrir). Por isso o
// "scripts/**/*" tem que estar em "asarUnpack" no package.json, e aqui a
// gente troca "app.asar" por "app.asar.unpacked" pra apontar pro lugar real.
const DIRNAME_REAL = __dirname.includes("app.asar")
  ? __dirname.replace("app.asar", "app.asar.unpacked")
  : __dirname;
const CAMINHO_SCRIPT_PYTHON = path.join(DIRNAME_REAL, "..", "scripts", "cnpj_prospeccao.py");
let processoAtualizacao = null;

function encontrarComandoPython() {
  // Windows normalmente tem "python" (ou o launcher "py"); Linux/Mac usam
  // "python3". Tenta nessa ordem — quem falhar simplesmente não inicia o
  // processo, e o erro aparece no log do popup.
  if (process.platform === "win32") return ["python", "py"];
  return ["python3", "python"];
}

function iniciarAtualizacaoCnpj(evento, params) {
  if (processoAtualizacao) {
    evento.sender.send("atualizacao:log", "Já existe uma atualização em andamento.");
    return;
  }
  if (!fs.existsSync(CAMINHO_SCRIPT_PYTHON)) {
    evento.sender.send("atualizacao:log", `Script não encontrado em: ${CAMINHO_SCRIPT_PYTHON}`);
    evento.sender.send("atualizacao:fim", -1);
    return;
  }

  const args = [
    "-u", // saída sem buffer, para o log chegar em tempo real
    CAMINHO_SCRIPT_PYTHON,
    "--headless",
    "--cidades", (params.cidades || []).join(","),
    "--portes", (params.portes || []).join(","),
    "--email", params.email || "",
    "--senha", params.senha || "",
  ];
  if (params.excluirMei) args.push("--excluir-mei");

  const candidatos = encontrarComandoPython();
  tentarProximoComando(evento, candidatos, args);
}

function tentarProximoComando(evento, candidatos, args) {
  if (candidatos.length === 0) {
    evento.sender.send("atualizacao:log", "Não encontrei o Python instalado (tentei: python3, python, py). Instale o Python e tente de novo.");
    evento.sender.send("atualizacao:fim", -1);
    return;
  }
  const [comando, ...resto] = candidatos;
  const processo = spawn(comando, args, { env: { ...process.env, PYTHONUNBUFFERED: "1" } });

  processo.on("error", () => {
    // Comando não existe neste PC — tenta o próximo candidato.
    tentarProximoComando(evento, resto, args);
  });

  processo.stdout.on("data", (dado) => {
    String(dado).split(/\r?\n/).filter(Boolean).forEach((linha) => evento.sender.send("atualizacao:log", linha));
  });
  processo.stderr.on("data", (dado) => {
    String(dado).split(/\r?\n/).filter(Boolean).forEach((linha) => evento.sender.send("atualizacao:log", linha));
  });
  processo.on("close", (codigo) => {
    processoAtualizacao = null;
    evento.sender.send("atualizacao:fim", codigo);
  });

  processoAtualizacao = processo;
}

ipcMain.on("atualizacao:iniciar", (evento, params) => iniciarAtualizacaoCnpj(evento, params));

ipcMain.on("atualizacao:parar", () => {
  if (processoAtualizacao) {
    processoAtualizacao.kill();
    processoAtualizacao = null;
  }
});

app.whenReady().then(() => {
  criarServidorEstatico().listen(PORTA, "127.0.0.1", () => {
    criarJanela();
  });

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) criarJanela();
  });
});

app.on("window-all-closed", () => {
  if (processoAtualizacao) processoAtualizacao.kill();
  if (process.platform !== "darwin") app.quit();
});
