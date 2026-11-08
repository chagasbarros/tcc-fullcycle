# ADR-0001 — Fastify como framework HTTP

- **Status:** Aceito
- **Data:** 2026-11-07
- **Decisor:** Chagas Barros

## Contexto e problema

O marketplace (Projeto A) é um monólito modular com três módulos: catálogo, pedidos e pagamento. Ele precisa de fronteiras explícitas entre os módulos, de bom desempenho de p95 sob carga (k6 em 3 estágios) e de integração com OpenAPI 3.1, OpenTelemetry e métricas RED. Precisamos de um framework HTTP para Node.js + TypeScript.

O curso também exige que o autor saiba explicar todo o código. Na apresentação, uma das decisões técnicas será defendida junto com a alternativa descartada.

## Fatores de decisão

- Código explicável, com pouca "mágica" de framework
- Desempenho (latência e throughput) para a meta de p95
- Integração com schemas (Zod/JSON Schema → OpenAPI), pino, OpenTelemetry e Prometheus
- Prazo curto (entrega em 13/11/2026)

## Opções consideradas

1. **Fastify**
2. NestJS
3. Express

## Decisão

**Fastify.**

O Fastify tem logger pino nativo, validação e serialização por schema (que alimenta a OpenAPI) e um sistema de plugins encapsulados que serve para registrar cada módulo. Também tem overhead baixo, o que ajuda no p95. Sem decorators nem injeção de dependência implícita, cada linha de composição fica visível no `app.ts`, e isso torna o código mais fácil de explicar.

## Consequências

- **Positivas:** controle explícito da composição dos módulos; bom desempenho; pino e schemas sem configuração extra.
- **Negativas:** a fronteira entre módulos não vem pronta do framework. Ela será garantida por convenção (`index.ts` como API pública de cada módulo) e por lint (`eslint-plugin-boundaries` no CI). A injeção de dependência será feita à mão (composição no `app.ts`).

## Alternativas descartadas

- **NestJS:** tem módulos e injeção de dependência prontos, o que combina com um monólito modular. Foi descartado porque decorators e injeção implícita escondem a composição, e isso aumenta o risco de ter código que o autor não consegue explicar na apresentação. Além disso, o tempo de aprendizado não cabe no prazo.
- **Express:** é simples e conhecido, mas não tem validação por schema nem logger estruturado nativos e tem desempenho inferior. Fazer o mesmo que o Fastify exigiria várias bibliotecas extras.
