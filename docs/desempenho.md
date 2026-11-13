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

**Medido (09/11, PostgreSQL real):** com 10 requisições simultâneas e a mesma chave, o resultado foi **1 pedido**, estoque reservado **uma vez** e **1 evento**. Sem a trava, com estoque baixo, 9 das 10 recebiam `409 Out of Stock`.

**Custo de desempenho:** uma consulta pelo índice `UNIQUE` antes de reservar o estoque e uma conexão a mais do _pool_ durante a requisição, para segurar a trava. Isso só acontece em requisições **com** a chave. O efeito no p95 do `POST /orders` será medido no k6.

## 3. k6 — antes e depois (12/11)

### Como rodar

```bash
docker compose up -d       # stack com o seed de 100k pedidos
npm run k6:baseline        # flag catalog-cache-enabled DESLIGADA
npm run k6:after           # flag LIGADA (com a correção do gargalo já no código)
node k6/run.mjs <nome> --cache on|off   # qualquer combinação; VUS=... para mudar a carga
```

O k6 roda em Docker (`grafana/k6:1.0.0`) dentro da rede do compose (`k6/run.mjs`). As escolhas de como rodar, contra qual ambiente e com qual cenário, e as alternativas descartadas, estão no ADR-0020. O resumo de cada rodada fica em `k6/results/<nome>.json`.

### Cenário (`k6/marketplace.js`)

- **3 estágios:** 1 min de subida até **300 VUs** → 3 min sustentando → 1 min de descida
- **Mix:** 80% `GET /catalog/products?page=N` (página aleatória entre as 251), 15% `GET /catalog/products/{id}`, 5% `POST /orders` (com `Idempotency-Key`, cliente novo a cada pedido)
- Pausa de 0,1 a 0,5 s entre as ações de cada VU
- **Thresholds = SLO:** p95 < 200 ms e erro < 1% em `GET /catalog/products`; erro < 1% no total
- Máquina: notebook com Docker Desktop no Windows (12 CPUs lógicas), banco com o seed (5.003 produtos, 100.003 pedidos)

A carga foi calibrada antes: com 100 VUs a API respondia com p95 de 6 ms. O colapso aparece entre 100 e 300 VUs.

### Resultados

| Rodada                                 | Cache | `GET /catalog/products` p95 | `GET /{id}` p95 | `POST /orders` p95 | Erro `POST /orders` | Erro total | RPS     |
| -------------------------------------- | ----- | --------------------------- | --------------- | ------------------ | ------------------- | ---------- | ------- |
| **baseline**                           | off   | **3.867 ms** ❌             | 3.868 ms        | 8.133 ms           | **36,89%**          | 1,79%      | 168     |
| **after** (pool separado)              | off   | **97 ms** ✅                | 96 ms           | 1.506 ms           | 0%                  | 0%         | 603     |
| **after-cache** (pool separado + flag) | on    | **8,3 ms** ✅               | 9,1 ms          | **64 ms**          | 0%                  | 0%         | **787** |

Com 300 VUs e uma pausa média de 0,3 s, o teto teórico é perto de 1.000 req/s. Na rodada com cache, a API ficou próxima desse teto: quem limitou foi o próprio cenário, não a API.

### Gargalo identificado: impasse no pool de conexões

**Sintomas no baseline:**

- `POST /orders` com 36,9% de erro `500`. No log da API: `P2028 — Transaction API error: Unable to start a transaction in the given time`, com o stack passando por `PostgresIdempotencyLock` → `PlaceOrder` → `reserveStock`.
- Leituras do catálogo **sem erro, mas com p95 de 3,9 s**: a mediana era 10 ms, então a maioria das requisições era rápida e uma parte ficava presa esperando conexão.

**Evidência (`pg_stat_activity` da API a cada 10 s durante a carga, `k6/results/baseline-pg-activity.txt`):**

```
18:16:47 idle in transaction=10
18:17:18 idle in transaction=10
18:17:49 idle in transaction=10
```

O pool inteiro (10 conexões, o padrão do driver `pg`) ficou parado em `idle in transaction`. Não era consulta lenta: **nenhuma conexão estava executando nada**.

**Causa:** cada `POST /orders` com `Idempotency-Key` abre uma transação só para segurar a trava (ADR-0016), e o trabalho do pedido precisa de **outras** conexões do **mesmo** pool. Com 10 pedidos simultâneos, os 10 seguram as 10 conexões e esperam uma 11ª. Depois de alguns segundos o Prisma desiste (`P2028`), as conexões voltam ao pool, e o ciclo recomeça.

**Por que `EXPLAIN ANALYZE` não era a ferramenta aqui:** as consultas são por chave primária ou índice e levam milissegundos. A listagem (`ORDER BY id LIMIT 20 OFFSET n` + `count(*)` em 5.003 linhas), por exemplo, tem mediana de 10 ms no próprio baseline, com o cache desligado. O tempo estava na **espera por conexão**, e quem mostrou isso foi o `pg_stat_activity`.

**Correção (ADR-0019):** a trava ganhou um `PrismaClient` com pool próprio (`IDEMPOTENCY_LOCK_POOL_MAX`). Quem segura trava não consome mais conexões de trabalho, então o ciclo deixou de existir. Depois da correção, a mesma amostragem mostra conexões livres (`idle=7 idle in transaction=13`, `k6/results/after-pg-activity.txt`), somando os dois pools.

**Regressão:** `tests/integration/idempotency-key.test.ts` reproduz o impasse em escala pequena (pool de 2 conexões, 6 pedidos simultâneos): com um pool compartilhado aparecem `500`, e com pools separados os 6 pedidos são criados.

### Complemento: k6 no Render staging (ADR-0022)

O módulo 4 recomenda rodar o k6 num ambiente representativo de produção, não na máquina do autor. O antes e o depois ficaram no local (ADR-0020). Esta rodada no staging do Render complementa as medições, com carga leve para não afetar a produção, que divide o banco com o staging.

```bash
S=https://marketplace-api-staging-7327.onrender.com
curl -s $S/metrics > k6/results/render-metrics-before.txt
BASE_URL=$S PREPARE_PRODUCTS=500 VUS=30 RAMP_UP=30s SUSTAIN=2m RAMP_DOWN=30s node k6/run.mjs render-staging
curl -s $S/metrics > k6/results/render-metrics-after.txt
```

**Condições:** 30 VUs, 3 estágios curtos, mesmo mix 80/15/5, 500 produtos criados pelo `setup()`, cache **ligado** (`CATALOG_CACHE_ENABLED` no env group), plano gratuito do Render na Virgínia, k6 rodando no Brasil.

| Rota                          | k6 (inclui a rede) p95 | **Dentro da API** p50 | **Dentro da API** p95 | Em até 200 ms (API) |
| ----------------------------- | ---------------------- | --------------------- | --------------------- | ------------------- |
| `GET /catalog/products` (SLO) | 306 ms                 | 2,6 ms                | **5,0 ms**            | **99,77%** ✅       |
| `GET /catalog/products/{id}`  | 371 ms                 | 3,0 ms                | 75,5 ms               | 98,65%              |
| `POST /orders`                | 822 ms                 | 34,7 ms               | 496 ms                | 81,4%               |

Total: 44,9 req/s, **0% de erro**.

**Como ler:**

- **O SLO é cumprido no ambiente hospedado.** O `docs/slo.md` mede a latência dentro da API: 99,77% das leituras do catálogo ficaram em até 200 ms (meta: 95%).
- **O threshold do k6 falhou por causa da rede, não da API.** A mediana vista pelo k6 (192 ms) é quase toda a ida e volta Brasil–Virgínia. Medir o SLO por fora mistura a rede com a aplicação. Por isso o SLO foi definido dentro da API.
- **O `POST /orders` sente a CPU do plano gratuito:** p95 de 496 ms no Render, contra 64 ms no local com cache. Com uma fração de CPU, a reserva de estoque, a trava e a gravação do pedido competem com as leituras.
- **Os percentis "dentro da API"** vêm da diferença entre o histograma `http_request_duration_seconds` antes e depois da rodada, com interpolação linear dentro do bucket (o mesmo cálculo do `histogram_quantile` do Prometheus). Os arquivos estão em `k6/results/render-metrics-*.txt`.
- **Não é comparável 1:1 com o local:** carga 10 vezes menor, catálogo menor e CPU muito menor (ADR-0022).

### Próximo gargalo (não corrigido)

Com o cache desligado, o `POST /orders` ainda tem p95 de 1,5 s. Agora é **fila** no pool de travas, não impasse: erro zero. Com o cache ligado, as leituras deixam de ocupar conexões de trabalho e o p95 cai para 64 ms. A correção de raiz seria a trava por linha (ADR-0019, alternativas descartadas), que não segura conexão nenhuma.
