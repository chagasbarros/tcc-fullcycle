# ADR-0016 — Idempotency-Key no POST /orders: chave no PostgreSQL e trava por chave

- **Status:** Aceito
- **Data:** 2026-11-09
- **Decisor:** Chagas Barros

## Contexto e problema

Clientes repetem requisições: um duplo clique no checkout, um _timeout_ de rede seguido de nova tentativa, um aplicativo que reenvia ao voltar a ter conexão. Sem proteção, cada repetição do `POST /orders` cria **outro pedido**, reserva estoque de novo e gera outra cobrança. O plano de desempenho exige o header `Idempotency-Key` (`CLAUDE.md`, seção 7).

A fila já é idempotente (ADR-0010 e ADR-0011): `jobId = orderId`, o consumidor verifica o pagamento existente e há `UNIQUE(order_id)` em pagamentos. Mas isso protege a partir do pedido. Este ADR trata **da entrada**: impedir que o mesmo pedido vire dois.

Duas perguntas:

1. Onde guardar a chave?
2. O que fazer com duas requisições **simultâneas** com a mesma chave?

## Fatores de decisão

- Nunca criar dois pedidos para a mesma chave, nem sob concorrência e nem se a API cair no meio
- Respostas que o cliente entenda: a repetição deve receber o mesmo pedido, não um erro enganoso
- Não tornar o Redis crítico para a escrita (hoje ele é cache e fila)
- Funcionar com várias instâncias da API

## Opções consideradas

**Onde guardar:**

1. **PostgreSQL:** coluna `idempotency_key` em `orders.orders` e `UNIQUE(customer_id, idempotency_key)`.
2. **Redis com TTL:** `SET chave NX EX 86400` com a resposta guardada.

**Requisições simultâneas** (descoberto por um teste; ver Consequências):

1. **Trava por chave:** `pg_try_advisory_xact_lock`, que não espera; quem não consegue a trava recebe `409` com `Retry-After`.
2. **Aceitar e documentar:** com estoque baixo, as repetições simultâneas recebem `409 Out of Stock`.

## Decisão

**Chave no PostgreSQL e trava por chave.**

- **Chave:** é opcional, tem de 1 a 255 caracteres ASCII visíveis e vale **por cliente**: o mesmo texto usado por clientes diferentes não colide. Fica no próprio pedido e é gravada **na mesma instrução** que o cria. Um pedido sem chave fica com `NULL`, e `NULL` não colide em índice `UNIQUE`.
- **Repetição:** se o cliente já tem um pedido com a chave, a API devolve esse pedido com `201`, o mesmo `Location` e `Idempotent-Replayed: true`, **com o status atual** (por exemplo, `PAID`). Não reserva estoque, não grava nada e não publica outro `OrderPlaced`. Isso é verificado **antes** de tocar no estoque.
- **Mesma chave para um pedido diferente** (outros itens, quantidades ou meio de pagamento): a resposta é `422`. Devolver o pedido antigo esconderia um erro do cliente.
- **Trava:** antes de processar uma requisição com chave, a API tenta `pg_try_advisory_xact_lock(hash(cliente:chave))`, uma trava do PostgreSQL que vale para **todas as instâncias** da API.
  - **Se outra requisição com a mesma chave está em andamento:** a resposta é imediata, `409 Conflict` com `Retry-After: 1` e o detalhe "still in progress", como recomenda o rascunho IETF do header `Idempotency-Key`. A nova tentativa recebe a repetição.
  - **A trava não espera** (_try_): esperar seguraria uma conexão do _pool_ por requisição bloqueada, enquanto a dona da trava precisa de outra conexão para terminar. Com o _pool_ esgotado, o resultado seria um _deadlock_.
  - **A trava é de transação** (_xact_): é liberada sozinha quando a transação termina, mesmo se o processo morrer.
- **Rede de segurança:** o `UNIQUE` continua valendo. Se dois pedidos com a mesma chave chegarem ao `INSERT`, o segundo é recusado, devolve o estoque reservado e responde com o pedido vencedor.
- **Portas:** `IdempotencyLock` e `OrderRepository.findByIdempotencyKey`. As implementações são PostgreSQL (produção e integração) e em memória (testes unitários).

## Consequências

- **Positivas:**
  - **Medido com PostgreSQL real** (10 requisições simultâneas com a mesma chave): **1 pedido**, estoque reservado **uma vez**, **1 evento**, e a nova tentativa recebe o mesmo pedido. Com estoque para exatamente 1 pedido: 1 × `201` e 9 × `409 in progress`.
  - **Bug encontrado por teste antes de existir a trava:** com estoque baixo, 9 das 10 repetições simultâneas recebiam **`409 Out of Stock`**. O primeiro pedido tinha levado o estoque antes de ser gravado, e um cliente com duplo clique veria erro num pedido que deu certo. A trava resolveu o problema; o teste ficou como regressão.
  - Sem dependência nova: só o PostgreSQL, que já é a fonte da verdade do pedido.
- **Negativas:**
  - **A chave não expira.** Ela fica para sempre no pedido. Isso é aceitável (são até 255 bytes por pedido), mas difere do TTL de 24 h comum em APIs de pagamento.
  - **Uma conexão a mais** do _pool_ é usada durante cada requisição com chave, para segurar a trava. **Atualização (12/11):** o k6 mostrou que, com um pool compartilhado, isso vira impasse sob carga. A trava passou a ter um pool próprio (ADR-0019).
  - **Colisão de hash:** o hash de 64 bits pode, em teoria, colidir e gerar um `409 in progress` indevido. A probabilidade é desprezível e o `Retry-After` resolve.
  - O índice antigo `(customer_id)` ficou redundante com o novo `UNIQUE(customer_id, idempotency_key)`, que começa pela mesma coluna. Ele pode ser removido; o caso será avaliado no k6.

## Alternativas descartadas

- **Redis com TTL:** mais rápido e a chave expira sozinha, mas **não é atômico com a criação do pedido**. Se a API morrer entre gravar o pedido e gravar a chave, a nova tentativa cria outro pedido. Além disso, o Redis passaria a ser crítico para a escrita, não só para cache e fila.
- **Aceitar o `409 Out of Stock` nas repetições simultâneas:** nenhum código a mais, mas a mensagem é enganosa justamente no caso que o header existe para proteger, o duplo clique no checkout.
- **Trava que espera** (`pg_advisory_xact_lock`): as repetições receberiam o pedido sem precisar tentar de novo, mas cada requisição bloqueada seguraria uma conexão do _pool_, com risco de _deadlock_ sob carga.
