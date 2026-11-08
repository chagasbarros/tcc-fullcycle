# ADR-0007 — Máquina de estados do pedido com 4 estados

- **Status:** Aceito
- **Data:** 2026-11-08
- **Decisor:** Chagas Barros

## Contexto e problema

O pagamento é processado de forma **assíncrona**: `orders` publica `OrderPlaced` na fila, o worker de `payments` cobra e devolve `PaymentApproved` ou `PaymentFailed` (`CLAUDE.md`, seção 4). Entre a criação do pedido e o resultado do pagamento existe um intervalo em que o pedido aguarda. Precisamos definir quais estados o pedido tem e quais transições são permitidas.

## Fatores de decisão

- Representar o fluxo assíncrono de pagamento
- Regras de transição simples de explicar e de testar
- Base para a idempotência: uma mensagem reentregue pela fila não pode mudar um pedido que já está num estado final
- Prazo curto

## Opções consideradas

1. **4 estados:** `PENDING_PAYMENT`, `PAID`, `PAYMENT_FAILED`, `CANCELLED`
2. 3 estados: `PENDING_PAYMENT`, `PAID`, `PAYMENT_FAILED` (sem cancelamento)

## Decisão

**4 estados.**

```
PENDING_PAYMENT ──PaymentApproved──▶ PAID
       │
       ├──PaymentFailed──▶ PAYMENT_FAILED
       │
       └──cancel()──────▶ CANCELLED
```

- Todo pedido nasce em `PENDING_PAYMENT`.
- Só existem transições **a partir de `PENDING_PAYMENT`**. `PAID`, `PAYMENT_FAILED` e `CANCELLED` são estados finais.
- A regra fica na entidade `Order` (camada `domain/`): uma transição inválida (por exemplo, cancelar um pedido `PAID`) gera erro de domínio, que vira 409 Conflict no HTTP.
- `PAYMENT_FAILED` e `CANCELLED` **devolvem o estoque** reservado (ver ADR-0009).

## Consequências

- **Positivas:**
  - A máquina de estados é pequena e cabe num teste de tabela (estado atual × evento → próximo estado ou erro).
  - Estados finais dão idempotência no consumer: se `PaymentApproved` chegar duas vezes, a segunda é ignorada porque o pedido já não está em `PENDING_PAYMENT`.
  - O cancelamento exercita a devolução de estoque por um segundo caminho, além da falha de pagamento.
- **Negativas:**
  - Existe uma corrida entre cancelar e o resultado do pagamento: o cliente cancela enquanto o worker aprova. Quem chegar primeiro vence, e o segundo recebe erro de transição. Um pagamento aprovado depois do cancelamento exigiria estorno, que **fica fora do escopo** e está registrado aqui como limitação conhecida.
  - Não há estados de logística (enviado, entregue), o que é aceitável para o escopo do TCC.

## Alternativas descartadas

- **3 estados, sem cancelamento:** mais simples, mas a máquina de estados fica trivial, com só duas transições a partir de um único estado, e a devolução de estoque teria um único gatilho. Foi descartada porque o cancelamento custa pouco e torna o domínio mais representativo e mais interessante de testar e apresentar.
