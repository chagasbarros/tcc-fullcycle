# ADR-0010 — Worker da fila em processo separado da API

- **Status:** Aceito
- **Data:** 2026-11-08
- **Decisor:** Chagas Barros

## Contexto e problema

A comunicação entre `orders` e `payments` é assíncrona via fila BullMQ (`CLAUDE.md`, seção 4):

- `orders` publica `OrderPlaced` → `payments` cobra o pedido;
- `payments` publica o resultado (aprovado/recusado) → `orders` atualiza o estado do pedido (ADR-0007) e devolve o estoque se o pagamento falhar (ADR-0009).

Alguém precisa **consumir** essas filas. Precisamos decidir em qual processo os consumers (workers BullMQ) rodam.

## Fatores de decisão

- Não distorcer a latência da API (p95 é medido pelo k6 e tem SLO declarado)
- Escalar o processamento de pagamentos de forma independente da API
- Simplicidade de operação (compose, deploy no Render)
- Coerência com o `CLAUDE.md`, que prevê `npm run worker` e um serviço `worker` no compose

## Opções consideradas

1. **Processo separado** (`src/worker.ts`, serviço `worker` no compose)
2. Consumers dentro do processo da API

## Decisão

**Processo separado.**

- `src/server.ts` (API) **só publica** na fila.
- `src/worker.ts` **só consome**: roda o consumer de `OrderPlaced` (módulo payments) e o consumer de resultados de pagamento (módulo orders).
- Os dois processos usam a mesma imagem Docker e o mesmo código, mas cada um tem seu próprio composition root e monta só o que usa. As fronteiras dos módulos valem nos dois.
- No compose, o serviço `worker` usa a imagem da API com outro comando (`node dist/worker.js`) e depende de postgres, redis e migrate.

## Consequências

- **Positivas:**
  - Uma fila acumulada (por exemplo, durante o k6) não consome a CPU nem o event loop da API: a latência medida reflete só o HTTP.
  - O worker escala sozinho (mais réplicas ou mais `concurrency`) sem escalar a API, e vice-versa.
  - Se o worker cair, a API continua aceitando pedidos: os jobs ficam no Redis e são processados quando ele voltar.
- **Negativas:**
  - Mais um serviço para subir, monitorar e implantar (no Render, um _background worker_ a mais).
  - O trace ponta a ponta (`POST /orders` → fila → worker) precisa propagar o contexto do OpenTelemetry entre processos, pelos dados do job.
  - Sem o worker rodando, os pedidos ficam em `PENDING_PAYMENT`.

## Alternativas descartadas

- **Consumers dentro da API:** um processo a menos e deploy mais simples, mas o processamento de pagamentos disputaria o event loop com as requisições HTTP. Sob carga, isso aumentaria o p95 da API por um motivo que não tem relação com o HTTP, distorcendo o antes/depois do k6. Também impediria escalar API e worker separadamente.
