# ADR-0015 — Feature flags: Unleash no ambiente local, variável de ambiente no Render

- **Status:** Aceito
- **Data:** 2026-11-10
- **Decisor:** Chagas Barros

## Contexto e problema

O projeto precisa de **uma feature flag** com Unleash: `catalog-cache-enabled`, que liga e desliga o cache do catálogo (ADR-0014). Ela serve como **kill switch** e permite o antes e depois do k6 (`CLAUDE.md`, seção 7).

O Unleash é um servidor com banco de dados próprio. No compose local isso é fácil. No Render, com plano gratuito (ADR-0017), seriam mais um serviço web e mais um PostgreSQL por ambiente. O PostgreSQL gratuito do Render expira em 30 dias.

## Fatores de decisão

- Kill switch demonstrável na apresentação
- Custo e manutenção no Render (plano gratuito)
- O código não deve depender de onde a flag vem
- A flag não pode adicionar latência nem derrubar a API se o servidor de flags cair

## Opções consideradas

1. **Unleash local e variável de ambiente no Render**, atrás de uma interface.
2. **Unleash também no Render**, com um serviço e um banco por ambiente.

## Decisão

**Opção 1.** A interface `FeatureFlags` (`src/shared/flags/`) responde `isEnabled(flag)` de forma **síncrona** e tem duas implementações:

- **`UnleashFeatureFlags`:** o SDK oficial (`unleash-client`) consulta o servidor a cada 5 s e mantém as flags em memória. Assim, `isEnabled` nunca espera a rede. Se o Unleash estiver fora do ar ou a flag não existir, vale o valor padrão.
- **`EnvFeatureFlags`:** lê `CATALOG_CACHE_ENABLED`, que só muda com reinício.

A escolha é feita no boot. Com `UNLEASH_URL` definida, o projeto usa o Unleash, e nesse caso `UNLEASH_API_TOKEN` é obrigatória; sem ela, usa a variável de ambiente. O padrão é `CATALOG_CACHE_ENABLED=true`.

**Local:** o compose sobe o Unleash 7 com um **PostgreSQL próprio**, para que os dados das flags fiquem separados dos dados de negócio. O job `unleash-setup` cria a flag ligada em `development`. Os _tokens_ no compose são fixos e **só para uso local**, como a senha do banco local; em staging e produção não existe Unleash.

**Render:** desligar o cache é mudar `CATALOG_CACHE_ENABLED` no painel. O Render reinicia o serviço com o novo valor, o que leva cerca de 1 minuto.

## Consequências

- **Positivas:**
  - O kill switch funciona ao vivo no ambiente local: desligar a flag na interface do Unleash faz as leituras irem ao banco em até cerca de 5 s, sem reiniciar (verificado em 10/11).
  - Nada de servidor de flags para pagar ou manter no Render.
  - O código de negócio não conhece o Unleash. Trocar de fornecedor de flags é escrever outra implementação da interface.
  - Os nomes das flags são um tipo (`Flag`): um nome digitado errado vira erro de compilação, não uma flag silenciosamente desligada.
- **Negativas:**
  - **Em produção, o kill switch não é instantâneo:** leva cerca de 1 minuto e reinicia o processo. Para um cache isso é aceitável; para uma flag de liberação gradual (por porcentagem de usuários), não seria.
  - Os dois ambientes têm comportamentos diferentes para a mesma flag, e isso precisa ser lembrado ao operar.
  - Mais dois contêineres no compose local (Unleash e o banco dele).

## Alternativas descartadas

- **Unleash também no Render:** daria o kill switch instantâneo em produção e liberação gradual de verdade, mas exigiria um serviço web e um PostgreSQL a mais **por ambiente**. O PostgreSQL gratuito expira em 30 dias e o serviço gratuito "dorme" após 15 minutos sem tráfego, quando a API mais precisaria dele. Também acrescentaria um segredo (token de API) por ambiente. O custo não se justifica para uma única flag de cache.
