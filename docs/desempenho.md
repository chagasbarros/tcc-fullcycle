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

_(a preencher com a implementação do header `Idempotency-Key`)_

## 3. k6 — antes e depois

_(a preencher em 12/11)_ Cenário em 3 estágios (rampa de subida, sustentação, rampa de descida). Baseline com a flag desligada, depois com a flag ligada e com a otimização encontrada. Para cada um: p95, RPS e taxa de erro, o gargalo identificado e a evidência (`EXPLAIN ANALYZE` e/ou clinic.js).
