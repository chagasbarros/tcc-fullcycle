# ADR-0003 — SOLID e design pattern: Strategy nos meios de pagamento

- **Status:** Aceito
- **Data:** 2026-11-12
- **Decisor:** Chagas Barros
- **Referência:** Ebook de System Design, módulo 4
- **Relacionado:** ADR-0002 (monólito modular), ADR-0011 (providers fake)

## Contexto e problema

O curso pede um design pattern justificado, ligado a SOLID. Desde 08/11 o módulo `payments` usa **Strategy**, marcado como provisório até a revisão do módulo 4 do ebook.

Na revisão, feita em 12/11, o módulo 4 trata de padrões de **arquitetura e integração**: monólito modular, bounded contexts, Transactional Outbox, Circuit Breaker, idempotência e cache-aside. **Não trata de padrões de projeto (GoF).** O critério que ele propõe é outro: "o que precisa ser fácil de mudar?" e "toda decisão troca uma propriedade por outra". Este ADR aplica esse critério ao `payments`.

**O que precisa ser fácil de mudar:** os meios de pagamento. Hoje são cartão e Pix, e um marketplace real acrescenta outros (boleto, carteira digital) ou troca de gateway. A regra de cobrança do caso de uso (não cobrar duas vezes, registrar o resultado, publicar `PaymentApproved` ou `PaymentFailed`) não deveria mudar quando isso acontece.

## Fatores de decisão

- Um meio de pagamento novo não pode exigir alteração no caso de uso
- O caso de uso precisa ser testável sem gateway real
- Código simples, que o autor consiga explicar
- Encaixar nas fronteiras do monólito modular (porta em `application/`, implementações em `infrastructure/`)

## Opções consideradas

1. **Strategy:** interface `PaymentProvider` e uma classe por meio de pagamento, escolhida em tempo de execução
2. **`if`/`switch` no caso de uso:** um ramo por meio de pagamento dentro de `ProcessPayment`
3. **Circuit Breaker** em volta dos providers (padrão citado no módulo 4)

## Decisão

**Opção 1, Strategy.**

- **A porta:** `PaymentProvider` (`src/modules/payments/application/payment-provider.ts`), com `method` e `charge()`.
- **As estratégias:** `FakeCardProvider` e `FakePixProvider` (`infrastructure/fake-providers.ts`, ADR-0011).
- **A escolha em tempo de execução:** `ProcessPayment` monta um `Map<PaymentMethod, PaymentProvider>` e escolhe pelo `paymentMethod` do evento `OrderPlaced`. Sem provider para o meio, o caso de uso falha explicitamente.
- **A composição:** `src/worker-runtime.ts` decide quais providers existem. O caso de uso não conhece nenhuma classe concreta.

**Os princípios SOLID que isso mostra:**

| Princípio                      | Onde                                                                                                                                                                                                                            |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **O**: aberto/fechado          | Boleto seria uma classe nova que implementa `PaymentProvider`, registrada na composição. `ProcessPayment` não muda.                                                                                                             |
| **D**: inversão de dependência | `ProcessPayment` (application) depende da interface. As implementações ficam em `infrastructure/` e são injetadas no construtor.                                                                                                |
| **S**: responsabilidade única  | O provider só cobra. Idempotência, persistência e publicação do resultado ficam no caso de uso.                                                                                                                                 |
| **L**: substituição de Liskov  | As duas implementações cumprem o mesmo contrato (`ChargeResult`). O teste do caso de uso (`process-payment.spec.ts`) troca-as por um `CountingProvider`, que as embrulha para contar as cobranças, e o caso de uso nem percebe. |

## Consequências

- **Positivas:**
  - Um meio de pagamento novo não toca no caso de uso, nem nos testes dele
  - O caso de uso é testado com providers determinísticos (`process-payment.spec.ts`), sem rede
  - Mostrado na demo: o mesmo produto de R$ 10,13 é recusado no cartão e aprovado no Pix (`docs/apresentacao.md`)
- **Negativas:**
  - Mais arquivos e uma indireção a mais do que um `if`, para apenas 2 meios hoje
  - A escolha depende de um `Map` montado na composição: um meio esquecido ali só aparece em tempo de execução, como erro explícito do caso de uso

## Alternativas descartadas

- **`if`/`switch` no caso de uso:** menos código com 2 meios, mas cada meio novo altera e reabre o caso de uso e os testes dele (viola o aberto/fechado), e a regra de cobrança se mistura com detalhes de cada gateway.
- **Circuit Breaker:** é um padrão de **resiliência** e resolve outro problema, o de não insistir num gateway que está falhando. Ele não substitui o Strategy: os dois se combinariam, com um breaker em volta de cada provider. Como os providers são fakes e não falham por rede, hoje o benefício seria só demonstrativo. Fica como evolução para quando houver gateway real.
