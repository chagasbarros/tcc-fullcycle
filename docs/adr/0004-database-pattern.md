# ADR-0004 — Database Pattern: Repository

- **Status:** Aceito
- **Data:** 2026-11-12
- **Decisor:** Chagas Barros
- **Referência:** Ebook de System Design, módulo 4
- **Relacionado:** ADR-0002 (monólito modular), ADR-0005 (schema por módulo), ADR-0009 (reserva de estoque), ADR-0021 (Transactional Outbox, proposto)

## Contexto e problema

Os casos de uso precisam ler e gravar no PostgreSQL (via Prisma) sem que a regra de negócio dependa do ORM. Desde 08/11 o projeto usa **Repository**, marcado como provisório até a revisão do módulo 4 do ebook.

Na revisão, feita em 12/11, o módulo 4 traz duas exigências que dependem diretamente de como o acesso a dados é organizado:

- **"Cada módulo gerencia suas próprias tabelas, impedindo que partes externas realizem consultas diretas"**, com comunicação só por contratos públicos (monólito modular)
- **O problema de escrita dupla (_dual-write_)** e o **Transactional Outbox** como solução, que é um padrão de persistência. Ele é tratado no ADR-0021 e **não substitui** o Repository: o Outbox seria gravado através dele.

## Fatores de decisão

- Casos de uso testáveis sem banco (testes unitários rápidos)
- `domain/` e `application/` sem Prisma (regra de fronteira do lint, ADR-0002)
- Cada módulo dono das suas tabelas: nenhum outro módulo consulta as tabelas dele
- Regras de concorrência no banco (reserva atômica, compare-and-set do status) em um único lugar, com nome

## Opções consideradas

1. **Repository:** interfaces (portas) em `application/`, implementações Prisma em `infrastructure/`
2. **Prisma direto nos casos de uso** (estilo Active Record / Transaction Script)

## Decisão

**Opção 1, Repository.**

| Módulo   | Porta (`application/`) | Implementações (`infrastructure/`)                                                                        |
| -------- | ---------------------- | --------------------------------------------------------------------------------------------------------- |
| catalog  | `ProductRepository`    | `PrismaProductRepository`, `CachedProductRepository` (cache-aside, ADR-0014), `InMemoryProductRepository` |
| orders   | `OrderRepository`      | `PrismaOrderRepository`, `InMemoryOrderRepository`                                                        |
| payments | `PaymentRepository`    | `PrismaPaymentRepository`, `InMemoryPaymentRepository`                                                    |

- **As portas falam a língua do negócio, não do SQL:** `reserveStock` (tudo ou nada), `updateStatus(order, expected)` (compare-and-set, ADR-0007), `create` que devolve `false` quando a chave de idempotência já existe (ADR-0016).
- **As implementações em memória** reproduzem essas regras e são usadas nos testes unitários dos casos de uso. As Prisma são testadas contra PostgreSQL real com Testcontainers (`tests/integration/`).
- **As tabelas de outro módulo** só se alcançam pela API pública (`index.ts`) do módulo dono. Por exemplo, `orders` reserva estoque via `CatalogApi`, nunca em `catalog.products`.

## Consequências

- **Positivas:**
  - **Trocar a implementação sem tocar no caso de uso, na prática:** o cache do catálogo (ADR-0014) entrou como um `CachedProductRepository` que embrulha o Prisma, ligado por flag. `ListProducts` não mudou.
  - Testes unitários rápidos (140 em cerca de 1,5 s) sem banco
  - A concorrência fica concentrada e nomeada: a reserva atômica e o compare-and-set ficam no repositório, com testes de integração próprios
- **Negativas:**
  - Mais código: uma interface e duas ou três implementações por agregado
  - As implementações em memória podem divergir do banco. É por isso que existem testes de integração com PostgreSQL real.
  - **A transação não atravessa os repositórios:** reservar o estoque (catalog) e salvar o pedido (orders) são transações separadas, com compensação (`releaseStock`) se a segunda falhar (ADR-0009). O mesmo vale para salvar o pedido e publicar o evento, que é o _dual-write_ do ADR-0021.
  - **Paginação por `OFFSET`** em `ProductRepository.list`: o módulo 4 a aponta como gargalo clássico. Com 5.003 produtos ela não pesou no k6 (mediana de 10 ms com o cache desligado). Se o catálogo crescer, a porta permite trocar por paginação por cursor sem mudar o caso de uso.

## Alternativas descartadas

- **Prisma direto nos casos de uso:** menos arquivos e nenhuma indireção, mas:
  - os casos de uso passariam a depender do ORM, e o lint de fronteira barraria o `application/` importando Prisma;
  - todo teste de caso de uso precisaria de banco;
  - o cache do catálogo teria exigido mudar o caso de uso, em vez de embrulhar o repositório;
  - as regras de concorrência (`UPDATE ... WHERE stock >= q`) ficariam espalhadas pelos casos de uso.
