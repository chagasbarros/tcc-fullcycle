# ADR-0013 — Observabilidade: OpenTelemetry automático para traces e hook próprio para métricas RED

- **Status:** Aceito
- **Data:** 2026-11-09
- **Decisor:** Chagas Barros

## Contexto e problema

O projeto precisa de logs estruturados com `requestId` e `traceId`, métricas **RED** em `/metrics` com dashboard no Grafana e **um trace ponta a ponta** visível no Jaeger: `POST /orders` → fila → worker de pagamento (`CLAUDE.md`, seção 7). A stack já está definida: pino, prom-client, Prometheus, Grafana, OpenTelemetry e Jaeger.

A parte difícil é o trace. O pedido atravessa **dois processos** (API e worker, ADR-0010) e **duas filas** BullMQ. Sem cuidado, viram três traces soltos que não se ligam.

Duas perguntas:

1. Como gerar os spans do trace?
2. Como coletar as métricas RED?

## Fatores de decisão

- Encontrar o gargalo no k6 de quinta-feira: o trace precisa mostrar o tempo gasto em SQL e Redis, não só na rota.
- Não mudar o contrato dos eventos (`OrderPlaced`) por motivo técnico.
- Código que o autor saiba explicar na apresentação.
- Custo zero quando a observabilidade está desligada (testes, desenvolvimento sem Jaeger).

## Opções consideradas

**Traces:**

1. **Instrumentação automática do OpenTelemetry + `bullmq-otel`:** o SDK corrige (_patch_) as bibliotecas http, pg, ioredis e pino quando elas são carregadas. O pacote oficial do BullMQ grava o contexto do trace dentro do job e o worker continua o mesmo trace.
2. **Spans manuais:** criar à mão um span por requisição, um na publicação e um no processamento, levando o contexto num campo do `OrderPlaced`.

**Métricas:**

1. **Hook próprio no Fastify** com prom-client (cerca de 30 linhas).
2. **Plugin `fastify-metrics`**, pronto e configurado em poucas linhas.

## Decisão

**Traces: opção 1 — OpenTelemetry automático + `bullmq-otel`.**

- `src/instrumentation.ts` é carregado **antes** da aplicação, com `node --import`. As instrumentações só funcionam se forem registradas antes de as bibliotecas serem importadas. Como o código é ESM, um _loader hook_ (`@opentelemetry/instrumentation/hook.mjs`) também é registrado.
- O tracing só liga se `OTEL_EXPORTER_OTLP_ENDPOINT` estiver definida. Sem ela, nada é carregado.
- Instrumentações de `fs`, `dns` e `net` foram desligadas porque geram ruído. `/health` e `/metrics` também não geram trace.
- A instrumentação do pino adiciona `traceId` e `spanId` a toda linha de log dentro de um span. O `requestId` vem do Fastify: reaproveita o `x-request-id` do cliente se for seguro, senão gera um UUID v7, e é devolvido no cabeçalho da resposta.
- A instrumentação de http só conhece a URL. Um hook (`src/shared/http/tracing.ts`) renomeia o span para o **template da rota** (`POST /orders/:id`).

**Métricas: opção 1 — hook próprio.**

- Um único histograma, `http_request_duration_seconds{method, route, status_code}`, fornece as três letras do RED: a taxa vem da contagem, os erros do filtro por `status_code`, e a duração dos _buckets_.
- O rótulo `route` usa o **template** da rota, e as URLs sem rota viram `unmatched`. Assim, IDs e URLs aleatórias não criam séries novas no Prometheus (explosão de cardinalidade).
- Os _buckets_ são mais densos perto de 200 ms, a meta do SLO (`docs/slo.md`), e há um _bucket_ exatamente em 0,2 s.

**Configuração versionada:** Prometheus e Grafana vêm provisionados de `ops/`, com fonte de dados e dashboard "Marketplace — RED". Nada precisa ser configurado à mão.

## Consequências

- **Positivas:**
  - **Medido em 09/11:** um pedido gerou **34 spans em 2 serviços num único trace**. O mesmo `traceId` aparece no log da API e nos dois jobs do worker.
  - O trace mostra cada SQL (reserva de estoque, `INSERT` do pedido) e cada comando Redis. Isso é o necessário para achar o gargalo no k6.
  - O evento `OrderPlaced` não mudou: o contexto do trace viaja nos metadados do job.
  - Logs, métricas e traces se ligam: o p95 alto aparece no Grafana, o trace no Jaeger mostra onde o tempo foi gasto, e o log com o mesmo `traceId` mostra o que aconteceu.
- **Negativas:**
  - **Mais dependências** (SDK do OpenTelemetry, instrumentações, `bullmq-otel`) e um passo "mágico" (`--import`) que precisa ser explicado.
  - O _loader hook_ de ESM do OpenTelemetry ainda é **experimental**.
  - O worker não expõe `/metrics` porque não tem servidor HTTP. As métricas RED cobrem só a API; o worker é observado pelos traces e pelos logs.
  - O Jaeger guarda os traces em memória: reiniciar o container apaga o histórico. Para uso local e para a demo, isso basta.
  - O `/metrics` é público. Em produção, ele precisa ser protegido ou ficar restrito à rede interna (a resolver no deploy).

## Alternativas descartadas

- **Spans manuais:** cada linha seria explicável e haveria menos dependências. Foi descartada porque:
  - não mostraria o tempo de SQL nem de Redis, justamente o que o k6 precisa para identificar o gargalo;
  - obrigaria a colocar um campo técnico (`traceparent`) no `OrderPlaced`, misturando infraestrutura com o contrato de negócio entre os módulos.
- **Plugin `fastify-metrics`:** menos código próprio, mas os nomes das métricas e dos rótulos seguiriam a convenção do plugin. As 30 linhas do hook próprio são fáceis de explicar e de testar, e os _buckets_ ficam alinhados ao SLO.
