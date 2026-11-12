Nível escolhido: Projeto A (Avançado)

# Marketplace — monólito modular

[![CI](https://github.com/chagasbarros/tcc-fullcycle/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/chagasbarros/tcc-fullcycle/actions/workflows/ci.yml?query=branch%3Amain)

Trabalho de Conclusão do curso Fullcycle (Geração Tech), de Chagas Barros.

## 1. O que o sistema faz

Um marketplace com três áreas de negócio: **catálogo** (produtos, preço e estoque), **pedidos** (do pedido ao pagamento, com cancelamento) e **pagamentos** (cobrança assíncrona por cartão ou Pix, com gateways simulados). Ele é construído como um **monólito modular**: um único deploy, com fronteiras entre módulos garantidas pelo lint no CI e comunicação entre pedidos e pagamentos por fila.

| Ambiente   | URL                                                                                                                          |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Produção   | <https://marketplace-api-production.onrender.com> · Swagger: [`/docs`](https://marketplace-api-production.onrender.com/docs) |
| Staging    | <https://marketplace-api-staging-7327.onrender.com>                                                                          |
| CI (verde) | <https://github.com/chagasbarros/tcc-fullcycle/actions/workflows/ci.yml?query=branch%3Amain>                                 |

> Os serviços gratuitos do Render dormem após 15 minutos sem tráfego. A primeira requisição pode levar cerca de 1 minuto.

## 2. Como subir localmente

**Pré-requisitos:** Docker (com Docker Compose) e Node.js 22 ou mais recente.

```bash
git clone https://github.com/chagasbarros/tcc-fullcycle.git
cd tcc-fullcycle

# 1. Sobe TUDO com um comando: api, worker, postgres, redis, unleash, prometheus, grafana e jaeger.
#    As migrations rodam sozinhas antes da api e do worker.
docker compose up -d

# 2. Dados sintéticos (5.000 produtos, ~20.000 clientes, 100.000 pedidos), cerca de 1 min.
#    O seed roda na sua máquina, contra o postgres do compose.
cp .env.example .env
npm ci
npm run db:generate
npm run db:seed
```

Pronto. Para conferir:

```bash
docker compose ps                                     # todos "healthy" ou "running"
curl http://localhost:3000/health                     # {"status":"ok",...}
curl "http://localhost:3000/catalog/products?pageSize=2"
```

| O quê                     | Onde                                                                 |
| ------------------------- | -------------------------------------------------------------------- |
| API e Swagger UI          | <http://localhost:3000/docs>                                         |
| Métricas RED (Prometheus) | <http://localhost:3000/metrics> · Prometheus <http://localhost:9090> |
| Grafana (dashboard RED)   | <http://localhost:3001> (abre direto no dashboard, sem login)        |
| Jaeger (traces)           | <http://localhost:16686>, serviço `marketplace-api`                  |
| Unleash (feature flags)   | <http://localhost:4242>, `admin` / `unleash4all` (só local)          |

**Um pedido de ponta a ponta:**

```bash
# pegue o id de um produto
curl "http://localhost:3000/catalog/products?pageSize=1"

curl -X POST http://localhost:3000/orders \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: meu-checkout-1" \
  -d '{"customerId":"0199c8c1-0000-7000-8000-000000000001","paymentMethod":"PIX","items":[{"productId":"<id do produto>","quantity":1}]}'
# -> 201, status PENDING_PAYMENT; o worker cobra pela fila

curl http://localhost:3000/orders/<id do pedido>    # -> PAID
```

**Para desenvolver** (API e worker fora do Docker, em modo watch): `npm run dev` e `npm run worker`, com o `.env` apontando para o postgres e o redis do compose.

## 3. Como testar

```bash
npm run lint               # ESLint + Prettier + fronteiras entre módulos (eslint-plugin-boundaries)
npm run typecheck          # tsc --noEmit
npm test                   # unitários (Vitest), sem Docker
npm run test:coverage      # falha se domain/ e application/ ficarem abaixo de 80% de linhas
npm run test:integration   # PostgreSQL 16 e Redis 7 reais via Testcontainers (precisa de Docker)
npm run test:contract      # Pact: consumidor simulado (storefront) x provedor (a API real)
npm run openapi:lint       # Spectral sobre docs/openapi.yaml
```

**Teste de carga (k6 em Docker, com o compose no ar e o seed carregado):**

```bash
npm run k6:baseline        # cache do catálogo DESLIGADO (flag no Unleash)
npm run k6:after           # cache LIGADO
```

O CI (`.github/workflows/ci.yml`) roda em todo pull request e em todo push na `main`: lint, typecheck, testes unitários, integração, contrato, coverage, `npm audit`, Trivy, gitleaks e Spectral. Cada merge na `main` com CI verde publica em **staging** sozinho, e a **produção** espera aprovação manual (`docs/deploy.md`).

## 4. Variáveis de ambiente

Toda a configuração vem de variáveis de ambiente, validadas com Zod no boot (`src/shared/config/env.ts`): se faltar algo, a aplicação não sobe. O modelo é o `.env.example`. O `.env` não é versionado.

| Variável                                           | Obrigatória | Para quê                                                                |
| -------------------------------------------------- | ----------- | ----------------------------------------------------------------------- |
| `DATABASE_URL`                                     | **sim**     | PostgreSQL                                                              |
| `REDIS_URL`                                        | **sim**     | Fila (BullMQ) e cache                                                   |
| `NODE_ENV`, `HOST`, `PORT`, `LOG_LEVEL`            | não         | Padrões: `development`, `0.0.0.0`, `3000`, `info`                       |
| `DATABASE_POOL_MAX`, `IDEMPOTENCY_LOCK_POOL_MAX`   | não         | Pools de conexão (padrão 10 cada, ADR-0019)                             |
| `CATALOG_CACHE_ENABLED`                            | não         | Cache do catálogo quando o Unleash não está configurado (padrão `true`) |
| `UNLEASH_URL`, `UNLEASH_API_TOKEN`                 | não         | Feature flags pelo Unleash (o token é obrigatório se houver URL)        |
| `OTEL_EXPORTER_OTLP_ENDPOINT`, `OTEL_SERVICE_NAME` | não         | Tracing (sem eles, o tracing fica desligado)                            |
| `PAYMENT_PROVIDER_LATENCY_MS`                      | não         | Latência simulada dos gateways fake (padrão `0`)                        |
| `RUN_WORKER_IN_PROCESS`                            | não         | Consumidores da fila dentro da API (só no Render, ADR-0018)             |

## 5. Onde estão as decisões

| Documento                                                                                    | Conteúdo                                                                  |
| -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| [`docs/adr/`](docs/adr/)                                                                     | 22 ADRs (MADR), cada um com a alternativa descartada                      |
| [`docs/c4/contexto.md`](docs/c4/contexto.md), [`docs/c4/conteiner.md`](docs/c4/conteiner.md) | Diagramas C4 de contexto e de contêiner (Mermaid)                         |
| [`docs/openapi.yaml`](docs/openapi.yaml)                                                     | Contrato OpenAPI 3.1 de catálogo e pedidos (Swagger UI em `/docs`)        |
| [`docs/desempenho.md`](docs/desempenho.md)                                                   | Cache, idempotência da fila e k6 antes e depois, com o gargalo encontrado |
| [`docs/slo.md`](docs/slo.md)                                                                 | SLO da leitura do catálogo (p95 < 200 ms, erro < 1%)                      |
| [`docs/deploy.md`](docs/deploy.md)                                                           | Deploy no Render: staging, aprovação, produção e rollback                 |
| [`docs/ia.md`](docs/ia.md)                                                                   | Prompts que mudaram o rumo do projeto e o que foi decidido                |

**Os ADRs mais importantes para começar:**

- [ADR-0002](docs/adr/0002-monolito-modular.md): por que monólito modular e não microsserviços
- [ADR-0003](docs/adr/0003-design-pattern.md): Strategy nos meios de pagamento (SOLID)
- [ADR-0004](docs/adr/0004-database-pattern.md): Repository como Database Pattern
- [ADR-0016](docs/adr/0016-idempotency-key.md) e [ADR-0019](docs/adr/0019-pool-separado-para-a-trava.md): idempotência no `POST /orders` e o gargalo que o k6 encontrou nela
- [ADR-0021](docs/adr/0021-transactional-outbox.md): Transactional Outbox (proposto, não implementado)

**Estrutura do código:**

```
src/
  modules/
    catalog/    # produtos, estoque, preço
    orders/     # pedido, estados, idempotência
    payments/   # cobrança (Strategy), consumidor da fila
  shared/       # db, cache, fila, config, logs, métricas, tracing, flags
  app.ts        # composição dos módulos
  server.ts     # bootstrap da API
  worker.ts     # bootstrap do worker
```

Cada módulo tem `domain/`, `application/`, `infrastructure/` e `http/`, e só é acessado de fora pelo seu `index.ts`.

## 6. A quem recorrer

Chagas Barros, autor do projeto: [github.com/chagasbarros](https://github.com/chagasbarros). Dúvidas e problemas podem ser abertos como [issue](https://github.com/chagasbarros/tcc-fullcycle/issues). Colaboração e uso de IA estão descritos em [`CONTRIBUTORS.md`](CONTRIBUTORS.md).
