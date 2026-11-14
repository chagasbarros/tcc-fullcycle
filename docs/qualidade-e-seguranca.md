# Qualidade e segurança — tecnologias usadas

Lista das tecnologias e práticas usadas no projeto para dar qualidade ao código e garantir um desenvolvimento seguro.

## Qualidade de código

- TypeScript em modo `strict` (+ `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitOverride`)
- ESLint (`@eslint/js` + `typescript-eslint` com regras _type-checked_)
- `eslint-plugin-boundaries` (fronteiras entre módulos e camadas)
- `no-restricted-imports` (`domain/` sem framework)
- Prettier + `eslint-config-prettier`
- EditorConfig
- `.gitattributes` (fim de linha LF)
- Conventional Commits
- ADRs no formato MADR
- Monólito modular com API pública por módulo (`index.ts`)
- SOLID + Strategy (`PaymentProvider`)
- Repository (interfaces em `application/`, Prisma em `infrastructure/`)

## Testes

- Vitest (testes unitários `*.spec.ts`)
- Repositórios em memória nos testes de casos de uso
- Testcontainers (PostgreSQL e Redis reais nos testes de integração)
- Pact (testes de contrato consumidor/provedor)
- `@vitest/coverage-v8` com _threshold_ de 80% de linhas em `domain/` e `application/`
- `@faker-js/faker` com seed fixa (dados reproduzíveis)

## Contrato da API

- OpenAPI 3.1 (`docs/openapi.yaml`)
- Spectral (lint da OpenAPI, falha em _warning_)
- Swagger UI (`/docs`)
- Zod (validação de entrada nas rotas)
- Problem Details (RFC 9457) para erros HTTP

## Segurança

- `npm audit --audit-level=high` (SCA das dependências)
- Trivy (vulnerabilidades da imagem Docker, HIGH/CRITICAL)
- gitleaks (segredos em todo o histórico do git)
- Zod (config validada no boot)
- `.env.example` versionado e `.env` no `.gitignore`
- Segredos só em GitHub Secrets / variáveis de ambiente do Render
- pino com `redact` (`authorization`, `cookie`, `x-api-key` fora dos logs)
- Dockerfile _multi-stage_ com imagem `node:22-alpine`
- Imagem de runtime só com dependências de produção e sem npm/npx/corepack/yarn
- Container rodando como usuário não-root (`USER node`)
- `.dockerignore`
- `package-lock.json` + `npm ci` (instalação reproduzível)
- `Idempotency-Key` no `POST /orders` com _advisory lock_ no PostgreSQL
- `jobId = orderId` no BullMQ (reentrega não cobra duas vezes)
- IDs UUID v7
- Dinheiro em centavos (`int`)

## CI/CD

- GitHub Actions (`ci.yml`: 4 jobs paralelos — qualidade, integração, contrato, segurança)
- _Actions_ de terceiros fixadas por SHA de commit
- `permissions: contents: read` (privilégio mínimo)
- `concurrency` com cancelamento de execuções antigas
- `timeout-minutes` em cada job
- _Ruleset_ na `main` exigindo CI verde para merge
- GitHub Environments (`staging` e `production`)
- Revisor obrigatório para `production`
- Deploy só de commits que estão na `main` e só do mais recente (`deploy.yml`)
- Rollback manual por `workflow_dispatch` com commit anterior
- Render (deploy com health check e migrations no start)
- Docker Compose com `healthcheck` e `depends_on`

## Observabilidade e operação

- pino (logs JSON estruturados com `requestId` e `traceId`)
- prom-client (métricas RED em `/metrics`)
- Prometheus
- Grafana (dashboard provisionado em `ops/grafana/`)
- OpenTelemetry (`sdk-node`, `auto-instrumentations-node`, exportador OTLP)
- `bullmq-otel` (trace atravessando a fila)
- Jaeger
- SLO declarado (`docs/slo.md`)
- Unleash (feature flag `catalog-cache-enabled`, também como _kill switch_)
- Redis com cache-aside e TTL
- k6 (teste de carga em 3 estágios)
- `pg_stat_activity` (diagnóstico do gargalo)
- `EXPLAIN ANALYZE`

## Previstas, mas não adotadas

- **Codecov:** o relatório de coverage fica como artefato do GitHub Actions e o mínimo é garantido pelo _threshold_ do Vitest, então o serviço externo não foi necessário.
- **clinic.js:** o gargalo encontrado no k6 era espera por conexão no pool do banco, não CPU ou event loop do Node; o `pg_stat_activity` foi a ferramenta que mostrou a causa (ver `docs/desempenho.md`).
