# CLAUDE.md — TCC Fullcycle (Geração Tech) · Projeto A (Avançado)

> Instruções para o Claude Code. Leia este arquivo inteiro antes de qualquer tarefa.

## 1. Contexto

- **O quê:** Trabalho de Conclusão do curso Fullcycle (Geração Tech). Individual. Autor: Chagas Barros.
- **Nível:** Projeto A — Avançado. Marketplace como **monólito modular** (catálogo, pedidos, pagamento), arquitetura documentada e k6 em 3 estágios.
- **Prazo de entrega:** 13/11/2026. **Apresentação:** 16/11/2026.
- **Referência teórica:** Ebook de System Design, módulo 4.
- **Regra do curso sobre IA:** a IA sugere, **a decisão é do autor**. Código que o autor não sabe explicar não conta.

## 2. Como você (Claude Code) deve trabalhar neste repo

1. **Explique antes de decidir.** Em toda escolha relevante (lib, padrão, estrutura), apresente 2 opções com trade-off em poucas linhas e espere a minha decisão. Não troque a stack da seção 3 sem pedir.
2. **Código explicável.** Prefira código simples e legível a código "esperto". Ao terminar uma tarefa, resuma em 3–5 linhas o que foi feito e por quê, para eu conseguir defender na apresentação.
3. **Registre decisões.** Decisão de arquitetura → novo ADR em `docs/adr/` (template MADR). Prompt que mudou o rumo do projeto → entrada em `docs/ia.md` (prompt, o que a IA sugeriu, o que eu decidi).
4. **Passos pequenos.** Uma tarefa por vez, com commit ao final. Rode `npm run lint`, `npm run typecheck` e `npm test` antes de dizer que terminou.
5. **Respeite as fronteiras dos módulos** (seção 4). Se uma tarefa exigir quebrar uma fronteira, pare e me pergunte.
6. **Nunca** coloque segredos no código, em `.env` versionado ou em logs.
7. Escreva código, nomes e comentários em **inglês**; documentação (`docs/`, README, ADRs) em **português**.

## 3. Stack (padrão — confirmar)

| Área                   | Escolha                                        | Observação                                    |
| ---------------------- | ---------------------------------------------- | --------------------------------------------- |
| Runtime / linguagem    | Node.js 22 LTS + TypeScript (strict)           |                                               |
| HTTP                   | **Fastify** ✅ decidido                        | ADR-0001 (descartado: NestJS)                 |
| Banco                  | PostgreSQL 16                                  |                                               |
| ORM / Database Pattern | Prisma + **Repository**                        | ⏳ provisório, depende do módulo 4 (seção 12) |
| Cache                  | Redis (cache-aside com TTL)                    |                                               |
| Fila                   | BullMQ (sobre Redis)                           | Processamento de pagamento assíncrono         |
| Validação / config     | Zod                                            | Config validada no boot                       |
| Testes                 | Vitest + Testcontainers + Pact                 | Unit, integração, contrato                    |
| Coverage               | @vitest/coverage-v8 (+ Codecov opcional)       | Mínimo declarado no `vitest.config.ts`        |
| Lint                   | ESLint + Prettier + `eslint-plugin-boundaries` | Boundaries garante a fronteira dos módulos    |
| Logs                   | pino (JSON estruturado)                        |                                               |
| Métricas               | prom-client → Prometheus + Grafana             | Métricas RED                                  |
| Tracing                | OpenTelemetry → Jaeger                         |                                               |
| Feature flag           | Unleash (self-hosted no compose)               |                                               |
| OpenAPI                | OpenAPI 3.1 + Spectral (lint) + Swagger UI     |                                               |
| CI                     | GitHub Actions                                 | lint, typecheck, testes, coverage, SCA        |
| SCA / segredos         | npm audit + Trivy + gitleaks                   |                                               |
| Deploy                 | Render                                         | Ambientes `staging` e `production`            |
| Carga                  | k6 + clinic.js + EXPLAIN ANALYZE               |                                               |
| Diagramas              | Mermaid (C4)                                   |                                               |

## 4. Arquitetura — monólito modular

### Estrutura mínima exigida pelo curso (não remover nem renomear)

```
.
├── docker-compose.yml
├── README.md
├── docs/
│   ├── adr/0001-decisao.md      # ADRs numerados: 0001-*.md, 0002-*.md ...
│   ├── c4/contexto.md           # C4 de contexto (+ c4/conteiner.md)
│   ├── openapi.yaml             # arquivo ÚNICO: catálogo + pedido
│   └── desempenho.md
├── src/
├── tests/
└── .github/workflows/ci.yml
```

Arquivos extras permitidos e esperados: `docs/ia.md`, `docs/slo.md`, `docs/apresentacao.md`, `CONTRIBUTORS.md`, `k6/`, `ops/` (Prometheus/Grafana), `prisma/`.

### Módulos

Três módulos de negócio + um `shared` técnico. **Fronteira explícita, não pastas soltas.**

```
src/
  modules/
    catalog/     # produtos, estoque, preço
    orders/      # carrinho → pedido, estados do pedido
    payments/    # cobrança, gateways, webhooks
  shared/        # infra transversal: db, cache, queue, logger, config, telemetry, flags
  app.ts         # composição: registra módulos e plugins
  server.ts      # bootstrap
```

Cada módulo segue a mesma estrutura interna:

```
modules/<name>/
  domain/          # entidades, value objects, regras (sem dependência de framework)
  application/     # casos de uso (services), interfaces de repositório (ports)
  infrastructure/  # Prisma repositories, adapters, consumers da fila
  http/            # rotas Fastify, schemas Zod, mapeamento para OpenAPI
  index.ts         # API PÚBLICA do módulo — única porta de entrada
```

**Regras de fronteira (aplicadas pelo ESLint, quebram o CI):**

- Um módulo só importa de outro pelo `index.ts` dele. Proibido `modules/orders/...` importar `modules/catalog/domain/...`.
- `domain/` não importa Prisma, Fastify, Redis nem nada de `infrastructure/`.
- Cada módulo é dono das suas tabelas. Sem JOIN entre tabelas de módulos diferentes; use a API pública do outro módulo.
- Comunicação `orders → payments` é assíncrona via fila (evento `OrderPlaced`). `payments → orders` devolve o resultado via fila (`PaymentApproved` / `PaymentFailed`).

**SOLID + 1 design pattern justificado (⏳ provisório até a revisão do módulo 4 em 09/11):** **Strategy** em `payments` (`PaymentProvider` com implementações `FakeCardProvider`, `FakePixProvider`), escolhida em tempo de execução. Justificar em ADR (aberto/fechado: novo meio de pagamento sem alterar o caso de uso).

**Database Pattern (⏳ provisório até 09/11):** **Repository** — interfaces em `application/`, implementações Prisma em `infrastructure/`. Permite testar casos de uso com repositórios em memória. Registrar em ADR, com a alternativa descartada (Active Record / Prisma direto nos services).

## 5. Dados

- Seed com **pelo menos 100.000 pedidos sintéticos** (`npm run db:seed`), usando `@faker-js/faker` com seed fixa (reproduzível) e inserção em lotes (`createMany`, lotes de ~5.000).
- Volumes sugeridos: ~5.000 produtos, ~20.000 clientes, 100.000+ pedidos com 1–5 itens, pagamentos correspondentes.
- O seed precisa terminar em tempo razoável (meta: < 3 min). Logue o progresso.

## 6. Comandos (manter este bloco atualizado)

```bash
docker compose up -d          # sobe TUDO com 1 comando: api, postgres, redis, worker, unleash, prometheus, grafana, jaeger
cp .env.example .env          # 1ª vez: variáveis locais (o .env não é versionado)
npm run dev                   # api em modo watch
npm run worker                # consumer BullMQ
npm run db:migrate            # prisma migrate
npm run db:generate           # gera o Prisma Client (necessário após mudar prisma/schema.prisma)
npm run db:seed               # 100k+ pedidos sintéticos
npm run lint                  # eslint (inclui boundaries)
npm run typecheck             # tsc --noEmit
npm test                      # unit
npm run test:integration      # Testcontainers (precisa de Docker)
npm run test:contract         # Pact
npm run test:coverage         # falha se abaixo do mínimo
npm run openapi:lint          # spectral lint docs/openapi.yaml
npm run k6:baseline           # k6 antes da otimização
npm run k6:after              # k6 depois da otimização
```

## 7. Entregáveis e onde ficam

### Base de qualidade

- [ ] `docker-compose.yml` que sobe com **1 comando** (healthchecks + `depends_on`)
- [x] Framework HTTP → `docs/adr/0001-framework-http-fastify.md`
- [ ] Monólito modular → `docs/adr/0002-monolito-modular.md` (descartado: microserviços)
- [ ] SOLID + design pattern justificado → `docs/adr/0003-design-pattern.md` (⏳ após módulo 4)
- [ ] Database Pattern → `docs/adr/0004-database-pattern.md` (⏳ após módulo 4)
- [ ] Testes unitários (`*.spec.ts` ao lado do código), integração (`tests/integration/`, Testcontainers), contrato de API (`tests/contract/`, Pact)
- [ ] Coverage mínimo **declarado no pipeline** (`vitest.config.ts` → `thresholds`, padrão: 80% linhas em `domain/` e `application/`)

### Entrega e operação

- [ ] `.github/workflows/ci.yml`: lint → typecheck → testes → coverage → `npm audit --audit-level=high` → Trivy → gitleaks → spectral
- [ ] Dois ambientes (`staging`, `production`) via GitHub Environments; config só por variável de ambiente; `.env.example` versionado, `.env` no `.gitignore`; config validada com Zod no boot
- [ ] Logs estruturados (pino, com `requestId` e `traceId`)
- [ ] Métricas **RED** em `/metrics` (Rate, Errors, Duration — histograma por rota/status) + dashboard Grafana provisionado em `ops/grafana/`
- [ ] **1 trace** ponta a ponta: `POST /orders` → fila → worker de pagamento, visível no Jaeger
- [ ] **1 SLO declarado** em `docs/slo.md` (padrão: 99% das requisições `GET /catalog/products` com p95 < 200 ms e taxa de erro < 1% em 30 dias)
- [ ] **1 feature flag** (Unleash): `catalog-cache-enabled` — liga/desliga o cache do catálogo (também serve de kill switch e para o antes/depois do k6)
- [ ] Estratégia de deploy registrada em ADR (padrão: deploy contínuo no Render com health check + rollback; flag como mecanismo de liberação gradual)

### Arquitetura e desempenho

- [ ] ADRs (MADR) em `docs/adr/`, **cada um com a alternativa descartada**
- [ ] C4 de **contexto** (`docs/c4/contexto.md`) e de **contêiner** (`docs/c4/conteiner.md`) em Mermaid
- [ ] OpenAPI 3.1 de **catálogo** e **pedido** em `docs/openapi.yaml` (arquivo único), com lint no pipeline e Swagger UI em `/docs`
- [ ] Plano de p95 em `docs/desempenho.md`:
  - **Cache com tolerância:** cache-aside no Redis para leitura de catálogo, TTL declarado (ex.: 60 s de dados possivelmente desatualizados aceitos) e invalidação na escrita
  - **Idempotência da fila:** header `Idempotency-Key` no `POST /orders`; `jobId = orderId` no BullMQ; consumer verifica o estado do pagamento antes de processar (reentrega não cobra duas vezes)
- [ ] k6 em **3 estágios** (`stages`: rampa de subida → sustentação → rampa de descida) em `k6/`; relatório em `docs/desempenho.md` com **gargalo identificado, antes e depois** (números de p95, RPS, erro), evidência via `EXPLAIN ANALYZE` e/ou clinic.js

### Documentos obrigatórios

- [ ] `README.md` — **a primeira linha deve ser:** `Nível escolhido: Projeto A (Avançado)`. Depois: como subir, como testar, link do CI verde
- [ ] `docs/desempenho.md`
- [ ] `docs/ia.md` — prompts que importaram
- [ ] `CONTRIBUTORS.md`

## 8. Plano de execução (até 13/11)

| Dia    | Foco                                                                                                                 |
| ------ | -------------------------------------------------------------------------------------------------------------------- |
| Sáb 07 | Setup: repo, TS, ESLint/boundaries, compose, Prisma, esqueleto dos 3 módulos, ADR-0001 (Fastify) ✅                  |
| Dom 08 | Domínio e casos de uso de catalog/orders/payments, seed 100k, ADR-0002. Patterns atrás de interfaces (trocáveis)     |
| Seg 09 | **Revisar módulo 4 e fechar ADR-0003/0004**; testes unit/integração/contrato, coverage threshold, OpenAPI + Spectral |
| Ter 10 | CI completo, ambientes e segredos, logs, métricas RED, trace, SLO                                                    |
| Qua 11 | Cache + flag, fila idempotente, C4, ADRs restantes, deploy no Render                                                 |
| Qui 12 | k6 baseline → achar gargalo → otimizar → k6 after → `docs/desempenho.md`                                             |
| Sex 13 | README final, `docs/ia.md`, CONTRIBUTORS, CI verde, **entrega**                                                      |

Se o prazo apertar, priorize nesta ordem: sistema rodando com 1 comando → testes + CI verde → docs obrigatórios → k6 com antes/depois → observabilidade → flag/deploy.

## 9. Convenções

- Commits: Conventional Commits (`feat(orders): ...`, `test(catalog): ...`, `docs(adr): ...`).
- Branches curtas, merge em `main` só com CI verde.
- Erros HTTP no formato RFC 9457 (Problem Details).
- Dinheiro em centavos (`int`), nunca `float`.
- IDs: UUID v7.
- Toda rota nova: schema Zod + entrada na OpenAPI + teste.

## 10. Definition of Done de qualquer tarefa

- Lint, typecheck e testes passando localmente
- Coverage não caiu abaixo do mínimo
- OpenAPI atualizada se a API mudou
- ADR criado se houve decisão de arquitetura
- Resumo curto do que foi feito e por quê

## 11. Apresentação (16/11) — guardar material ao longo do projeto

1 min problema e nível · 3 min demo (sobe, roda, responde) · 3 min uma decisão técnica e a alternativa descartada · 3 min números e o que faria diferente. Ao longo do projeto, anote em `docs/apresentacao.md` números do k6 e prints do Grafana/Jaeger.

## 12. Pendências

- [ ] **Dependência de decisão — Ebook de System Design, módulo 4 (resolver em 09/11).** O autor ainda não teve acesso ao módulo 4. Até lá, o design pattern (Strategy) e o Database Pattern (Repository) são **provisórios**. Ao obter o módulo:
  1. Comparar os padrões recomendados no módulo com Strategy e Repository (e avaliar Transactional Outbox, que combina com a fila idempotente).
  2. Decidir: manter ou trocar. Escrever ADR-0003 e ADR-0004 com a alternativa descartada.
  3. Remover os marcadores ⏳ deste arquivo.
  - **Enquanto isso:** implemente esses padrões sempre atrás de interfaces, para que a troca custe pouco. Não escreva os ADRs 0003/0004 antes dessa revisão.
- [x] Estrutura mínima esperada — incorporada na seção 4.
