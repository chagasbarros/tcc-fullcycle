# ADR-0009 — Reserva atômica de estoque na criação do pedido, com devolução

- **Status:** Aceito
- **Data:** 2026-11-08
- **Decisor:** Chagas Barros

## Contexto e problema

Ao criar um pedido, `orders` precisa saber se há estoque dos produtos, que pertencem a `catalog`. Pela regra de fronteira, `orders` não acessa as tabelas de `catalog`: usa a API pública do módulo (`CatalogApi`, exportada pelo `index.ts`).

Sob carga (k6), vários pedidos podem disputar a última unidade de um produto ao mesmo tempo. Precisamos decidir o que acontece com o estoque quando o pedido é criado e quando ele não se concretiza.

## Fatores de decisão

- Não vender mais unidades do que existem (corretude sob concorrência)
- Respeitar a fronteira entre módulos
- Simplicidade de implementação e de explicação
- Prazo curto

## Opções consideradas

1. **Reservar ao criar o pedido e devolver se ele não se concretizar**
2. Só validar o estoque, sem alterá-lo

## Decisão

**Reservar e devolver.**

1. **Criação do pedido:** `orders` chama `catalogApi.reserveStock(items)`. O `catalog` baixa o estoque de todos os itens de forma **atômica e tudo-ou-nada**:
   - cada item vira um `UPDATE catalog.products SET stock = stock - q WHERE id = ? AND stock >= q`, em que o próprio banco confere e baixa num único passo, então dois pedidos simultâneos não levam a mesma última unidade;
   - todos os itens rodam numa **única transação**: se um falhar, nenhum é baixado;
   - os itens são **ordenados por ID** antes de executar, para que transações concorrentes travem as linhas na mesma ordem e não ocorra deadlock;
   - itens repetidos do mesmo produto são somados antes (`[{a,1},{a,2}]` vira `[{a,3}]`).
2. **Sem estoque:** o pedido não é criado e a API responde 409 Conflict.
3. **Devolução:** quando o pedido vai para `PAYMENT_FAILED` ou `CANCELLED` (ADR-0007), `orders` chama `catalogApi.releaseStock(items)`.
4. **Preço:** no mesmo momento, `orders` copia nome e preço atuais do produto para o item do pedido (snapshot). Uma mudança de preço posterior não altera pedidos já feitos.

**Evidência (teste manual no PostgreSQL, 08/11):** 50 reservas simultâneas de 1 unidade contra estoque 10 resultaram em exatamente 10 aceitas e 40 recusadas, com estoque final 0. Numa reserva de dois itens em que o segundo não tinha estoque, o primeiro voltou ao valor original (rollback).

## Consequências

- **Positivas:**
  - Não há venda acima do estoque, mesmo sob concorrência, e sem lock explícito no código (o `UPDATE` condicional resolve no banco).
  - A comunicação continua pela API pública: `orders` não conhece as tabelas de `catalog`.
  - Tema concreto para a apresentação e para o k6 (contenção em produtos populares).
- **Negativas:**
  - **A reserva e a criação do pedido não estão na mesma transação**, porque são schemas e módulos diferentes. Se o pedido falhar ao ser salvo depois da reserva, o estoque fica preso. Mitigação: o caso de uso devolve o estoque quando o `save` do pedido falha. A garantia forte (Transactional Outbox) será avaliada com o módulo 4 (`CLAUDE.md`, seção 12).
  - Se o worker de pagamento nunca responder, o estoque fica reservado indefinidamente. Uma expiração de reservas pendentes fica fora do escopo e é registrada aqui como limitação conhecida.
  - Mais código e mais testes do que só validar.

## Alternativas descartadas

- **Só validar o estoque:** bem mais simples, porque `orders` só confere `stock >= quantidade` e copia o preço. Foi descartada porque, entre a validação e o pagamento, dois pedidos simultâneos podem vender a mesma última unidade (race condition do tipo _check-then-act_), e esse é justamente o cenário que o teste de carga provoca.
- **Lock pessimista (`SELECT ... FOR UPDATE`) e depois `UPDATE`:** também correto, mas usa duas instruções por item e segura o lock por mais tempo. O `UPDATE` condicional consegue o mesmo resultado numa instrução só.
