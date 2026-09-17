# Prospecção — NEODO Soluções Elétricas Inteligentes

Painel web/desktop para a equipe consultar, filtrar e marcar como
prospectadas as empresas geradas pelo script `cnpj_prospeccao.py`.

Roda tanto como site (Next.js) quanto como aplicativo desktop empacotado
com Electron, usando o **Supabase** como backend (autenticação e banco de
dados).

![Next.js](https://img.shields.io/badge/Next.js-14.2-black?logo=next.js)
![React](https://img.shields.io/badge/React-18.3-61DAFB?logo=react&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-5.5-3178C6?logo=typescript&logoColor=white)
![Electron](https://img.shields.io/badge/Electron-32-47848F?logo=electron&logoColor=white)
![Supabase](https://img.shields.io/badge/Supabase-Auth%20%2B%20DB-3ECF8E?logo=supabase&logoColor=white)

---

## Sumário

- [Funcionalidades](#funcionalidades)
- [Tecnologias](#tecnologias)
- [Pré-requisitos](#pré-requisitos)
- [Rodando localmente](#rodando-localmente)
- [Variáveis de ambiente](#variáveis-de-ambiente)
- [Criando contas da equipe](#criando-contas-da-equipe)
- [Colunas disponíveis](#colunas-disponíveis)
- [Publicando na Vercel](#publicando-na-vercel)
- [Gerando o executável (.exe) para Windows](#gerando-o-executável-exe-para-windows)
- [Estrutura do projeto](#estrutura-do-projeto)
- [Roadmap](#roadmap)

---

## Funcionalidades

- 🔐 Login por e-mail/senha (Supabase Auth)
- 🔎 Filtro por cidade, porte da empresa e nome/nome fantasia
- ☑️ Checkbox "só não prospectadas"
- ✅ Marcar/desmarcar empresa como prospectada — grava automaticamente
  quem marcou e quando; o próprio usuário pode desmarcar sua marcação
- 📝 Observações manuais por empresa (histórico com autor e data)
- 🧩 Colunas configuráveis (mostrar/ocultar e reordenar) com preferência
  salva por usuário
- 🖱️ Zoom da interface com **Ctrl + Scroll** (Ctrl/Cmd + 0 reseta para 100%)
- 🖥️ Empacotável como aplicativo desktop Windows via Electron

## Tecnologias

| Camada | Stack |
|---|---|
| Frontend | Next.js 14 (App Router) + React 18 + TypeScript |
| Estilos | CSS puro (`globals.css`) |
| Backend / Auth / DB | Supabase |
| Desktop | Electron 32 + electron-builder |

## Pré-requisitos

- [Node.js](https://nodejs.org/) 18 ou superior
- Uma conta/projeto no [Supabase](https://supabase.com/)

## Rodando localmente

```bash
git clone <url-do-repositorio>
cd pros
npm install
cp .env.local.example .env.local
npm run dev
```

Abra **http://localhost:3000** — você será redirecionado para `/login`.

## Variáveis de ambiente

Crie um arquivo `.env.local` na raiz do projeto (pode copiar de
`.env.local.example`) com:

```env
NEXT_PUBLIC_SUPABASE_URL=https://SEU-PROJETO.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=SUA_CHAVE_ANON_PUBLICA
```

> Essas chaves são públicas por natureza (chave "anon"/"publishable") — o
> que protege os dados de verdade são as políticas de **RLS** configuradas
> no banco Supabase.

## Criando contas da equipe

Ainda não existe uma tela de cadastro própria. Para criar o acesso de cada
pessoa da equipe:

1. Painel do Supabase → projeto **prospeccao** → **Authentication** → **Users**
2. **Add user** → preencha e-mail e senha, marque **Auto Confirm User**

O nome exibido no sistema (registrado em "quem prospectou") é gerado
automaticamente a partir do e-mail. Para trocar por um nome de verdade,
edite a linha da pessoa na tabela `profiles` (coluna `nome`) pelo
**Table Editor** do Supabase.

## Colunas disponíveis

A tabela de empresas suporta as seguintes colunas, configuráveis pelo
usuário (mostrar/ocultar e reordenar):

| Coluna | Rótulo exibido |
|---|---|
| `nome` | Razão Social |
| `nome_fantasia` | Nome Fantasia |
| `cidade` | Cidade |
| `telefone` | Telefone |
| `email` | E-mail |
| `cnpj` | CNPJ |
| `socio` | Sócio |
| `porte` | Porte |
| `cnae_principal` | CNAE Principal |
| `situacao` | Situação |

## Publicando na Vercel

1. Suba esta pasta para um repositório no GitHub
2. Em [vercel.com](https://vercel.com), clique em **New Project** e importe o repositório
3. Em **Environment Variables**, adicione as mesmas duas variáveis do
   `.env.local.example`
4. Deploy — a Vercel gera uma URL pública (ex: `prospeccao.vercel.app`)
   que qualquer pessoa da equipe já pode acessar e logar

## Gerando o executável (.exe) para Windows

O app roda como programa desktop via Electron, usando o mesmo código do
site — ele sobe um pequeno servidor local por trás e abre numa janela
própria, sem precisar de navegador.

### Passo a passo

```powershell
npm install
copy .env.local.example .env.local
npm run electron:build
```

Isso faz, em sequência:

1. `next build` — gera os arquivos estáticos do site em `out/`
2. Baixa o Electron (só na primeira vez, ~100 MB)
3. Empacota tudo em `dist-exe/win-unpacked/Prospeccao.exe`

### Rodando o executável

Abra a pasta `dist-exe/win-unpacked/` e dê duplo clique em
`Prospeccao.exe`. **Copie a pasta inteira** (não só o `.exe`) para outro
computador Windows — ele precisa dos arquivos ao lado — e vai funcionar
sem precisar instalar Node.js.

### Observações

- A URL e a chave pública do Supabase ficam embutidas no site no momento
  do `npm run electron:build` (as mesmas do `.env.local`); login e dados
  ainda exigem internet para falar com o Supabase.
- Sempre que o código for alterado, rode `npm run electron:build`
  novamente para gerar uma versão atualizada.
- Por padrão é gerada uma pasta portátil (`"target": ["dir"]`). Para um
  instalador único com ícone próprio, troque por `"target": ["nsis"]` no
  `package.json` em `build.win` e gere em uma máquina Windows.

## Gerando o app mobile (Android)

Existem dois caminhos pra transformar isso num app Android — os dois já
estão configurados neste projeto:

### Opção A — App nativo via Capacitor (build local ou na nuvem)

Reaproveita o mesmo `next build` estático usado pelo Electron, empacotado
como app Android de verdade (os arquivos ficam dentro do APK).

**Build local**, com Android Studio instalado:

```bash
npm install
copy .env.local.example .env.local    # (ou "cp" no Linux/Mac)
npm run android:open
```

Isso roda `next build` → `npx cap sync android` → abre o projeto no
Android Studio. De lá, **Build → Generate Signed App Bundle / APK**.

**Build 100% online, sem instalar nada** — via [Codemagic](https://codemagic.io):

1. Suba esta pasta pra um repositório no GitHub (privado é ok)
2. Crie uma conta gratuita em codemagic.io (500 min/mês grátis) e conecte
   o repositório — ele detecta o `codemagic.yaml` já incluído aqui
3. Em **Environment variables**, crie o grupo `supabase` com
   `NEXT_PUBLIC_SUPABASE_URL` e `NEXT_PUBLIC_SUPABASE_ANON_KEY` (os mesmos
   valores do `.env.local.example`), marcando como **Secure**
4. Rode o workflow "Prospecção — Android (Capacitor)" — ao final, baixa
   o `.apk` direto da aba de artefatos
5. Pra gerar um `.aab` assinado (exigido pra publicar na Play Store),
   troque `assembleDebug` por `bundleRelease` no `codemagic.yaml` e
   configure a assinatura em **Code signing → Android**

> Sempre que o código mudar, rode `npm run android:sync` (local) ou dê
> push no repo (Codemagic) pra atualizar o app.

### Opção B — PWA instalável (via PWABuilder, ainda mais rápido)

Como o site já é publicável na Vercel (seção acima) e agora tem
`manifest.json` + service worker (`public/sw.js`), dá pra gerar um APK
sem nenhum build/CI:

1. Publique o site na Vercel (ou outro host com HTTPS)
2. Acesse [pwabuilder.com](https://www.pwabuilder.com), cole a URL
3. Ele valida o manifest/ícones automaticamente e gera um pacote Android
   (Trusted Web Activity) pra download — inclusive pronto pra Play Store

A diferença: esse app sempre carrega o conteúdo da internet (como um
site "encapsulado"), em vez de levar os arquivos dentro do APK como na
Opção A. Mais simples de manter (não precisa rebuildar o app a cada
mudança de código — só fazer novo deploy na Vercel), mas exige conexão
o tempo todo, mesmo pra abrir o app.

### O que muda no app mobile (as duas opções)

- O botão **"Atualizar dados (cnpj_prospeccao.py)"** continua existindo,
  mas fica só de exibição — o script Python só roda mesmo dentro do app
  desktop (Electron), num PC. O código já detecta `window.electronAPI` e
  mostra o aviso.
- Login, filtros, tabela de empresas e preferências funcionam
  normalmente, falando direto com o Supabase.
- A tabela foi pensada pra telas largas; em celular estreito pode pedir
  rolagem horizontal — dá pra ajustar depois com breakpoints dedicados
  no `app/globals.css`, se for um problema no uso real.
- Pra publicar na Play Store: troque o `appId` em `capacitor.config.ts`
  (Opção A) se quiser outro identificador, e sempre gere um build
  assinado (`.aab`) pelo Android Studio ou pelo Codemagic.

## Estrutura do projeto

```
pros/
├── app/
│   ├── page.tsx              # Tela principal (filtros, tabela, colunas)
│   ├── login/page.tsx        # Tela de login
│   ├── layout.tsx            # Layout raiz
│   ├── ZoomController.tsx    # Zoom da interface (Ctrl + Scroll)
│   └── globals.css           # Estilos globais
├── lib/
│   ├── colunas.ts            # Definição das colunas da tabela
│   ├── supabaseClient.ts     # Cliente Supabase + tipos
│   └── cnaeDescricoes.json   # Descrições de CNAE
├── electron/
│   └── main.js               # Processo principal do Electron
├── public/                   # Assets estáticos (logos, ícones)
└── next.config.mjs           # Configuração do Next.js (export estático)
```

## Roadmap

- [ ] Tela de cadastro/convite de novos usuários pela própria interface
- [ ] Envio de mensagem via WhatsApp (a tabela `mensagens_whatsapp` já
      existe no banco, pronta para receber essa integração assim que a
      API for contratada)
- [ ] Instalador `.exe` com ícone customizado (NSIS)

---

<p align="center">Desenvolvido para a NEODO Soluções Elétricas Inteligentes</p>
