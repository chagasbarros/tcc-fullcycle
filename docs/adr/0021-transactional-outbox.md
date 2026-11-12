# ADR-0021 — Transactional Outbox para o evento OrderPlaced

- **Status:** Proposto (não implementado)
- **Data:** 2026-11-12
- **Decisor:** Chagas Barros
- **Referência:** Ebook de System Design, módulo 4 ("O pesadelo da consistência: o dual-write problem" e "Padrão Transactional Outbox")
- **Relacionado:** ADR-0004 (Repository), ADR-0009 (reserva de estoque), ADR-0010 (worker), ADR-0016 (Idempotency-Key)

> **Proposto:** o módulo 4 prevê esse status para uma decisão em discussão. O problema e a solução estão descritos aqui. A implementação foi adiada para depois da entrega (13/11).

## Contexto e problema

O `PlaceOrder` (`src/modules/orders/application/place-order.ts`) faz, em sequência:

1. reserva o estoque (transação no PostgreSQL)
2. **salva o pedido** (outra transação no PostgreSQL)
3. **publica `OrderPlaced`** no BullMQ (Redis)

Os passos 2 e 3 são uma **escrita dupla**: dois sistemas diferentes e nenhuma transação que cubra os dois. Se a API cair, ou o Redis falhar, **depois** do commit do pedido e **antes** da publicação, o pedido fica gravado como `PENDING_PAYMENT`, com estoque reservado, e **nenhum evento é publicado**. O pagamento nunca acontece, e o estoque fica preso até alguém intervir.

**Por que só em `orders`:** o `ProcessPayment` também grava o pagamento e depois publica o resultado, mas roda **dentro de um job da fila**. Se a publicação falhar, o job falha, o BullMQ entrega de novo, o consumidor encontra o pagamento já gravado e publica outra vez. O `PlaceOrder` roda dentro da requisição HTTP, e ninguém tenta de novo por ele.

A idempotência que já existe (`jobId = orderId`, a verificação no consumidor, o `UNIQUE(order_id)` em pagamentos) protege contra eventos **repetidos**. O Outbox resolve o problema contrário: o evento **perdido**.

## Fatores de decisão

- Nenhum pedido confirmado pode ficar sem evento (o módulo 4 classifica perda de pedido confirmado como inaceitável)
- Manter a idempotência que já existe
- Respeitar as fronteiras: a tabela de outbox pertence ao módulo `orders`

## Opções consideradas

1. **Transactional Outbox:** gravar o pedido e o evento numa tabela `orders.outbox` **na mesma transação**; um _relay_ lê a tabela e publica no BullMQ
2. **Manter como está** e reconciliar: um job periódico procura pedidos `PENDING_PAYMENT` antigos e republica o evento
3. **Manter como está** e aceitar o risco

## Decisão proposta

**Opção 1, Transactional Outbox**, seguindo os 3 passos do módulo 4:

1. **Transação local ACID:** `OrderRepository.create` grava `orders.orders`, `orders.order_items` e uma linha em `orders.outbox` (`id`, `type = 'OrderPlaced'`, `payload`, `published_at NULL`) num único `$transaction`. Ou tudo é gravado, ou nada é.
2. **Relay:** um processo no worker lê as linhas com `published_at IS NULL` (`FOR UPDATE SKIP LOCKED`, em lotes), publica no BullMQ e marca `published_at`.
3. **Publicação _at-least-once_:** se o relay cair depois de publicar e antes de marcar, publica de novo. Isso é seguro porque o BullMQ recusa o mesmo `jobId = orderId` e o consumidor já verifica o pagamento existente (ADR-0011).

O `PlaceOrder` deixa de chamar `events.publishOrderPlaced` diretamente.

## Consequências esperadas

- **Positivas:**
  - Elimina a perda do `OrderPlaced`: se o pedido existe, o evento vai ser publicado em algum momento
  - O `POST /orders` deixa de depender do Redis para responder
- **Negativas:**
  - **Latência a mais** entre o pedido e o pagamento (o intervalo de leitura do relay, por exemplo 1 s)
  - Um processo e uma tabela a mais para operar e limpar (linhas publicadas antigas)
  - O trace ponta a ponta (ADR-0013) precisa guardar o contexto do trace no payload, senão a API e o worker aparecem como traces separados
- **Não resolve:** a reserva de estoque continua em outra transação (módulo `catalog`), com compensação (ADR-0009)

## Por que não foi implementado agora

O problema foi identificado na revisão do módulo 4, em 12/11, na véspera da entrega. Implementar exige uma migration, o relay, o ajuste do trace e testes de integração da falha. É uma mudança no caminho crítico do pedido, que tem testes de concorrência e números de k6 já medidos. O risco de quebrar o que está validado, um dia antes da entrega, foi considerado maior que o benefício. O risco atual está documentado aqui e em `docs/apresentacao.md` ("o que faria diferente").

## Alternativas descartadas

- **Reconciliação periódica:** é mais simples (sem tabela nova) e conserta o estado depois, mas não evita a janela de inconsistência e precisa adivinhar a partir de quando um `PENDING_PAYMENT` está "esquecido" ou só lento.
- **Aceitar o risco:** é o estado atual, aceitável para o TCC, mas não para produção. Um pedido pago que nunca é cobrado é perda de receita, e o estoque preso afeta outros clientes.
