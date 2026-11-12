# ADR-0011 — Providers de pagamento fake determinísticos e meio de pagamento no pedido

- **Status:** Aceito
- **Data:** 2026-11-08
- **Decisor:** Chagas Barros

## Contexto e problema

O módulo `payments` cobra os pedidos por meio de _providers_ (gateways). O projeto não integra com gateways reais, então usa providers **fake**: `FakeCardProvider` (cartão) e `FakePixProvider` (Pix). Eles ficam atrás da interface `PaymentProvider` e são escolhidos em tempo de execução pelo meio de pagamento. É o padrão Strategy, confirmado depois da revisão do módulo 4 (ADR-0003).

Duas perguntas precisam de resposta:

1. Como um provider fake decide **aprovar ou recusar**?
2. De onde vem o **meio de pagamento** de cada pedido?

## Fatores de decisão

- Testes automatizados reproduzíveis
- Demo previsível na apresentação (mostrar aprovação e recusa quando quiser)
- Possibilidade de simular a latência de um gateway real no k6
- Mudança mínima na API de pedidos

## Opções consideradas

**Decisão de aprovação:**

1. **Regra determinística** baseada nos dados do pedido
2. Aleatório, com taxa de recusa configurável

**Meio de pagamento:**

1. **Campo `paymentMethod` (`CARD` | `PIX`) no corpo do `POST /orders`**, levado no evento `OrderPlaced`
2. Meio de pagamento fixo por configuração

## Decisão

**Regra determinística e `paymentMethod` no pedido.**

- `FakeCardProvider` **recusa** quando o valor termina em **13 centavos** (`amountInCents % 100 === 13`) e aprova os demais. Na demo, um produto de R$ 10,13 sempre gera recusa.
- `FakePixProvider` **sempre aprova**.
- Uma **latência artificial** é configurável pela variável de ambiente `PAYMENT_PROVIDER_LATENCY_MS` (padrão `0`), para simular um gateway real no k6 sem perder o determinismo.
- O pedido guarda o `paymentMethod` (coluna `payment_method` em `orders.orders`), e o evento `OrderPlaced` o carrega até o worker, que escolhe o provider correspondente.
- Cada cobrança recebe o `orderId` como **chave de idempotência**, como seria feito com um gateway real, para que uma reentrega da fila não cobre duas vezes.

## Consequências

- **Positivas:**
  - Testes e demo reproduzíveis: o resultado depende só do valor e do meio de pagamento.
  - O padrão Strategy fica visível: um terceiro meio de pagamento (por exemplo, boleto) é uma nova classe que implementa `PaymentProvider`, sem alterar o caso de uso (aberto/fechado).
  - A latência configurável permite medir o efeito de um gateway lento no worker sem afetar a API (ADR-0010).
- **Negativas:**
  - A regra dos "13 centavos" é artificial e não representa motivos reais de recusa (saldo, fraude, cartão expirado).
  - O `POST /orders` passa a exigir `paymentMethod` (mudança no contrato da API, refletida na OpenAPI).
  - Com providers fake, nenhuma falha de rede de um gateway real é exercitada. As novas tentativas da fila (retry com backoff do BullMQ) são testadas só com erros simulados.

## Alternativas descartadas

- **Aprovação aleatória com taxa configurável:** mais parecida com a produção sob carga, mas os testes precisariam controlar a semente aleatória e a demo não seria previsível (não dá para garantir uma recusa ao vivo). A latência configurável já cobre a necessidade de realismo no k6.
- **Meio de pagamento fixo por configuração:** não muda a API, mas só um provider seria usado de cada vez, e o Strategy, cuja razão de existir é escolher a implementação em tempo de execução, deixaria de ser demonstrável.
