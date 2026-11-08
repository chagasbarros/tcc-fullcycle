# ADR-0006 — IDs UUID v7 gerados com a lib `uuid`

- **Status:** Aceito
- **Data:** 2026-11-08
- **Decisor:** Chagas Barros

## Contexto e problema

A convenção do projeto (`CLAUDE.md`, seção 9) define que todos os IDs são **UUID v7**. O v7 começa com o timestamp em milissegundos, então IDs novos são sempre maiores que os antigos. Isso faz com que os inserts caiam no fim do índice da chave primária (B-tree), em vez de páginas aleatórias como acontece com o v4. Com 100 mil pedidos ou mais no seed, isso reduz a fragmentação do índice e melhora a velocidade de inserção.

O Node.js só gera UUID v4 nativamente (`crypto.randomUUID()`). Precisamos decidir como gerar o v7.

Os IDs são gerados pela **aplicação** (camada `application/`), não pelo banco, para que a entidade já tenha ID antes de ser salva e para que o mesmo ID possa ser usado como `jobId` no BullMQ (idempotência da fila).

## Fatores de decisão

- Corretude em relação à RFC 9562 (UUID v7)
- Código que o autor consiga explicar
- Pouca manutenção, dado o prazo curto

## Opções consideradas

1. **Lib `uuid`** (`import { v7 } from 'uuid'`)
2. Função própria em `shared/` (cerca de 15 linhas com `crypto.getRandomValues` e o timestamp)

## Decisão

**Lib `uuid`.** A geração fica isolada em `src/shared/ids.ts` (função `newId()`) e chega aos casos de uso por injeção (`newId: () => string`). Assim os testes usam IDs fixos e a lib pode ser trocada mudando um único arquivo.

## Consequências

- **Positivas:** implementação padrão do ecossistema, testada e compatível com a RFC 9562. Nenhum código nosso para manter. A injeção de `newId` deixa os testes determinísticos.
- **Negativas:** uma dependência a mais em produção. O timestamp no ID revela quando o registro foi criado, o que é aceitável aqui porque os IDs não são segredos.

## Alternativas descartadas

- **Função própria:** sem dependência e didática, porque daria para explicar o layout bit a bit (48 bits de timestamp, versão, variante e bits aleatórios). Foi descartada porque é código de infraestrutura que teríamos que testar contra a RFC, e um erro sutil (por exemplo, nos bits de versão e variante) geraria IDs inválidos sem nenhum erro visível. O ganho didático não compensa o risco no prazo.
- **UUID v4 com `crypto.randomUUID()`:** nativo e sem dependência, mas contraria a convenção do projeto e piora a inserção em índices grandes, que é justamente o cenário do seed e do k6.
