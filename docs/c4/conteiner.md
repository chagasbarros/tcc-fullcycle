# C4 — Nível 2: Contêineres

> O que roda e como as partes se falam. Visão geral em [`contexto.md`](contexto.md). Tudo abaixo sobe com `docker compose up -d`.

```mermaid
C4Container
  title Marketplace — diagrama de contêineres (ambiente local, docker compose)

  System_Ext(loja, "Loja (front-end)", "Cliente HTTP")
  Person(operador, "Operador")

  System_Boundary(marketplace, "Marketplace") {
    Container(api, "API", "Node.js 22, Fastify, TypeScript", "Módulos catalog, orders e payments. Publica OrderPlaced. Expõe /metrics e /docs")
    Container(worker, "Worker", "Node.js 22, BullMQ", "Consome order-placed (cobra, via payments) e payment-results (atualiza o pedido, via orders)")
    ContainerDb(postgres, "PostgreSQL 16", "Prisma", "Schemas catalog, orders e payments: cada módulo é dono das suas tabelas (ADR-0005)")
    ContainerDb(redis, "Redis 7", "ioredis", "Filas BullMQ order-placed e payment-results; cache do catálogo com TTL de 60 s")
  }

  System_Boundary(ops, "Operação") {
    Container(unleash, "Unleash 7", "+ PostgreSQL próprio", "Flag catalog-cache-enabled (ADR-0015)")
    Container(prometheus, "Prometheus", "", "Coleta /metrics da API a cada 5 s")
    Container(grafana, "Grafana", "", "Dashboard Marketplace — RED e SLO")
    Container(jaeger, "Jaeger", "OTLP/HTTP", "Traces da API e do worker")
  }

  Rel(loja, api, "Chama", "HTTPS/JSON")
  Rel(api, postgres, "Lê e grava", "SQL")
  Rel(api, redis, "Publica jobs; lê e grava o cache")
  Rel(worker, redis, "Consome e publica jobs")
  Rel(worker, postgres, "Grava pagamentos; atualiza pedidos e estoque", "SQL")
  Rel(api, unleash, "Lê flags a cada 5 s", "HTTP")
  Rel(prometheus, api, "Coleta", "GET /metrics")
  Rel(grafana, prometheus, "Consulta", "PromQL")
  Rel(api, jaeger, "Envia spans", "OTLP")
  Rel(worker, jaeger, "Envia spans", "OTLP")
  Rel(operador, grafana, "Acompanha")
  Rel(operador, jaeger, "Investiga")
  Rel(operador, unleash, "Liga/desliga")

  UpdateLayoutConfig($c4ShapeInRow="4", $c4BoundaryInRow="1")
```

## Contêineres

| Contêiner                         | Porta local         | Responsabilidade                                                                                                                                       | Decisões             |
| --------------------------------- | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------- |
| **API**                           | 3000                | Rotas HTTP dos três módulos, validação com Zod, erros em Problem Details. Reserva estoque e salva o pedido de forma síncrona; a cobrança é assíncrona. | ADR-0001, 0002, 0016 |
| **Worker**                        | —                   | Processo separado com os consumidores das duas filas. Um pagamento lento não ocupa a API.                                                              | ADR-0010, 0011       |
| **PostgreSQL**                    | 5432                | Fonte da verdade. Sem JOIN nem chave estrangeira entre schemas de módulos diferentes.                                                                  | ADR-0005, 0009       |
| **Redis**                         | 6379                | Filas (o `jobId` é o id do pedido, então o mesmo pedido não entra duas vezes) e cache do catálogo, em conexões separadas.                              | ADR-0010, 0014       |
| **Unleash**                       | 4242                | Só no ambiente local. No Render, a flag vem de variável de ambiente.                                                                                   | ADR-0015             |
| **Prometheus / Grafana / Jaeger** | 9090 / 3001 / 16686 | Métricas RED, SLO e trace ponta a ponta.                                                                                                               | ADR-0013             |

Também há dois contêineres de execução única: `migrate` (aplica as migrations antes de a API e o worker subirem) e `unleash-setup` (cria a flag).

## Fluxo de um pedido

O caminho que o trace no Jaeger mostra (34 spans em 2 serviços, medido em 10/11):

```mermaid
sequenceDiagram
  autonumber
  participant L as Loja
  participant A as API (orders + catalog)
  participant P as PostgreSQL
  participant R as Redis (filas)
  participant W as Worker (payments + orders)

  L->>A: POST /orders (Idempotency-Key opcional)
  A->>P: reserva estoque (UPDATE atômico) e grava o pedido PENDING_PAYMENT
  A->>R: order-placed (jobId = orderId)
  A-->>L: 201 Created (pedido PENDING_PAYMENT)
  R->>W: OrderPlaced
  W->>P: já existe pagamento para o pedido? se não, cobra e grava
  W->>R: payment-results (PaymentApproved ou PaymentFailed)
  R->>W: resultado do pagamento
  W->>P: pedido vira PAID ou PAYMENT_FAILED (falha devolve o estoque)
  L->>A: GET /orders/{id}
  A-->>L: 200 (status atual)
```

## Diferença no Render

No plano gratuito do Render não existe _Background Worker_. Lá, os consumidores rodam **dentro do processo da API**, e não há Unleash, Prometheus, Grafana nem Jaeger. O detalhe está no ADR-0018 (deploy).
