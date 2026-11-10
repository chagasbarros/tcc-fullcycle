# Desempenho — plano de p95 e relatório do k6

> Alvo: o SLO de `docs/slo.md`, que exige p95 < 200 ms em `GET /catalog/products`.

## 1. Cache com tolerância (leitura do catálogo)

| Item                   | Decisão                                                                                                                                                        |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Padrão                 | **Cache-aside** no Redis: lê o cache; em caso de _miss_, lê o banco e grava no cache.                                                                          |
| O que vai para o cache | `GET /catalog/products` (cada página) e `GET /catalog/products/{id}`                                                                                           |
| TTL                    | **60 s**                                                                                                                                                       |
| Tolerância declarada   | O cliente pode ver **estoque com até 60 s de atraso**. Preço e nome são invalidados na hora quando o produto é salvo.                                          |
| Invalidação            | Na escrita do produto (`save`): apaga o produto e todas as páginas de uma vez (um `DEL`)                                                                       |
| Por que é seguro       | O pedido nunca lê o cache: a reserva de estoque é atômica no banco (ADR-0009). O pior caso é a listagem mostrar estoque que acabou e o pedido responder `409`. |
| Se o Redis falhar      | A leitura vai ao banco. O cache usa uma conexão que falha rápido, com _timeout_ de 250 ms.                                                                     |
| Kill switch            | Flag `catalog-cache-enabled`: Unleash no ambiente local, com efeito em cerca de 5 s; `CATALOG_CACHE_ENABLED` no Render (ADR-0015)                              |
| Decisão registrada     | ADR-0014 (descartada: invalidar o cache a cada pedido)                                                                                                         |

## 2. Idempotência da fila (criação de pedido)

Três camadas, da entrada até a cobrança:

| Camada                      | Mecanismo                                                                                                                              | Protege contra                                        |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| **HTTP** (`POST /orders`)   | Header `Idempotency-Key`; `UNIQUE(customer_id, idempotency_key)` no PostgreSQL; trava `pg_try_advisory_xact_lock` por chave (ADR-0016) | Duplo clique, retentativa após _timeout_              |
| **Fila** (`order-placed`)   | `jobId = orderId`: o BullMQ recusa um job com o mesmo id                                                                               | Publicação repetida do mesmo `OrderPlaced`            |
| **Consumidor** (pagamentos) | Verifica se o pedido já tem pagamento antes de cobrar; `UNIQUE(order_id)` em `payments.payments` (ADR-0011)                            | Reentrega do job (worker caiu no meio), outro `jobId` |

**Comportamento do header:**

- **Repetição:** devolve `201` com o mesmo pedido, `Idempotent-Replayed: true` e o status atual, sem nova reserva de estoque, pedido ou evento.
- **Mesma chave com outro conteúdo:** responde `422`.
- **Requisição com a mesma chave ainda em andamento:** responde `409` com `Retry-After: 1`.

**Medido (10/11, PostgreSQL real):** com 10 requisições simultâneas e a mesma chave, o resultado foi **1 pedido**, estoque reservado **uma vez** e **1 evento**. Sem a trava, com estoque baixo, 9 das 10 recebiam `409 Out of Stock`.

**Custo de desempenho:** uma consulta pelo índice `UNIQUE` antes de reservar o estoque e uma conexão a mais do _pool_ durante a requisição, para segurar a trava. Isso só acontece em requisições **com** a chave. O efeito no p95 do `POST /orders` será medido no k6.

## 3. k6 — antes e depois

_(a preencher em 12/11)_ Cenário em 3 estágios (rampa de subida, sustentação, rampa de descida). Baseline com a flag desligada, depois com a flag ligada e com a otimização encontrada. Para cada um: p95, RPS e taxa de erro, o gargalo identificado e a evidência (`EXPLAIN ANALYZE` e/ou clinic.js).
