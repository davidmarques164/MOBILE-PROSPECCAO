-- ============================================================================
-- Migration: capital social + "inválida" por usuário + listagem via RPC
-- ============================================================================
-- Rode este arquivo no SQL Editor do Supabase (painel do projeto > SQL Editor
-- > New query > cole o conteúdo > Run). Pode rodar mais de uma vez sem
-- problema (todos os comandos são "IF NOT EXISTS" / "OR REPLACE").
-- ============================================================================

-- 1) Capital social (vem do arquivo "Empresas" da Receita, já baixado pelo
--    cnpj_prospeccao.py mas até agora não era enviado para o banco).
alter table public.empresas
  add column if not exists capital_social numeric;

-- 2) "Inválida" deixa de ser global (coluna sem_requisitos) e passa a ser
--    por usuário: cada consultor marca uma empresa como inválida só para si.
--    A coluna antiga sem_requisitos/sem_requisitos_por/sem_requisitos_em é
--    mantida na tabela (não apagamos dado histórico), mas o app passa a
--    ignorá-la e usar esta tabela nova.
create table if not exists public.invalidas (
  empresa_id  uuid not null references public.empresas(id) on delete cascade,
  usuario_id  uuid not null references public.profiles(id) on delete cascade,
  criado_em   timestamptz not null default now(),
  primary key (empresa_id, usuario_id)
);

alter table public.invalidas enable row level security;

drop policy if exists "invalidas: cada um ve as proprias" on public.invalidas;
create policy "invalidas: cada um ve as proprias"
  on public.invalidas for select
  using (usuario_id = auth.uid());

drop policy if exists "invalidas: cada um marca as proprias" on public.invalidas;
create policy "invalidas: cada um marca as proprias"
  on public.invalidas for insert
  with check (usuario_id = auth.uid());

drop policy if exists "invalidas: cada um desmarca as proprias" on public.invalidas;
create policy "invalidas: cada um desmarca as proprias"
  on public.invalidas for delete
  using (usuario_id = auth.uid());

-- 3) Observações: garante (defesa em profundidade — o app já filtra na
--    consulta) que cada usuário só lê/edita as observações que ele mesmo
--    escreveu. Ajuste o nome das policies antigas se o seu banco já tiver
--    outras com nomes diferentes.
alter table public.observacoes enable row level security;

drop policy if exists "observacoes: cada um ve as proprias" on public.observacoes;
create policy "observacoes: cada um ve as proprias"
  on public.observacoes for select
  using (usuario_id = auth.uid());

drop policy if exists "observacoes: cada um insere as proprias" on public.observacoes;
create policy "observacoes: cada um insere as proprias"
  on public.observacoes for insert
  with check (usuario_id = auth.uid());

-- 4) Função de listagem paginada, com filtros e o campo calculado
--    "invalida" (true só se O USUÁRIO QUE ESTÁ CHAMANDO marcou essa
--    empresa como inválida — outro usuário não vê isso). Também devolve
--    o total de registros (para paginação) em cada linha, na coluna
--    total_count, usando count(*) over() — assim dá pra pedir tudo numa
--    única chamada.
create or replace function public.listar_empresas(
  p_cidade            text default null,
  p_porte             text default null,
  p_busca             text default null,
  p_prospeccao        text default 'todas',   -- 'todas' | 'prospectadas' | 'nao_prospectadas'
  p_validade          text default 'todas',   -- 'todas' | 'validas' | 'invalidas'
  p_ordenar_por        text default 'nome',
  p_ordenar_direcao   text default 'asc',
  p_limite            int  default 500,
  p_offset            int  default 0
)
returns table (
  id                  uuid,
  cnpj                text,
  nome                text,
  nome_fantasia       text,
  cidade              text,
  telefone            text,
  email               text,
  socio               text,
  porte               text,
  cnae_principal      text,
  cnae_secundario     text,
  situacao            text,
  capital_social       numeric,
  prospectada         boolean,
  prospectada_por     uuid,
  prospectada_em      timestamptz,
  criado_em           timestamptz,
  invalida            boolean,
  total_count         bigint
)
language sql
security invoker
stable
as $$
  select
    e.id, e.cnpj, e.nome, e.nome_fantasia, e.cidade, e.telefone, e.email,
    e.socio, e.porte, e.cnae_principal, e.cnae_secundario::text, e.situacao,
    e.capital_social, e.prospectada, e.prospectada_por, e.prospectada_em,
    e.criado_em,
    exists (
      select 1 from public.invalidas i
      where i.empresa_id = e.id and i.usuario_id = auth.uid()
    ) as invalida,
    count(*) over() as total_count
  from public.empresas e
  where
    (p_cidade is null or p_cidade = '' or e.cidade ilike p_cidade)
    and (p_porte is null or p_porte = '' or e.porte = p_porte)
    and (
      p_busca is null or p_busca = ''
      or e.nome ilike '%' || p_busca || '%'
      or e.nome_fantasia ilike '%' || p_busca || '%'
    )
    and (
      p_prospeccao = 'todas'
      or (p_prospeccao = 'prospectadas' and e.prospectada = true)
      or (p_prospeccao = 'nao_prospectadas' and e.prospectada = false)
    )
    and (
      p_validade = 'todas'
      or (
        p_validade = 'invalidas' and exists (
          select 1 from public.invalidas i
          where i.empresa_id = e.id and i.usuario_id = auth.uid()
        )
      )
      or (
        p_validade = 'validas' and not exists (
          select 1 from public.invalidas i
          where i.empresa_id = e.id and i.usuario_id = auth.uid()
        )
      )
    )
  order by
    case when p_ordenar_direcao = 'asc' and p_ordenar_por = 'nome' then e.nome end asc,
    case when p_ordenar_direcao = 'desc' and p_ordenar_por = 'nome' then e.nome end desc,
    case when p_ordenar_direcao = 'asc' and p_ordenar_por = 'nome_fantasia' then e.nome_fantasia end asc,
    case when p_ordenar_direcao = 'desc' and p_ordenar_por = 'nome_fantasia' then e.nome_fantasia end desc,
    case when p_ordenar_direcao = 'asc' and p_ordenar_por = 'cidade' then e.cidade end asc,
    case when p_ordenar_direcao = 'desc' and p_ordenar_por = 'cidade' then e.cidade end desc,
    case when p_ordenar_direcao = 'asc' and p_ordenar_por = 'telefone' then e.telefone end asc,
    case when p_ordenar_direcao = 'desc' and p_ordenar_por = 'telefone' then e.telefone end desc,
    case when p_ordenar_direcao = 'asc' and p_ordenar_por = 'email' then e.email end asc,
    case when p_ordenar_direcao = 'desc' and p_ordenar_por = 'email' then e.email end desc,
    case when p_ordenar_direcao = 'asc' and p_ordenar_por = 'cnpj' then e.cnpj end asc,
    case when p_ordenar_direcao = 'desc' and p_ordenar_por = 'cnpj' then e.cnpj end desc,
    case when p_ordenar_direcao = 'asc' and p_ordenar_por = 'socio' then e.socio end asc,
    case when p_ordenar_direcao = 'desc' and p_ordenar_por = 'socio' then e.socio end desc,
    case when p_ordenar_direcao = 'asc' and p_ordenar_por = 'porte' then e.porte end asc,
    case when p_ordenar_direcao = 'desc' and p_ordenar_por = 'porte' then e.porte end desc,
    case when p_ordenar_direcao = 'asc' and p_ordenar_por = 'cnae_principal' then e.cnae_principal end asc,
    case when p_ordenar_direcao = 'desc' and p_ordenar_por = 'cnae_principal' then e.cnae_principal end desc,
    case when p_ordenar_direcao = 'asc' and p_ordenar_por = 'situacao' then e.situacao end asc,
    case when p_ordenar_direcao = 'desc' and p_ordenar_por = 'situacao' then e.situacao end desc,
    e.nome asc
  limit p_limite offset p_offset;
$$;

grant execute on function public.listar_empresas to authenticated;

-- 5) Expiração automática do "prospectada" após 1 mês (item 9 do pedido:
--    "a empresa permanecerá prospectada por um mês, depois volta a ficar
--    disponível"). Isso roda diariamente via pg_cron, se a extensão
--    estiver disponível no seu projeto (Database > Extensions > pg_cron).
--    Se não estiver disponível no seu plano, comente/pule este bloco — o
--    aviso na tela continua valendo, só a liberação automática que não
--    vai rodar (dá pra liberar manualmente rodando a função abaixo).
create or replace function public.liberar_prospeccoes_vencidas()
returns void
language sql
security definer
as $$
  update public.empresas
  set prospectada = false, prospectada_por = null, prospectada_em = null
  where prospectada = true
    and prospectada_em is not null
    and prospectada_em < now() - interval '30 days';
$$;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule(
      'liberar-prospeccoes-vencidas',
      '0 3 * * *', -- todo dia às 03:00
      $$select public.liberar_prospeccoes_vencidas();$$
    );
  end if;
exception when others then
  -- pg_cron não disponível neste projeto/plano: sem problema, só não
  -- agenda a liberação automática. Rode manualmente quando quiser:
  -- select public.liberar_prospeccoes_vencidas();
  null;
end $$;
