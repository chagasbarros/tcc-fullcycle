# ADR-0012 — Teste de contrato com Pact e consumidor simulado

- **Status:** Aceito
- **Data:** 2026-11-09
- **Decisor:** Chagas Barros

## Contexto e problema

O curso exige **teste de contrato de API** (`tests/contract/`), com Pact como ferramenta padrão do projeto (`CLAUDE.md`, seção 3). O Pact segue o modelo _consumer-driven contract_: o **consumidor** da API descreve as requisições que faz e as respostas de que precisa, e o **provedor** é verificado contra esse contrato.

O problema é que este projeto **não tem consumidor real**. Não existe frontend nem outro serviço chamando a API. Os módulos internos conversam pela API pública (`index.ts`) e pela fila, não por HTTP. É preciso decidir quem faz o papel de consumidor e como o contrato é gerado e verificado.

## Fatores de decisão

- Atender ao entregável "teste de contrato de API" de forma que o autor saiba explicar
- Pegar quebras de contrato que os testes unitários (`app.inject`) não pegam
- Rodar localmente e no CI, sem infraestrutura extra
- Prazo curto (um dia de trabalho para integração e contrato)

## Opções consideradas

1. **Pact com consumidor simulado:** um cliente HTTP mínimo (`storefront`), escrito só para o teste, descreve o que uma loja virtual precisaria da API. O provedor (`marketplace-api`) é verificado contra o arquivo de pact gerado.
2. **Validar as respostas contra a OpenAPI** (_schema-driven_): os testes chamam a API e conferem cada resposta com o `docs/openapi.yaml`, sem consumidor.

## Decisão

**Opção 1 — Pact com consumidor simulado.**

- **Consumidor** (`tests/contract/storefront.consumer.test.ts`): o `StorefrontClient` (fetch) exercita 7 interações contra o mock server do Pact:
  - listar produtos;
  - consultar produto;
  - produto inexistente (404);
  - criar pedido;
  - consultar pedido;
  - cancelar pedido;
  - cancelar pedido já cancelado (409).

  Os _matchers_ verificam tipo e formato (UUID, inteiro, data ISO, enum por regex), não valores exatos.

- **Provedor** (`tests/contract/marketplace-api.provider.test.ts`): sobe o app Fastify **real**, com rotas, validação Zod, Problem Details e casos de uso, ouvindo numa porta aleatória. Usa repositórios em memória, que cada _provider state_ reinicia, e reproduz cada interação do pact.
- **Arquivo de pact:** é gerado a cada execução em `tests/contract/pacts/` (fora do Git). O script `npm run test:contract` roda o consumidor e depois o provedor. Não há Pact Broker: o arquivo local é a ponte entre os dois lados.

## Consequências

- **Positivas:**
  - O teste já se pagou. A verificação do provedor revelou que o `POST /orders/{id}/cancel` respondia **415** quando o cliente mandava um corpo vazio _chunked_ sem `Content-Type`. Isso acontece com clientes HTTP reais, e os testes com `app.inject` não reproduziam. O bug foi corrigido com teste de regressão (commit `fix(orders)`).
  - O teste passa por HTTP de verdade (socket, headers, serialização), não pela injeção em memória do Fastify.
  - O contrato documenta, de forma executável, o que um cliente espera, inclusive o formato dos erros (RFC 9457).
  - Se um consumidor real surgir, ele assume o papel do `storefront` sem mudar o lado do provedor.
- **Negativas:**
  - O contrato foi escrito pelo próprio autor da API. O valor central do _consumer-driven_ (o consumidor impor ao provedor o que precisa) fica **simulado**. Na apresentação, isso deve ser dito com clareza.
  - Sem Pact Broker não há histórico de versões nem `can-i-deploy`. Com um único repositório e sem deploys independentes, isso não faz falta hoje.
  - O contrato e a OpenAPI são mantidos separadamente e podem divergir. O Spectral valida a OpenAPI, mas não a compara com o pact.
  - O provedor usa repositórios em memória. O banco real já é coberto pelos testes de integração (Testcontainers).

## Alternativas descartadas

- **Validar respostas contra a OpenAPI:** reaproveitaria o `docs/openapi.yaml` como fonte única e evitaria a divergência entre contrato e especificação. Foi descartada por três motivos:
  - Verifica o que **a API diz que faz**, não o que **um cliente precisa**. Um campo removido que nenhum cliente usa e um campo removido que quebra a loja virtual pareceriam iguais.
  - Não é a ferramenta indicada na stack do projeto.
  - Rodaria com `app.inject` e não teria encontrado o bug do 415.

  Pode ser acrescentada no futuro, como complemento, para garantir que a OpenAPI e a implementação não se afastem.

- **Pact Broker (PactFlow ou self-hosted):** seria o caminho com vários repositórios e consumidores reais, mas acrescentaria um serviço ao compose e um segredo ao CI sem benefício para um único repositório.
