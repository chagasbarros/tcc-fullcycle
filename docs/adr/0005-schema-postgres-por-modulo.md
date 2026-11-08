# ADR-0005 — Um schema do PostgreSQL por módulo

- **Status:** Aceito
- **Data:** 2026-11-07
- **Decisor:** Chagas Barros

## Contexto e problema

O marketplace é um monólito modular (catálogo, pedidos, pagamento) que usa um único banco PostgreSQL 16. A regra de arquitetura (`CLAUDE.md`, seção 4) diz que **cada módulo é dono das suas tabelas** e que não pode haver JOIN entre tabelas de módulos diferentes: um módulo só acessa os dados de outro pela API pública dele (`index.ts`) ou pela fila.

No código, essa fronteira já é garantida pelo `eslint-plugin-boundaries`. Falta decidir como ela aparece no banco: as tabelas de todos os módulos ficam juntas ou separadas?

## Fatores de decisão

- Deixar visível a quem pertence cada tabela, no banco e na apresentação
- Dificultar JOINs e foreign keys entre módulos
- Facilitar uma eventual extração de um módulo para um serviço próprio (o schema sai inteiro)
- Pouca complexidade extra com o Prisma 7 e as migrations
- Prazo curto (entrega em 13/11/2026)

## Opções consideradas

1. **Um schema do PostgreSQL por módulo** (`catalog.products`, `orders.orders`, `payments.payments`)
2. Tudo no schema `public`, com prefixo no nome da tabela (`catalog_products`)
3. Um banco de dados por módulo

## Decisão

**Um schema do PostgreSQL por módulo.**

O `datasource` do Prisma declara `schemas = ["catalog", "orders", "payments"]` e cada model declara `@@schema("<módulo>")`. A primeira migration de cada módulo cria o schema dele (`CREATE SCHEMA IF NOT EXISTS`). A primeira tabela é `catalog.products`.

Regras que acompanham a decisão:

- Todo model declara `@@schema(...)` do módulo dono.
- **Nenhuma relação do Prisma (`@relation`) e nenhuma foreign key entre schemas diferentes.** Referências a outro módulo guardam só o ID (por exemplo, `orders.order_items.product_id` sem FK para `catalog.products`), e a consistência é garantida pela API pública do outro módulo ou por eventos na fila.
- As invariantes do domínio também viram `CHECK` constraints no banco (por exemplo, `price_in_cents >= 0`), como segunda linha de defesa.

## Consequências

- **Positivas:**
  - A posse dos dados fica explícita no próprio banco: `\dn` no `psql` mostra um schema por módulo.
  - A fronteira do código (ESLint) passa a existir também nos dados.
  - Extrair um módulo no futuro fica mais simples, porque o schema dele já está isolado e não tem FKs com os outros.
  - Abre caminho para permissões por schema (um usuário do banco por módulo), se for necessário.
- **Negativas:**
  - Sem FK entre módulos, o banco não impede um `product_id` que não existe num pedido. Isso precisa ser validado na aplicação (o caso de uso de pedidos consulta o catálogo).
  - Todo model precisa de `@@schema(...)`, e o SQL das migrations fica com nomes qualificados (`"catalog"."products"`).
  - Hoje todos os módulos usam o mesmo usuário do banco. O isolamento por permissão não foi implementado: a separação é estrutural, e a garantia contra JOIN continua vindo do código (repositórios só acessam as próprias tabelas).

## Alternativas descartadas

- **Tudo no schema `public` com prefixo no nome:** é a opção mais simples e a padrão do Prisma, mas a fronteira vira só uma convenção de nome. Nada no banco diferencia `catalog_products` de `orders_orders`, e criar uma FK ou um JOIN entre módulos não chama atenção. Foi descartada porque enfraquece justamente a regra principal do monólito modular.
- **Um banco por módulo:** é o isolamento mais forte, mas exige três conexões, três configurações de Prisma e migrations separadas, além de mais serviços no compose. É um custo de microserviços sem os benefícios de deploy independente. Fica como evolução possível: com um schema por módulo, essa migração depois fica mais fácil.
