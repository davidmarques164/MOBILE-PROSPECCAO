"""
Prospecção de micro e pequenas empresas industriais no Ceará
==============================================================

Fonte dos dados: base pública de CNPJ da Receita Federal (Estabelecimentos,
Empresas, Sócios, Municípios), espelhada mensalmente por um mirror com CDN
(dados-abertos-rf-cnpj.casadosdados.com.br). Fonte oficial original:
https://dados.gov.br/dados/conjuntos-dados/cadastro-nacional-da-pessoa-juridica---cnpj

Instalação:
    pip install requests pandas questionary tqdm supabase

Uso:
    python cnpj_prospeccao.py

O que o script faz:
    1. Pergunta, com caixas de marcação no terminal, quais cidades do
       Ceará você quer prospectar (edite CIDADES_CEARA para adicionar
       ou remover municípios da lista).
    2. Pergunta qual(is) porte(s) de empresa você quer incluir (Micro
       Empresa, Empresa de Pequeno Porte, Demais, Não informado).
    3. Pergunta se quer excluir MEI da lista (MEI aparece com o mesmo
       código de "Micro Empresa" nos dados da Receita, então só dá pra
       diferenciar consultando o arquivo Simples separadamente).
    3. Pergunta se você quer usar um lote de dados já baixado antes
       (cache local, sem baixar nada de novo) ou verificar/baixar o
       lote mensal mais recente disponível na Receita. Cada lote fica
       em sua própria subpasta (cnpj_cache/AAAA-MM-DD/), então trocar
       de mês nunca mistura dados nem sobrescreve o lote anterior.
    4. Filtra estabelecimentos com situação cadastral ATIVA, nas cidades
       e no(s) porte(s) selecionados, cujo CNAE principal OU algum CNAE
       secundário esteja na Seção C (indústria de transformação,
       divisões 10 a 33).
    5. Junta com Empresas (razão social, porte) e Sócios (usa o sócio
       com data de entrada mais antiga como aproximação de "sócio") e
       salva um CSV local com: cidade, nome, telefone, email, cnpj,
       socio, porte, nome_fantasia, cnae_principal.
    6. Pede login (e-mail/senha) da sua conta no sistema Prospecção e
       envia esses mesmos registros para o banco no Supabase — quem
       já existir (mesmo CNPJ) é atualizado, quem for novo é criado.
       A equipe passa a ver os resultados direto na tela web.

Limitações importantes da fonte de dados (não são bugs do script):
    - Telefone e e-mail são autodeclarados pela empresa junto à Receita.
      Muitas empresas simplesmente não preenchem — espere um bom volume
      de campos vazios.
    - Não existe um campo "sócio fundador" oficial. O script usa o sócio
      com a data de entrada na sociedade mais antiga como aproximação,
      o que costuma ser uma boa proxy mas não é garantia absoluta.

Pré-requisito para o envio ao Supabase:
    - Sua conta já precisa existir no projeto (por enquanto, peça para
      criarem sua conta pelo painel do Supabase — Authentication > Add
      user; a tela de cadastro própria do sistema Prospecção ainda vai
      ser construída).
"""

import argparse
import getpass
import os
import re
import sys
import time
import unicodedata
import zipfile

import pandas as pd
import questionary
import requests
from supabase import create_client
from tqdm import tqdm

# ---------------------------------------------------------------------------
# Configuração
# ---------------------------------------------------------------------------

BASE_URL = "https://dados-abertos-rf-cnpj.casadosdados.com.br/arquivos/"
CACHE_ROOT = "cnpj_cache"

# Projeto Supabase "prospeccao" — a chave abaixo é pública (publishable key),
# feita para ficar embutida em código cliente; ela só consegue o que as
# políticas de RLS do banco permitirem (usuário autenticado consegue
# ler/gravar empresas — nada além disso).
SUPABASE_URL = "https://uslevrtsnziqbunqlxkq.supabase.co"
SUPABASE_KEY = "sb_publishable_qMcEx_qkeP1diI3xxaaRJQ_gH-DnjrD"
SAIDA_CSV = "empresas_industriais_ceara.csv"


def progresso(etapa: str, atual: int | None = None, total: int | None = None):
    """Emite uma linha de progresso em formato fixo, pensada para ser lida
    por máquina (o popup do app desktop usa isso para montar a barra de
    progresso e o nome da etapa atual). Formato:
        PROGRESSO|<nome da etapa>|<atual ou "-">|<total ou "-">
    Quando atual/total não fazem sentido para a etapa (ex: uma etapa
    rápida, sem uma contagem clara), usa "-" nos dois — o app entende isso
    como "etapa em andamento, sem percentual interno" e só avança a barra
    para a fatia correspondente a essa etapa.
    """
    valor_atual = str(atual) if atual is not None else "-"
    valor_total = str(total) if total else "-"
    print(f"PROGRESSO|{etapa}|{valor_atual}|{valor_total}", flush=True)

# Cidades do Ceará disponíveis para seleção. Adicione ou remova conforme
# necessário — o nome não precisa ter acento (o script normaliza para
# comparar com a base da Receita, que também não usa acentuação).
CIDADES_CEARA = [
    "Fortaleza",
    "Caucaia",
    "Maracanau",
    "Maranguape",
    "Pacatuba",
    "Eusebio",
    "Aquiraz",
    "Itaitinga",
    "Guaiuba",
    "Chorozinho",
    "Pindoretama",
    "Sao Goncalo do Amarante",
    "Cascavel",
    "Horizonte",
    "Pacajus",
    "Sobral",
    "Juazeiro do Norte",
    "Crato",
    "Itapipoca",
    "Iguatu",
]

# Divisões 10 a 33 da CNAE = Seção C (Indústrias de Transformação)
CNAE_INDUSTRIA_PREFIXOS = {str(x) for x in range(10, 34)}

PORTE_MAP = {
    "00": "Não informado",
    "01": "Micro Empresa",
    "03": "Empresa de Pequeno Porte",
    "05": "Demais (Médio/Grande)",
}

COLS_ESTAB = [
    "cnpj_basico", "cnpj_ordem", "cnpj_dv", "identificador_matriz_filial",
    "nome_fantasia", "situacao_cadastral", "data_situacao_cadastral",
    "motivo_situacao_cadastral", "nome_cidade_exterior", "pais",
    "data_inicio_atividade", "cnae_fiscal_principal", "cnae_fiscal_secundaria",
    "tipo_logradouro", "logradouro", "numero", "complemento", "bairro",
    "cep", "uf", "municipio", "ddd1", "telefone1", "ddd2", "telefone2",
    "ddd_fax", "fax", "correio_eletronico", "situacao_especial",
    "data_situacao_especial",
]

COLS_EMPRESAS = [
    "cnpj_basico", "razao_social", "natureza_juridica",
    "qualificacao_responsavel", "capital_social", "porte_empresa",
    "ente_federativo_responsavel",
]

COLS_SOCIOS = [
    "cnpj_basico", "identificador_socio", "nome_socio", "cnpj_cpf_socio",
    "qualificacao_socio", "data_entrada_sociedade", "pais",
    "representante_legal", "nome_representante",
    "qualificacao_representante", "faixa_etaria",
]

# Único jeito confiável de saber se uma empresa é MEI de verdade: o campo
# porte_empresa NÃO distingue MEI de Micro Empresa comum (os dois vêm como
# "01"). Só o arquivo Simples tem a coluna opcao_mei.
COLS_SIMPLES = [
    "cnpj_basico", "opcao_simples", "data_opcao_simples", "data_exclusao_simples",
    "opcao_mei", "data_opcao_mei", "data_exclusao_mei",
]

CHUNKSIZE = 200_000


# ---------------------------------------------------------------------------
# Passo 1: descobrir e baixar os dados
# ---------------------------------------------------------------------------

def descobrir_pasta_mais_recente() -> str:
    resp = requests.get(BASE_URL, timeout=30)
    resp.raise_for_status()
    pastas = re.findall(r'href="(\d{4}-\d{2}-\d{2})/"', resp.text)
    if not pastas:
        raise RuntimeError(
            "Não encontrei pastas de datas no índice. O layout do site "
            "pode ter mudado — confira BASE_URL manualmente no navegador."
        )
    return sorted(pastas)[-1]


def listar_zips(pasta: str):
    url = f"{BASE_URL}{pasta}/"
    resp = requests.get(url, timeout=30)
    resp.raise_for_status()
    arquivos = re.findall(r'href="([^"?]+\.zip)"', resp.text)
    return url, arquivos


def baixar_arquivo(url: str, caminho_zip: str, nome_arquivo: str, tentativas: int = 5):
    for tentativa in range(1, tentativas + 1):
        tamanho_atual = os.path.getsize(caminho_zip) if os.path.exists(caminho_zip) else 0

        resposta_head = requests.head(url, timeout=30, allow_redirects=True)
        resposta_head.raise_for_status()
        tamanho_total = int(resposta_head.headers.get("content-length", 0))

        if tamanho_total and tamanho_atual == tamanho_total:
            return  # já está completo (de uma tentativa/execução anterior)

        if tamanho_atual > tamanho_total > 0:
            # arquivo local maior que o remoto: algo ficou incoerente, começa do zero
            tamanho_atual = 0

        modo = "ab" if tamanho_atual else "wb"
        cabecalhos = {"Range": f"bytes={tamanho_atual}-"} if tamanho_atual else {}
        acao = "retomando" if tamanho_atual else "baixando"

        try:
            print(f"{acao.capitalize()} {nome_arquivo} (tentativa {tentativa}/{tentativas}) ...")
            with requests.get(url, headers=cabecalhos, stream=True, timeout=180) as r:
                r.raise_for_status()
                with open(caminho_zip, modo) as f, tqdm(
                    total=tamanho_total, initial=tamanho_atual, unit="B", unit_scale=True, desc=nome_arquivo
                ) as bar:
                    for chunk in r.iter_content(chunk_size=1 << 16):
                        f.write(chunk)
                        bar.update(len(chunk))

            tamanho_final = os.path.getsize(caminho_zip)
            if tamanho_total and tamanho_final != tamanho_total:
                raise IOError(f"download incompleto: {tamanho_final} de {tamanho_total} bytes")
            return  # sucesso

        except (requests.exceptions.RequestException, IOError) as erro:
            print(f"  Falhou ({erro}).")
            if tentativa == tentativas:
                raise
            espera = 5 * tentativa
            print(f"  Tentando de novo em {espera}s (mantendo o que já foi baixado)...")
            time.sleep(espera)


def baixar_e_extrair(url_pasta: str, nome_arquivo: str, destino: str):
    caminho_zip = os.path.join(destino, nome_arquivo)
    baixar_arquivo(url_pasta + nome_arquivo, caminho_zip, nome_arquivo)

    with zipfile.ZipFile(caminho_zip) as z:
        info_lista = z.infolist()
        ja_extraido = all(
            os.path.exists(os.path.join(destino, info.filename))
            and os.path.getsize(os.path.join(destino, info.filename)) == info.file_size
            for info in info_lista
        )
        if ja_extraido:
            print(f"{nome_arquivo}: já extraído, pulando.")
            return
        print(f"Extraindo {nome_arquivo} ...")
        z.extractall(destino)
        print(f"{nome_arquivo}: extração concluída.")


def baixar_lote(pasta: str, destino: str) -> str:
    """Baixa (com cache) todos os grupos necessários de um lote específico para `destino`."""
    os.makedirs(destino, exist_ok=True)
    url_pasta, arquivos = listar_zips(pasta)

    grupos_necessarios = ["Estabelecimentos", "Empresas", "Socios", "Municipios", "Simples"]
    tarefas = []
    for grupo in grupos_necessarios:
        alvos = [a for a in arquivos if a.startswith(grupo)]
        if not alvos:
            print(f"Aviso: não encontrei arquivos do grupo '{grupo}' em {pasta}.")
        tarefas.extend(alvos)

    progresso("Baixando arquivos da Receita", 0, len(tarefas))
    for indice, nome_arquivo in enumerate(tarefas, start=1):
        baixar_e_extrair(url_pasta, nome_arquivo, destino)
        progresso("Baixando arquivos da Receita", indice, len(tarefas))

    return destino


def listar_lotes_locais():
    """Lotes já baixados anteriormente, identificados pela subpasta com nome de data."""
    if not os.path.isdir(CACHE_ROOT):
        return []
    return sorted(
        nome for nome in os.listdir(CACHE_ROOT)
        if os.path.isdir(os.path.join(CACHE_ROOT, nome)) and re.fullmatch(r"\d{4}-\d{2}-\d{2}", nome)
    )


def tem_cache_antigo_na_raiz() -> bool:
    """Compatibilidade com execuções antigas do script, que baixavam direto em cnpj_cache/
    sem separar por data. Se existir, oferece a opção de reaproveitar sem re-baixar."""
    if not os.path.isdir(CACHE_ROOT):
        return False
    sufixos = tuple(SUFIXOS_GRUPO.values())
    return any(f.endswith(sufixos) for f in os.listdir(CACHE_ROOT))


def escolher_lote() -> str:
    lotes_locais = listar_lotes_locais()
    tem_raiz_antiga = tem_cache_antigo_na_raiz()

    opcoes = []
    if tem_raiz_antiga:
        opcoes.append("Usar dados já baixados anteriormente (execução antiga, sem data identificada)")
    for lote in lotes_locais:
        opcoes.append(f"Usar lote já baixado: {lote}")
    opcoes.append("Verificar/baixar o lote mais recente da Receita")

    if len(opcoes) == 1:
        # Não há nada local ainda: vai direto pro download, sem perguntar.
        escolha = opcoes[0]
    else:
        escolha = questionary.select(
            "Qual lote de dados você quer usar?",
            choices=opcoes,
        ).ask()
        if escolha is None:
            raise SystemExit("Nenhuma opção selecionada. Encerrando.")

    if escolha.startswith("Usar dados já baixados anteriormente"):
        print("Usando dados locais em cnpj_cache/ (execução antiga).")
        return CACHE_ROOT

    if escolha.startswith("Usar lote já baixado"):
        pasta = escolha.rsplit(": ", 1)[-1]
        print(f"Usando lote local: {pasta}")
        return os.path.join(CACHE_ROOT, pasta)

    # "Verificar/baixar o lote mais recente da Receita"
    pasta = descobrir_pasta_mais_recente()
    destino = os.path.join(CACHE_ROOT, pasta)
    if pasta in lotes_locais:
        print(f"O lote mais recente da Receita ({pasta}) já está baixado localmente. Conferindo arquivos...")
    else:
        print(f"Lote mais recente disponível: {pasta}. Baixando o que faltar...")
    return baixar_lote(pasta, destino)


# Os arquivos extraídos dos zips NÃO mantêm o nome do zip (ex: "Estabelecimentos0.zip"
# vira algo como "K3241.K03200Y0.D60808.ESTABELE"). O jeito confiável de identificar
# cada grupo é por um marcador que aparece no nome do arquivo extraído.
SUFIXOS_GRUPO = {
    "Estabelecimentos": "ESTABELE",
    "Empresas": "EMPRECSV",
    "Socios": "SOCIOCSV",
    "Municipios": "MUNICCSV",
    "Simples": "SIMPLES",
}


def arquivos_do_grupo(cache_dir: str, grupo: str):
    marcador = SUFIXOS_GRUPO[grupo]
    return sorted(f for f in os.listdir(cache_dir) if marcador in f.upper())


# ---------------------------------------------------------------------------
# Passo 2: escolher cidades (caixas de marcação)
# ---------------------------------------------------------------------------

def normalizar(texto: str) -> str:
    texto = unicodedata.normalize("NFKD", str(texto)).encode("ascii", "ignore").decode("ascii")
    return texto.strip().upper()


def escolher_cidades():
    selecionadas = questionary.checkbox(
        "Selecione as cidades do Ceará que você quer prospectar (espaço para marcar, enter para confirmar):",
        choices=CIDADES_CEARA,
    ).ask()
    if not selecionadas:
        raise SystemExit("Nenhuma cidade selecionada. Encerrando.")
    return selecionadas


PORTE_OPCOES = [
    ("Micro Empresa", "01"),
    ("Empresa de Pequeno Porte", "03"),
    ("Demais (Médio/Grande porte)", "05"),
    ("Não informado", "00"),
]


def escolher_portes() -> set:
    selecionadas = questionary.checkbox(
        "Selecione o(s) porte(s) de empresa que você quer incluir (espaço para marcar, enter para confirmar):",
        choices=[label for label, _codigo in PORTE_OPCOES],
    ).ask()
    if not selecionadas:
        raise SystemExit("Nenhum porte selecionado. Encerrando.")
    mapa = dict(PORTE_OPCOES)
    return {mapa[label] for label in selecionadas}


def escolher_excluir_mei() -> bool:
    resposta = questionary.confirm(
        "Excluir MEI da lista? (MEI aparece como \"Micro Empresa\" mas não é o mesmo que ME/EPP)",
        default=True,
    ).ask()
    if resposta is None:
        raise SystemExit("Nenhuma resposta selecionada. Encerrando.")
    return resposta


def carregar_mapa_municipios(cache_dir: str) -> dict:
    """Retorna {codigo_municipio: nome_da_cidade}, cobrindo o Brasil inteiro
    (arquivo pequeno) — usado tanto para filtrar quanto para exibir a cidade
    na tabela final."""
    caminho = arquivos_do_grupo(cache_dir, "Municipios")
    if not caminho:
        raise FileNotFoundError("Arquivo de Municípios não encontrado no cache.")
    df = pd.read_csv(
        os.path.join(cache_dir, caminho[0]),
        sep=";", header=None, names=["codigo", "nome"],
        encoding="latin-1", dtype=str,
    )
    return dict(zip(df["codigo"], df["nome"].str.title()))


def codigos_dos_municipios(mapa_municipios: dict, cidades_selecionadas) -> set:
    alvo = {normalizar(c) for c in cidades_selecionadas}
    return {
        codigo for codigo, nome in mapa_municipios.items()
        if normalizar(nome) in alvo
    }


# ---------------------------------------------------------------------------
# Passo 3: filtrar CNAE industrial (principal ou secundário)
# ---------------------------------------------------------------------------

def eh_industrial(row) -> bool:
    principal = str(row["cnae_fiscal_principal"])[:2]
    if principal in CNAE_INDUSTRIA_PREFIXOS:
        return True
    secundarios = str(row.get("cnae_fiscal_secundaria", ""))
    if secundarios and secundarios.lower() != "nan":
        for codigo in secundarios.split(","):
            if codigo.strip()[:2] in CNAE_INDUSTRIA_PREFIXOS:
                return True
    return False


def filtrar_estabelecimentos(cache_dir: str, codigos_municipio: set) -> pd.DataFrame:
    print("Filtrando apenas empresas com situação cadastral ATIVA, nas cidades e CNAEs selecionados...")
    resultados = []
    for nome in arquivos_do_grupo(cache_dir, "Estabelecimentos"):
        caminho = os.path.join(cache_dir, nome)
        print(f"Lendo {nome} ...")
        for chunk in pd.read_csv(
            caminho, sep=";", header=None, names=COLS_ESTAB,
            encoding="latin-1", dtype=str, chunksize=CHUNKSIZE,
        ):
            chunk = chunk[chunk["municipio"].isin(codigos_municipio)]
            chunk = chunk[chunk["situacao_cadastral"] == "02"]  # 02 = ATIVA
            if chunk.empty:
                continue
            chunk = chunk[chunk.apply(eh_industrial, axis=1)]
            if not chunk.empty:
                resultados.append(chunk)
    if not resultados:
        return pd.DataFrame(columns=COLS_ESTAB)
    return pd.concat(resultados, ignore_index=True)


# ---------------------------------------------------------------------------
# Passo 4: enriquecer com Empresas e Sócio "fundador", montar tabela final
# ---------------------------------------------------------------------------

def carregar_empresas(cache_dir: str, cnpjs_basicos: set) -> pd.DataFrame:
    partes = []
    for nome in arquivos_do_grupo(cache_dir, "Empresas"):
        caminho = os.path.join(cache_dir, nome)
        for chunk in pd.read_csv(
            caminho, sep=";", header=None, names=COLS_EMPRESAS,
            encoding="latin-1", dtype=str, chunksize=CHUNKSIZE,
        ):
            chunk = chunk[chunk["cnpj_basico"].isin(cnpjs_basicos)]
            if not chunk.empty:
                partes.append(chunk)
    if not partes:
        return pd.DataFrame(columns=COLS_EMPRESAS)
    return pd.concat(partes, ignore_index=True)


def carregar_socio_fundador(cache_dir: str, cnpjs_basicos: set) -> pd.DataFrame:
    partes = []
    for nome in arquivos_do_grupo(cache_dir, "Socios"):
        caminho = os.path.join(cache_dir, nome)
        for chunk in pd.read_csv(
            caminho, sep=";", header=None, names=COLS_SOCIOS,
            encoding="latin-1", dtype=str, chunksize=CHUNKSIZE,
        ):
            chunk = chunk[chunk["cnpj_basico"].isin(cnpjs_basicos)]
            if not chunk.empty:
                partes.append(chunk)
    if not partes:
        return pd.DataFrame(columns=["cnpj_basico", "socio_fundador"])

    socios = pd.concat(partes, ignore_index=True)
    socios["data_entrada_sociedade"] = pd.to_datetime(
        socios["data_entrada_sociedade"], format="%Y%m%d", errors="coerce"
    )
    socios = socios.sort_values("data_entrada_sociedade")
    fundadores = socios.groupby("cnpj_basico").first().reset_index()
    fundadores = fundadores.rename(columns={"nome_socio": "socio_fundador"})
    return fundadores[["cnpj_basico", "socio_fundador"]]


def carregar_cnpjs_mei(cache_dir: str, cnpjs_basicos: set) -> set:
    """Retorna o subconjunto de cnpjs_basicos que estão com opção pelo MEI
    ativa (opcao_mei = 'S'). É o único jeito de diferenciar MEI de uma Micro
    Empresa comum — o campo porte_empresa não faz essa distinção."""
    arquivos = arquivos_do_grupo(cache_dir, "Simples")
    if not arquivos:
        print("Aviso: arquivo Simples não encontrado no cache — não foi possível identificar MEI.")
        return set()

    mei = set()
    for nome in arquivos:
        caminho = os.path.join(cache_dir, nome)
        for chunk in pd.read_csv(
            caminho, sep=";", header=None, names=COLS_SIMPLES,
            encoding="latin-1", dtype=str, chunksize=CHUNKSIZE,
        ):
            chunk = chunk[chunk["cnpj_basico"].isin(cnpjs_basicos)]
            chunk = chunk[chunk["opcao_mei"] == "S"]
            if not chunk.empty:
                mei.update(chunk["cnpj_basico"])
    return mei


def montar_telefone(ddd, numero) -> str:
    ddd = "" if pd.isna(ddd) else str(ddd).strip()
    numero = "" if pd.isna(numero) else str(numero).strip()
    if not ddd or not numero:
        return ""
    return f"({ddd}) {numero}"


def montar_capital_social(valor) -> str:
    """A Receita grava capital social como texto com vírgula decimal
    (ex: "150000,00"). Normaliza para o formato com ponto (ex: "150000.00")
    que o Postgres/Supabase espera numa coluna numeric."""
    if pd.isna(valor):
        return ""
    texto = str(valor).strip()
    if not texto:
        return ""
    return texto.replace(".", "").replace(",", ".")


def montar_tabela_final(estab, empresas, fundadores, mapa_municipios, portes_selecionados) -> pd.DataFrame:
    df = estab.merge(empresas, on="cnpj_basico", how="left")
    df = df.merge(fundadores, on="cnpj_basico", how="left")

    df["cnpj"] = df["cnpj_basico"] + df["cnpj_ordem"] + df["cnpj_dv"]
    df["telefone"] = df.apply(lambda r: montar_telefone(r["ddd1"], r["telefone1"]), axis=1)
    df["porte"] = df["porte_empresa"].map(PORTE_MAP).fillna("Não informado")
    df["nome"] = df["razao_social"].fillna(df["nome_fantasia"])
    df["cidade"] = df["municipio"].map(mapa_municipios).fillna("")
    df["capital_social_normalizado"] = df["capital_social"].apply(montar_capital_social)

    if portes_selecionados:
        # porte_empresa vem vazio ("") em algumas linhas quando Empresas não bateu
        # o join; nesse caso considera como "00" (não informado) para o filtro.
        codigo_porte = df["porte_empresa"].fillna("00").replace("", "00")
        df = df[codigo_porte.isin(portes_selecionados)]

    final = df[[
        "cidade", "nome", "telefone", "correio_eletronico", "cnpj",
        "socio_fundador", "porte", "nome_fantasia", "cnae_fiscal_principal",
        "cnae_fiscal_secundaria", "capital_social_normalizado",
    ]]
    final = final.rename(columns={
        "correio_eletronico": "email",
        "socio_fundador": "socio",
        "cnae_fiscal_principal": "cnae_principal",
        "cnae_fiscal_secundaria": "cnae_secundario",
        "capital_social_normalizado": "capital_social",
    })
    return final.drop_duplicates(subset="cnpj").reset_index(drop=True)


# ---------------------------------------------------------------------------
# Passo 5: enviar os resultados para o sistema Prospecção (Supabase)
# ---------------------------------------------------------------------------

def limpar_valor(valor):
    """Converte NaN/vazio do pandas em None, e o resto em string limpa."""
    if valor is None or pd.isna(valor):
        return None
    texto = str(valor).strip()
    return texto if texto else None


def login_supabase(email: str | None = None, senha: str | None = None):
    supabase = create_client(SUPABASE_URL, SUPABASE_KEY)
    if email and senha:
        # Modo headless (chamado pelo popup do app desktop): credenciais já
        # vêm prontas, sem perguntar nada no terminal.
        supabase.auth.sign_in_with_password({"email": email, "password": senha})
        return supabase

    print("\nPara enviar os resultados para o sistema Prospecção, faça login com sua conta.")
    email = input("E-mail cadastrado: ").strip()
    senha = getpass.getpass("Senha: ")
    supabase.auth.sign_in_with_password({"email": email, "password": senha})
    return supabase


def enviar_para_supabase(supabase, tabela: pd.DataFrame, tamanho_lote: int = 500):
    registros = []
    for _, row in tabela.iterrows():
        cnpj = limpar_valor(row["cnpj"])
        if not cnpj:
            continue  # não dá pra gravar sem a chave única
        capital_social = limpar_valor(row.get("capital_social"))
        registros.append({
            "cnpj": cnpj,
            "nome": limpar_valor(row["nome"]),
            "nome_fantasia": limpar_valor(row["nome_fantasia"]),
            "cidade": limpar_valor(row["cidade"]),
            "telefone": limpar_valor(row["telefone"]),
            "email": limpar_valor(row["email"]),
            "socio": limpar_valor(row["socio"]),
            "porte": limpar_valor(row["porte"]),
            "cnae_principal": limpar_valor(row["cnae_principal"]),
            "cnae_secundario": limpar_valor(row.get("cnae_secundario")),
            "capital_social": float(capital_social) if capital_social else None,
        })

    total = len(registros)
    progresso("Enviando para o Supabase", 0, total)
    print(f"Enviando {total} empresas para o Supabase...", flush=True)
    falhas = 0
    for inicio in range(0, total, tamanho_lote):
        pedaco = registros[inicio:inicio + tamanho_lote]
        enviados_ate_agora = min(inicio + tamanho_lote, total)
        # Usa a função atualizar_dados_receita (RPC) em vez de escrever
        # direto na tabela: um upsert direto é bloqueado pela política de
        # UPDATE sempre que o lote contém alguma empresa "travada"
        # (prospectada = true por outro consultor), derrubando o lote
        # inteiro. A função contorna essa trava só para os campos vindos
        # da Receita, sem nunca tocar em prospectada/prospectada_por.
        try:
            supabase.rpc("atualizar_dados_receita", {"p_registros": pedaco}).execute()
            print(f"  {enviados_ate_agora}/{total} enviadas", flush=True)
        except Exception as erro:
            falhas += 1
            print(f"  Aviso: lote {inicio}-{inicio + len(pedaco)} falhou e foi pulado ({erro}). Continuando com os próximos...", flush=True)
        progresso("Enviando para o Supabase", enviados_ate_agora, total)
    if falhas:
        print(f"Envio para o Supabase concluído com {falhas} lote(s) com falha (veja os avisos acima).", flush=True)
    else:
        print("Envio para o Supabase concluído.", flush=True)


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def analisar_argumentos():
    parser = argparse.ArgumentParser(add_help=True)
    parser.add_argument("--headless", action="store_true",
                         help="Roda sem perguntas de terminal (usado pelo popup do app desktop).")
    parser.add_argument("--cidades", default="",
                         help="Lista separada por vírgula, ex: 'Fortaleza,Caucaia' (obrigatório com --headless).")
    parser.add_argument("--portes", default="",
                         help="Lista separada por vírgula com os rótulos de PORTE_OPCOES (obrigatório com --headless).")
    parser.add_argument("--excluir-mei", action="store_true", help="Exclui MEI da lista.")
    parser.add_argument("--lote", default="",
                         help="Data (AAAA-MM-DD) de um lote já baixado em cnpj_cache/. Vazio = baixa/usa o mais recente.")
    parser.add_argument("--email", default="", help="E-mail da conta do sistema Prospecção (modo --headless).")
    parser.add_argument("--senha", default="", help="Senha da conta do sistema Prospecção (modo --headless).")
    return parser.parse_args()


def escolher_lote_headless(data_lote: str) -> str:
    if data_lote:
        destino = os.path.join(CACHE_ROOT, data_lote)
        if os.path.isdir(destino):
            print(f"Usando lote local: {data_lote}", flush=True)
            return destino
        print(f"Lote '{data_lote}' não encontrado localmente, baixando de novo...", flush=True)
        return baixar_lote(data_lote, destino)

    pasta = descobrir_pasta_mais_recente()
    destino = os.path.join(CACHE_ROOT, pasta)
    print(f"Lote mais recente disponível: {pasta}. Baixando o que faltar...", flush=True)
    return baixar_lote(pasta, destino)


def main():
    args = analisar_argumentos()

    if args.headless:
        cidades = [c.strip() for c in args.cidades.split(",") if c.strip()]
        rotulos_porte = [p.strip() for p in args.portes.split(",") if p.strip()]
        mapa_porte = dict(PORTE_OPCOES)
        portes = {mapa_porte[r] for r in rotulos_porte if r in mapa_porte}
        excluir_mei = args.excluir_mei
        cache_dir = escolher_lote_headless(args.lote)

        if not cidades:
            raise SystemExit("Nenhuma cidade informada (--cidades). Encerrando.")
        if not portes:
            raise SystemExit("Nenhum porte informado/reconhecido (--portes). Encerrando.")
    else:
        cidades = escolher_cidades()
        portes = escolher_portes()
        excluir_mei = escolher_excluir_mei()
        cache_dir = escolher_lote()

    mapa_municipios = carregar_mapa_municipios(cache_dir)
    codigos_municipio = codigos_dos_municipios(mapa_municipios, cidades)
    if not codigos_municipio:
        raise SystemExit(
            "Nenhum código de município encontrado para as cidades selecionadas. "
            "Confira a grafia em CIDADES_CEARA contra o arquivo Municipios."
        )

    progresso("Filtrando estabelecimentos e montando lista")
    estab = filtrar_estabelecimentos(cache_dir, codigos_municipio)
    print(f"\n{len(estab)} estabelecimentos industriais ativos encontrados nas cidades selecionadas.", flush=True)

    if estab.empty:
        print("Nenhum resultado. Encerrando.", flush=True)
        return

    if excluir_mei:
        cnpjs_antes_mei = set(estab["cnpj_basico"])
        cnpjs_mei = carregar_cnpjs_mei(cache_dir, cnpjs_antes_mei)
        if cnpjs_mei:
            estab = estab[~estab["cnpj_basico"].isin(cnpjs_mei)]
            print(f"{len(cnpjs_mei)} MEI removidos da lista. Restaram {len(estab)} estabelecimentos.", flush=True)
        if estab.empty:
            print("Nenhum resultado depois de excluir MEI. Encerrando.", flush=True)
            return

    cnpjs_basicos = set(estab["cnpj_basico"])
    empresas = carregar_empresas(cache_dir, cnpjs_basicos)
    fundadores = carregar_socio_fundador(cache_dir, cnpjs_basicos)

    tabela = montar_tabela_final(estab, empresas, fundadores, mapa_municipios, portes)
    if tabela.empty:
        print("Nenhuma empresa restante depois do filtro de porte. Encerrando sem gerar CSV.", flush=True)
        return

    tabela.to_csv(SAIDA_CSV, index=False, encoding="utf-8-sig")
    print(f"CSV local salvo: {SAIDA_CSV} ({len(tabela)} empresas)", flush=True)

    try:
        supabase = login_supabase(args.email if args.headless else None, args.senha if args.headless else None)
        enviar_para_supabase(supabase, tabela)
        progresso("Concluído", 1, 1)
    except Exception as erro:
        print(f"\nAviso: não consegui enviar para o Supabase ({erro}).", flush=True)
        print("O CSV local foi salvo normalmente — nada foi perdido.", flush=True)


if __name__ == "__main__":
    main()
