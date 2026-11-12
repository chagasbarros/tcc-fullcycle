# ADR-0019 — Pool de conexões separado para a trava de idempotência

- **Status:** Aceito
- **Data:** 2026-11-12
- **Decisor:** Chagas Barros
- **Relacionado:** ADR-0016 (Idempotency-Key), `docs/desempenho.md`

## Contexto e problema

O k6 do baseline (300 usuários virtuais, cache desligado) mostrou a API travando: p95 de **3,9 s** no `GET /catalog/products` (meta do SLO: 200 ms) e **36,9% de erro** no `POST /orders`, com `P2028 — Unable to start a transaction in the given time`.

Durante a carga, o `pg_stat_activity` mostrou o pool da API inteiro, **10 de 10 conexões**, em `idle in transaction`.

A causa é a trava do ADR-0016. Cada `POST /orders` com `Idempotency-Key` abre uma transação **só para segurar** o `pg_try_advisory_xact_lock`, e essa transação ocupa uma conexão. O trabalho do pedido (reservar estoque, salvar o pedido) precisa de **outras** conexões. Com 10 pedidos simultâneos e um pool de 10, os 10 seguram as 10 conexões como trava e ficam esperando uma 11ª que nunca chega. As leituras do catálogo entram na mesma fila. O ADR-0016 já citava o custo ("uma conexão a mais do _pool_"), mas não o impasse.

## Fatores de decisão

- Eliminar o impasse, e não só adiá-lo
- Manter a semântica do ADR-0016 (a mesma chave nunca roda duas vezes ao mesmo tempo)
- Mudança pequena e explicável, na véspera da entrega
- Não acrescentar dependências

## Opções consideradas

1. **Aumentar o pool** (`DATABASE_POOL_MAX`, por exemplo 30)
2. **Pool separado para a trava:** um segundo `PrismaClient`, com pool próprio, usado só pela `PostgresIdempotencyLock`
3. **Trocar a trava por uma linha:** o pedido "reivindica" a chave com um `INSERT` (UNIQUE) e ninguém segura conexão

## Decisão

**Opção 2.** Em `src/server.ts`, a `PostgresIdempotencyLock` recebe o seu próprio `PrismaClient` (`IDEMPOTENCY_LOCK_POOL_MAX`, padrão 10). O trabalho continua no client principal (`DATABASE_POOL_MAX`, padrão 10).

**Por que não há mais impasse:** quem segura a trava usa conexões do pool de travas, e o trabalho usa conexões do outro pool. Um pedido esperando trava nunca segura uma conexão de trabalho. Por isso não existe mais o ciclo "seguro a trava e espero trabalho que está preso por quem segura trava". No pior caso, os pedidos **esperam a vez** no pool de travas: isso é fila, não impasse.

A classe `PostgresIdempotencyLock` não mudou. Só mudou o client que ela recebe na composição.

## Consequências

- **Positivas (medido com k6, mesmas condições do baseline):**
  - `GET /catalog/products` p95: **3.867 ms → 97 ms** (dentro do SLO)
  - `POST /orders`: erro de **36,9% → 0%**
  - Throughput: **168 → 603 req/s**
  - Teste de integração de regressão (`tests/integration/idempotency-key.test.ts`): com um pool compartilhado de 2 conexões e 6 pedidos simultâneos, aparecem `500`. Com pools separados, os 6 pedidos são criados.
- **Negativas:**
  - **Mais conexões no PostgreSQL:** até 20 por processo da API, em vez de 10. No Render, a mesma instância serve staging e produção (ADR-0018), então são até 40 no total. O `max_connections` da instância é **100** (conferido em 12/11, com o connection pooling do Render desligado): sobra folga para as migrations no start, o `psql` de manutenção e as conexões do próprio Render.
  - **A espera continua:** com o cache desligado, o `POST /orders` ficou com p95 de 1,5 s, porque os pedidos com chave fazem fila no pool de travas. Com o cache ligado, as leituras liberam o pool de trabalho e o p95 cai para 64 ms.
  - Dois números para ajustar em vez de um.

## Alternativas descartadas

- **Só aumentar o pool:** são 3 linhas e o número do k6 melhoraria, mas **o impasse continua existindo**. Com N pedidos com chave simultâneos e um pool de tamanho N, tudo trava de novo. O problema só mudaria de lugar.
- **Trava por linha (`INSERT` da chave):** elimina a causa (nenhuma conexão fica parada segurando trava), mas exige reescrever o ADR-0016 e os testes de concorrência, e tratar chaves "órfãs" de requisições que morreram no meio. Fica como evolução em "o que faria diferente".
