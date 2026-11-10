# ADR-0014 — Cache-aside do catálogo no Redis com tolerância de 60 s

- **Status:** Aceito
- **Data:** 2026-11-10
- **Decisor:** Chagas Barros

## Contexto e problema

`GET /catalog/products` é a rota de maior volume e a do SLO (`docs/slo.md`). Toda chamada vai ao PostgreSQL: uma consulta paginada e um `COUNT`. O plano de desempenho pede **cache com tolerância declarada** (`CLAUDE.md`, seção 7).

A complicação é o **estoque**. Ele muda a cada pedido (reserva) e a cada pagamento recusado ou cancelamento (devolução). Se o cache for invalidado a cada mudança de estoque, sob carga de pedidos ele é apagado o tempo todo e quase não ajuda.

## Fatores de decisão

- Reduzir a latência e a carga no banco na leitura do catálogo
- Não vender o que não existe (consistência do estoque no pedido)
- Poder desligar o cache sem deploy (kill switch, ADR-0015)
- Um problema no Redis não pode derrubar a leitura

## Opções consideradas

1. **Aceitar até 60 s de defasagem no estoque:** invalidar o cache só quando um produto é criado ou alterado.
2. **Invalidar a cada pedido:** toda reserva ou devolução de estoque também apaga o cache.

## Decisão

**Opção 1 — cache-aside com TTL de 60 s; o estoque exibido pode estar até 60 s defasado.**

- **Onde:** `CachedProductRepository`, um **Decorator** sobre `ProductRepository` (`src/modules/catalog/infrastructure/`). Os casos de uso não sabem que o cache existe; a composição em `server.ts` decide usá-lo.
- **O que vai para o cache:** `findById` (chave `catalog:product:{id}`, `SET ... EX 60`) e `list` (todas as páginas num **único hash** `catalog:products:list`, com `EXPIRE ... NX`). Com o hash, um único `DEL` invalida todas as páginas, sem `SCAN`. Com o `NX`, o TTL não é empurrado pelas páginas seguintes, então nenhuma página passa de 60 s.
- **Invalidação:** `save` (criar ou alterar produto) apaga o produto e todas as páginas. Isso acontece **mesmo com a flag desligada**, para que religar o cache nunca sirva dado velho.
- **O que não vai para o cache:** `findManyByIds` (preço e nome usados pelo pedido), `reserveStock` e `releaseStock`. Tudo o que decide um pedido lê o banco.
- **Falha do Redis:** o Decorator trata qualquer erro do Redis como _miss_, registra um aviso e lê do banco. O cache usa uma **conexão própria** que falha rápido: sem fila offline e com _timeout_ de 250 ms. A conexão do BullMQ espera o Redis indefinidamente, e um cache que trava é pior que nenhum.

## Consequências

- **Positivas:**
  - Sob carga, a listagem passa a vir da memória do Redis em vez de consulta e `COUNT` no banco. O ganho será medido no k6 (`docs/desempenho.md`).
  - **Seguro para o negócio:** o pedido verifica o estoque de forma atômica no banco (ADR-0009). O pior caso é a listagem mostrar "tem estoque" e o pedido responder `409`.
  - O cache pode ser ligado e desligado em segundos pela flag `catalog-cache-enabled` (verificado em 10/11 com o Unleash local).
  - Testado contra Redis real (Testcontainers): acerto do cache, TTL, invalidação, defasagem do estoque, flag desligada e Redis fora do ar.
- **Negativas:**
  - **Defasagem visível:** um cliente pode ver estoque 10 quando restam 7, por até 60 s.
  - Com várias instâncias da API, todas compartilham o mesmo Redis, mas cada uma lê a flag por conta própria. Durante a troca da flag, as instâncias podem discordar por alguns segundos.
  - O worker devolve estoque sem passar pelo cache. Isso é coerente com a decisão (estoque não invalida), mas precisa ser explicado.
  - Mais uma conexão Redis por instância da API.

## Alternativas descartadas

- **Invalidar a cada pedido:** a listagem estaria sempre correta, mas sob carga de pedidos o cache seria apagado continuamente. A taxa de acerto cairia, o antes e depois do k6 mostraria pouco ganho, e cada pedido custaria chamadas extras ao Redis. A correção que importa (não vender sem estoque) já é garantida pela reserva atômica.
- **Cache no caso de uso ou na rota HTTP:** misturaria a regra de cache com a lógica de negócio ou com o Fastify. O Decorator mantém o cache como detalhe de infraestrutura, trocável e testável isoladamente.
