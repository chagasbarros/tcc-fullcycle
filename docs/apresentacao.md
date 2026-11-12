# Apresentação — material de apoio (16/11/2026)

Roteiro de 10 minutos (`CLAUDE.md`, seção 11). Este arquivo é atualizado ao longo do projeto com números medidos e prints. **Só entram aqui números que foram medidos de verdade**, com data e forma de reproduzir.

| Bloco            | Tempo | Conteúdo                                                                                |
| ---------------- | ----- | --------------------------------------------------------------------------------------- |
| Problema e nível | 1 min | Marketplace como monólito modular (catálogo, pedidos, pagamento) — Projeto A (Avançado) |
| Demo             | 3 min | Sobe com 1 comando, cria pedido, pagamento assíncrono, recusa e estoque devolvido       |
| Decisão técnica  | 3 min | Uma decisão e a alternativa descartada                                                  |
| Números          | 3 min | Concorrência, seed, k6 antes/depois e o que faria diferente                             |

## 1. Problema e nível

- Marketplace com três áreas de negócio: **catálogo** (produtos, preço, estoque), **pedidos** (estados e cancelamento) e **pagamentos** (cobrança via gateways).
- Nível: **Projeto A (Avançado)**. Monólito modular, arquitetura documentada (ADRs + C4) e k6 em 3 estágios.
- Fronteiras entre módulos **garantidas por lint**, não por convenção (ADR-0002).

## 2. Roteiro da demo

1. `docker compose up -d` → mostrar api, worker, postgres e redis saudáveis (`docker compose ps`).
2. `POST /catalog/products` → criar um produto de **R$ 100,00** e outro de **R$ 10,13**.
3. `POST /orders` com `paymentMethod: CARD` no produto de R$ 100,00 → `PENDING_PAYMENT`; em seguida `GET /orders/{id}` → `PAID` (pagamento processado pelo worker via fila).
4. `POST /orders` com cartão no produto de **R$ 10,13** → `PAYMENT_FAILED` (o provider fake recusa valores terminados em 13 centavos, ADR-0011) e **o estoque volta**.
5. Mesmo produto com `paymentMethod: PIX` → `PAID` (Strategy: o provider é escolhido em tempo de execução).
6. `POST /orders/{id}/cancel` duas vezes → `200` e depois `409` (estado final, ADR-0007).
7. Swagger UI em `http://localhost:3000/docs` (e o mesmo em produção: <https://marketplace-api-production.onrender.com/docs>).
8. **Jaeger** (`http://localhost:16686`, serviço `marketplace-api`): abrir o trace do `POST /orders` do passo 3 e mostrar a API e o worker num único trace, com os SQLs da reserva de estoque.
9. **Grafana** (`http://localhost:3001`, abre direto no dashboard "Marketplace — RED"): rate, erros (os `409` do passo 6 aparecem como 4xx) e p95 por rota com a linha de 200 ms do SLO.
10. Copiar o `traceId` de uma linha de log da API (`docker compose logs api`) e achar o mesmo `traceId` nos logs do worker.

## 3. Decisões candidatas para os 3 minutos

| Decisão                                            | Alternativa descartada                        | Por que é boa para apresentar                                    |
| -------------------------------------------------- | --------------------------------------------- | ---------------------------------------------------------------- |
| Reserva atômica de estoque (ADR-0009)              | Só validar o estoque (check-then-act)         | Tem número medido: corrida de 50 pedidos contra estoque 10       |
| Monólito modular com fronteiras no lint (ADR-0002) | Microserviços                                 | Mostra o lint barrando um import indevido                        |
| Um schema do PostgreSQL por módulo (ADR-0005)      | Tudo no `public` com prefixo                  | Fronteira visível no próprio banco (`\dn`)                       |
| Worker em processo separado (ADR-0010)             | Consumers dentro da API                       | Ligado ao p95 medido no k6                                       |
| Trace automático com OpenTelemetry (ADR-0013)      | Spans manuais                                 | 1 pedido = 34 spans em 2 processos, mostrado ao vivo no Jaeger   |
| Idempotency-Key com trava por chave (ADR-0016)     | Chave no Redis com TTL / aceitar 409 enganoso | Teste achou bug real: 9 de 10 duplicatas recebiam `Out of Stock` |
| Staging e produção na mesma instância (ADR-0018)   | Uma instância por ambiente / outro provedor   | Trade-off explícito: dados isolados, recursos compartilhados     |

## 4. Números medidos

### Concorrência e consistência

| Data  | Cenário                                                                                                  | Resultado                                                                                  | Como reproduzir                                   |
| ----- | -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ | ------------------------------------------------- |
| 08/11 | **50 reservas simultâneas** de 1 unidade contra estoque **10** (`PrismaProductRepository` no PostgreSQL) | **10 aceitas, 40 recusadas**, estoque final **0** (nunca negativo)                         | Script com `Promise.all` de 50 `reserveStock`     |
| 08/11 | Reserva de 2 itens em que o 2º não tem estoque                                                           | 1º item volta ao valor original (**rollback** da transação)                                | Mesmo script, item A com estoque 5 e B com 1      |
| 08/11 | **20 cancelamentos simultâneos** do mesmo pedido via HTTP (`POST /orders/{id}/cancel`)                   | **1 × 200 e 19 × 409**; estoque devolvido **uma única vez**                                | 20 `curl` em paralelo contra a API no Docker      |
| 08/11 | Reentrega do mesmo `OrderPlaced` com outro `jobId` (simula crash do worker)                              | Consumer respondeu `duplicate`; **1 pagamento** no banco; estoque não devolvido duas vezes | Job adicionado manualmente na fila `order-placed` |
| 08/11 | Mesmo `OrderPlaced` com o mesmo `jobId`                                                                  | BullMQ **não criou** job novo                                                              | Idem                                              |

### Seed de dados (`npm run db:seed`)

| Data  | Volume                                                                                     | Tempo                     | Observações                                                |
| ----- | ------------------------------------------------------------------------------------------ | ------------------------- | ---------------------------------------------------------- |
| 08/11 | 5.000 produtos · 19.856 clientes · **100.000 pedidos** · 299.711 itens · 94.924 pagamentos | **~60 s** (meta: < 3 min) | Lotes de 5.000 com `createMany`; Docker Desktop no Windows |

- **Reprodutível:** duas execuções geraram o mesmo hash MD5 de pedidos e de produtos (faker com seed fixa e UUID v7 determinísticos).
- **Consistente:** 0 divergências entre total do pedido e soma dos itens, entre status e pagamento, e na regra de recusa (cartão terminado em 13 centavos).
- Distribuição: 94.325 `PAID` · 5.066 `CANCELLED` · 599 `PAYMENT_FAILED` · 10 `PENDING_PAYMENT`.

### Testes

| Data  | Testes                                                                                   | Observação                                                                                   |
| ----- | ---------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| 08/11 | 109 testes unitários e de rotas                                                          | Coverage de `domain/` e `application/` acima do mínimo de 80%                                |
| 09/11 | 112 testes unitários e de rotas                                                          | Inclui regressão do bug encontrado pelo Pact (abaixo)                                        |
| 09/11 | **15 testes de integração** (Testcontainers: PostgreSQL 16 + Redis 7 reais) em **~18 s** | Repositórios Prisma, concorrência, CHECKs, fluxo completo pedido → fila → pagamento → pedido |
| 09/11 | **7 interações** de contrato Pact (consumidor `storefront` → provedor `marketplace-api`) | Verificação do provedor contra a API HTTP real                                               |

**Bug real encontrado pelo teste de contrato (09/11):** `POST /orders/{id}/cancel` respondia **415 Unsupported Media Type** quando o cliente mandava um corpo vazio em _chunked_ sem `Content-Type` (o verificador do Pact faz isso, e alguns clientes HTTP também). Unit tests com `inject` não pegavam, porque não reproduzem esse formato de requisição. Correção: a rota, que não usa corpo, passou a ignorá-lo; um teste de regressão falha sem a correção e passa com ela. Bom exemplo para a apresentação de **por que testar o contrato e não só a lógica**.

### Observabilidade e CI

| Data  | O quê                                                                                | Resultado                                                                                                                    |
| ----- | ------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------- |
| 10/11 | Primeira execução do CI (4 jobs em paralelo)                                         | **Verde na 1ª execução**, ~3 min no total (o job mais lento é o de segurança, 2m43s)                                         |
| 10/11 | Trivy na imagem de runtime                                                           | **10 CVEs HIGH**, todas no npm embutido na `node:22-alpine`; corrigido removendo o npm da imagem final → **0 HIGH/CRITICAL** |
| 10/11 | gitleaks no histórico                                                                | **0 segredos** em 22 commits                                                                                                 |
| 10/11 | Trace de **1 pedido** (`POST /orders` → `order-placed` → worker → `payment-results`) | **34 spans, 2 serviços, 1 único trace**; o mesmo `traceId` nos logs da API e do worker                                       |
| 10/11 | p95 de `GET /catalog/products` no Prometheus (poucas requisições, sem carga)         | **4,9 ms**, contra a meta de 200 ms do SLO (`docs/slo.md`); número real virá do k6                                           |

### Idempotência do pedido (10/11)

| Cenário (PostgreSQL real)                                  | Antes da trava                        | Depois da trava                                                                   |
| ---------------------------------------------------------- | ------------------------------------- | --------------------------------------------------------------------------------- |
| 10 `POST /orders` simultâneos, mesma chave, estoque para 1 | 1 × `201`, **9 × `409 Out of Stock`** | 1 × `201`, 9 × `409 in progress` (+ `Retry-After`); nova tentativa = mesmo pedido |
| Idem, estoque sobrando                                     | —                                     | 1 pedido, estoque reservado 1 vez, 1 evento                                       |

### Deploy no Render (12/11)

| Ambiente   | URL                                                 | Como publica                                          |
| ---------- | --------------------------------------------------- | ----------------------------------------------------- |
| staging    | <https://marketplace-api-staging-7327.onrender.com> | Automático depois do CI verde na `main`               |
| production | <https://marketplace-api-production.onrender.com>   | Depois do staging, com **aprovação manual** no GitHub |

- **Instância compartilhada:** o plano gratuito permite 1 PostgreSQL e 1 Key Value por conta. Os dois ambientes usam a mesma instância, cada um com o seu banco (`marketplace_staging` / `marketplace_production`) e o seu banco lógico no Redis (`/1` / `/0`). Os dados ficam isolados, mas CPU, memória e conexões são compartilhados, e o vencimento de 30 dias vale para os dois.
- **Primeira execução do workflow de deploy (12/11):** staging e produção verdes em **50 s**, com o _smoke test_ (`GET /catalog/products` → 200) passando nos dois. Os dois já estavam no commit publicado, então a espera pela versão nova só fica comprovada no próximo merge.
- **Tropeço real:** a primeira tentativa falhou com `curl: (3) URL rejected: Malformed input`. O _deploy hook_ colado no `gh secret set` (PowerShell) ficou com um caractere invisível. A falha aconteceu **antes** de chamar o Render, então nenhum ambiente foi afetado. A solução foi colar de novo o valor pela interface do GitHub.

### k6 — antes e depois

_(a preencher no dia 12/11: p95, RPS e taxa de erro do baseline e da versão otimizada, gargalo identificado e evidência via `EXPLAIN ANALYZE` / clinic.js)_

| Cenário              | p95 | RPS | Erro | Evidência |
| -------------------- | --- | --- | ---- | --------- |
| Baseline             | —   | —   | —    | —         |
| Depois da otimização | —   | —   | —    | —         |

## 5. O que faria diferente

_(preencher ao fim do projeto)_ Candidatos já identificados:

- **Transactional Outbox:** hoje salvar o pedido e publicar `OrderPlaced` não são atômicos; se a publicação falhar, o pedido fica em `PENDING_PAYMENT` (ADR-0009).
- **Expiração de reservas:** se o worker nunca responder, o estoque fica reservado indefinidamente.
- **Autenticação:** o `customerId` vem no corpo da requisição (ADR-0008).

## 6. Prints

_(a incluir: Grafana com métricas RED, trace ponta a ponta no Jaeger, Swagger UI, CI verde)_

**Lição de operação (10/11):** o disco C: chegou a 0 GB livres, e o Docker Desktop travou e corrompeu os dados dele (erros de _read-only file system_). Limpar o cache do npm (~8 GB) resolveu. Vale verificar o espaço em disco antes da apresentação.
