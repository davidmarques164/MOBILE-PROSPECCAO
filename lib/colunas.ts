export type ColunaId =
  | "nome"
  | "nome_fantasia"
  | "cidade"
  | "telefone"
  | "email"
  | "cnpj"
  | "socio"
  | "porte"
  | "cnae_principal"
  | "situacao"
  | "capital_social";

export type DefinicaoColuna = {
  id: ColunaId;
  rotulo: string;
};

export const TODAS_COLUNAS: DefinicaoColuna[] = [
  { id: "nome", rotulo: "Razão Social" },
  { id: "nome_fantasia", rotulo: "Nome Fantasia" },
  { id: "cidade", rotulo: "Cidade" },
  { id: "telefone", rotulo: "Telefone" },
  { id: "email", rotulo: "E-mail" },
  { id: "cnpj", rotulo: "CNPJ" },
  { id: "socio", rotulo: "Sócio" },
  { id: "porte", rotulo: "Porte" },
  { id: "cnae_principal", rotulo: "CNAE Principal" },
  { id: "situacao", rotulo: "Situação" },
  { id: "capital_social", rotulo: "Capital Social" },
];

export const ORDEM_PADRAO: ColunaId[] = TODAS_COLUNAS.map((c) => c.id);

export const MENSAGEM_PADRAO =
  "Boa tarde! Aqui é o {consultor}, consultor parceiro do SENAI. Consigo falar com o responsável pela {empresa}?";

/** Garante que toda coluna nova adicionada no futuro apareça mesmo em
 * preferências salvas antigas, sem quebrar a ordem que o usuário escolheu. */
export function normalizarOrdem(ordemSalva: string[] | undefined): ColunaId[] {
  const validos = new Set(ORDEM_PADRAO as string[]);
  const atual = (ordemSalva ?? []).filter((id): id is ColunaId => validos.has(id));
  const faltando = ORDEM_PADRAO.filter((id) => !atual.includes(id));
  return [...atual, ...faltando];
}
