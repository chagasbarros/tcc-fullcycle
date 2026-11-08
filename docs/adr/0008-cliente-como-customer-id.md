# ADR-0008 — Cliente representado só por `customerId` no pedido

- **Status:** Aceito
- **Data:** 2026-11-08
- **Decisor:** Chagas Barros

## Contexto e problema

O seed precisa de cerca de 20.000 clientes fazendo 100.000 pedidos ou mais (`CLAUDE.md`, seção 5). Porém o escopo do projeto tem só três módulos de negócio (`catalog`, `orders`, `payments`) e nenhum deles é de clientes. Autenticação e cadastro de usuários também estão fora do escopo.

Precisamos decidir como o cliente aparece nos dados.

## Fatores de decisão

- Não criar um quarto módulo de negócio fora do escopo pedido
- Respeitar a posse dos dados por módulo (ADR-0005)
- Nenhum caso de uso atual lê dados do cliente (nome, e-mail)
- Prazo curto

## Opções consideradas

1. **Só `customerId` (UUID) no pedido**, sem tabela de clientes
2. Tabela `orders.customers` com nome e e-mail

## Decisão

**Só `customerId` no pedido.** O cliente é tratado como uma **identidade externa**: num sistema real, o ID viria de um provedor de identidade (por exemplo, o `sub` de um token JWT). O pedido guarda `customer_id UUID NOT NULL`, com índice para consultar os pedidos de um cliente. O seed gera 20.000 UUIDs e distribui os pedidos entre eles.

Enquanto não há autenticação, o `customerId` chega no corpo do `POST /orders`.

## Consequências

- **Positivas:** nenhum módulo ou tabela sem caso de uso. A fronteira continua clara, porque `orders` só guarda o ID, como faria com qualquer sistema externo. O seed fica mais simples e mais rápido.
- **Negativas:**
  - Não existe validação de que o cliente existe: qualquer UUID é aceito. Com autenticação, o ID viria do token e a validação seria do provedor de identidade.
  - Receber `customerId` no corpo da requisição permite criar pedido em nome de outro cliente. Isso é aceitável sem autenticação no escopo e está registrado aqui como limitação conhecida.

## Alternativas descartadas

- **Tabela `orders.customers`:** dados mais realistas no seed, mas guarda dados pessoais (nome, e-mail) dentro do módulo de pedidos, misturando responsabilidades, e nenhum caso de uso usaria esses dados. Se clientes forem necessários no futuro, o caminho certo é um módulo `customers` dono desses dados, não uma tabela dentro de `orders`.
