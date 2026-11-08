# ADR-0002 — Monólito modular com fronteiras garantidas por lint

- **Status:** Aceito
- **Data:** 2026-11-08
- **Decisor:** Chagas Barros

## Contexto e problema

O marketplace tem três áreas de negócio com responsabilidades bem diferentes:

- **catálogo:** produtos, preço e estoque;
- **pedidos:** criação, estados e cancelamento;
- **pagamentos:** cobrança por meio de gateways.

O projeto é individual, tem prazo curto (entrega em 13/11/2026) e precisa demonstrar arquitetura documentada, testes, observabilidade e desempenho sob carga (k6). Precisamos decidir como organizar o sistema: um serviço só, vários serviços, ou um meio-termo.

## Fatores de decisão

- Separação clara de responsabilidades (cada área evolui sem quebrar as outras)
- Custo operacional para uma pessoa só (deploy, observabilidade, testes)
- Consistência dos dados (reserva de estoque, estados do pedido)
- Desempenho: latência de rede entre componentes afeta o p95
- Possibilidade de extrair um módulo para um serviço no futuro
- Prazo curto

## Opções consideradas

1. **Monólito modular:** um único deploy, com módulos isolados por fronteiras explícitas
2. Microserviços: um serviço por área, cada um com seu banco e seu deploy
3. Monólito tradicional em camadas (controllers, services e repositories globais, sem módulos)

## Decisão

**Monólito modular.**

Estrutura (`CLAUDE.md`, seção 4): `src/modules/{catalog,orders,payments}` mais um `src/shared` técnico. Cada módulo tem as camadas `domain/`, `application/`, `infrastructure/` e `http/`, e um `index.ts` que é a **única porta de entrada**.

As fronteiras **não são só convenção**: elas são verificadas automaticamente.

| Regra                                                               | Como é garantida                                                                    |
| ------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Um módulo só importa outro pelo `index.ts`                          | `eslint-plugin-boundaries` (quebra o lint e o CI)                                   |
| `domain/` não depende de framework (Prisma, Fastify, Redis, BullMQ) | `no-restricted-imports` no ESLint                                                   |
| Camadas só dependem "para dentro" (http → application → domain)     | `eslint-plugin-boundaries`                                                          |
| Cada módulo é dono das suas tabelas                                 | Um schema do PostgreSQL por módulo, sem FK entre schemas (ADR-0005)                 |
| Módulos trocam dados simples, não entidades                         | `CatalogApi` expõe `ProductSnapshot`, nunca a entidade `Product`                    |
| `orders` ↔ `payments` de forma assíncrona                           | Fila BullMQ (`OrderPlaced`, resultado do pagamento), com worker separado (ADR-0010) |

A composição acontece só em `src/server.ts` (API), `src/worker.ts` (worker) e `src/app.ts`. São os únicos lugares que escolhem as implementações concretas (Prisma, BullMQ, providers).

**Evidência:** durante o desenvolvimento, o lint barrou um teste do módulo `orders` que importava o `domain` do `catalog` diretamente. A correção foi usar só a interface pública `CatalogApi`.

## Consequências

- **Positivas:**
  - Um deploy, um banco e um repositório: operação compatível com uma pessoa e com o prazo.
  - Chamadas entre módulos síncronos (`orders` → `catalog`) são chamadas de função, sem rede. Isso ajuda o p95 e evita falhas parciais de rede.
  - A reserva de estoque continua consistente com um `UPDATE` atômico no mesmo banco (ADR-0009), sem sagas distribuídas.
  - As fronteiras explícitas (`index.ts`, schemas próprios, fila) deixam a extração de um módulo para um serviço como trabalho mecânico: trocar a chamada de função por HTTP e o schema por um banco próprio.
- **Negativas:**
  - Um módulo não escala sozinho: a API escala inteira. O worker, sim, escala separado (ADR-0010).
  - Uma falha grave (por exemplo, vazamento de memória) num módulo derruba o processo inteiro.
  - A disciplina depende do lint estar no CI: um `eslint-disable` mal usado pode furar a fronteira.
  - Todos os módulos compartilham a mesma versão de dependências (Node, Prisma, Fastify).

## Alternativas descartadas

- **Microserviços:** dariam escala e deploy independentes por área. Foram descartados porque multiplicam o custo operacional (3 deploys, 3 bancos, descoberta de serviços, tracing distribuído entre todos), trocam chamadas locais por chamadas de rede (pior p95 e novas falhas parciais) e obrigariam a coordenar a reserva de estoque com sagas ou compensações distribuídas. Para uma pessoa, em uma semana, o custo supera o benefício. O monólito modular mantém a porta aberta: se um módulo precisar escalar sozinho, as fronteiras já existem.
- **Monólito tradicional em camadas:** seria o mais rápido de começar, mas sem fronteiras entre áreas de negócio. Com o tempo, qualquer service acessaria qualquer tabela (JOINs entre pedidos e catálogo, por exemplo), e a separação de responsabilidades que o curso pede não seria demonstrável.
