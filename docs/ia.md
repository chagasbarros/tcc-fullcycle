# Uso de IA no projeto

> Regra do curso: **a IA sugere, a decisão é do autor.** Código que o autor não sabe explicar não conta.

## Como a IA foi usada

- **Ferramenta:** Claude Code (Anthropic), no terminal, com acesso ao repositório.
- **Contrato de trabalho:** o arquivo `CLAUDE.md`, na raiz, obriga a IA a:
  - apresentar **2 opções com trade-off** em toda escolha relevante e **esperar a decisão** do autor;
  - registrar decisões de arquitetura em ADR, sempre com a alternativa descartada;
  - trabalhar em passos pequenos, com lint, typecheck e testes antes de dizer que terminou;
  - nunca quebrar a fronteira entre módulos sem perguntar.
- **O que a IA fez:** escreveu a maior parte do código, dos testes e dos documentos; levantou hipóteses de gargalo; comparou alternativas.
- **O que o autor fez:** escolheu entre as alternativas; executou os passos que envolviam segredos e contas (Render, deploy hooks, banco); aprovou cada deploy em produção; revisou e fez o merge de cada PR com o CI verde.

**Critério deste arquivo** (módulo 4: "a IA redige, o código prova"): só entram entradas verificáveis. As de 12/11 têm o prompt real. Para 07 a 10/11, os ADRs e o histórico do git mostram **o que** foi decidido, mas o prompt e a sugestão da IA não foram registrados no dia. Essas entradas estão marcadas para o autor completar.

## Prompts que mudaram o rumo (12/11)

### 1. O gargalo do k6 era um impasse no pool de conexões

- **Prompt:** "vamos para o plano de hoje" (k6 baseline → gargalo → otimização → after)
- **O que a IA fez:**
  - rodou o baseline: com 300 VUs, p95 de 3,9 s no catálogo e 36,9% de erro no `POST /orders`;
  - levantou a **hipótese** de esgotamento do pool de conexões, a partir do erro `P2028` e do stack trace;
  - **confirmou com medição**: o `pg_stat_activity` mostrou as 10 conexões da API em `idle in transaction`;
  - apontou a causa numa decisão anterior: a trava de idempotência (ADR-0016) segura 1 conexão e o trabalho precisa de outras.
- **Opções sugeridas pela IA:** pool separado para a trava (recomendada), só aumentar o pool, ou trocar a trava por uma linha.
- **Decisão do autor:** **pool separado**. Descartou "só aumentar o pool", porque o impasse continuaria existindo com mais pedidos simultâneos, e a trava por linha, pelo risco na véspera da entrega. Resultado: p95 do catálogo de **3.867 → 97 ms** e erro de **36,9% → 0%** (ADR-0019).
- **Por que importa:** o módulo 4 alerta que uma IA que sugere "aumente o pool de conexões" sem medir só desloca o gargalo. Aqui a hipótese foi medida antes, e o aumento simples do pool foi descartado.

### 2. Como rodar o k6, contra qual ambiente e com qual cenário

- **Prompt:** o mesmo da entrada 1. Antes de escrever o script, a IA fez três perguntas.
- **Sugestões da IA e decisões do autor:**

  | Pergunta   | Opções                               | Decisão do autor |
  | ---------- | ------------------------------------ | ---------------- |
  | Como rodar | k6 em Docker ou instalado no Windows | **Docker**       |
  | Ambiente   | compose local ou Render staging      | **local**        |
  | Cenário    | misto 80/15/5 ou só catálogo         | **misto**        |

- **Correção feita pelo autor:** depois da implementação, o autor perguntou: "foi registrado as decisões de como rodar o k6, contra qual ambiente medir o antes/depois e o cenário de carga". **Não tinha sido.** O `docs/desempenho.md` descrevia o que foi feito, mas não as decisões com as alternativas descartadas. A IA reconheceu a falha e criou o ADR-0020.

### 3. A revisão do módulo 4 e a decisão contra a recomendação da IA

- **Prompt:** "subi o módulo 4 para revisão, o arquivo está na pasta docs"
- **O que a IA encontrou:**
  - o módulo não trata de padrões GoF (Strategy) nem de padrões de acesso a dados (Repository);
  - o módulo descreve a **escrita dupla** que o projeto tem: salvar o pedido e depois publicar `OrderPlaced`;
  - o módulo **contradiz** uma decisão do mesmo dia: o k6 não deveria rodar na máquina do autor.
- **Sugestões da IA e decisões do autor:**

  | Pergunta      | Recomendação da IA                           | Decisão do autor                                                |
  | ------------- | -------------------------------------------- | --------------------------------------------------------------- |
  | ADR-0003      | manter Strategy                              | **manter Strategy**                                             |
  | ADR-0004      | Repository, com o Outbox como ADR "Proposto" | **igual à recomendação** (ADR-0004 e ADR-0021)                  |
  | k6 x módulo 4 | manter o local e citar o módulo              | **complementar com o Render**, contra a recomendação (ADR-0022) |
  | `Modulo4.md`  | não versionar (material do curso)            | **não versionar**                                               |

- **Resultado da decisão do autor:** a rodada no Render mostrou o SLO cumprido no ambiente hospedado (p95 de **5,0 ms dentro da API**). Também mostrou por que o SLO é medido dentro da API: visto do k6, o p95 foi de 306 ms, quase todo rede.

### 4. A IA afirmou algo sem verificar e o autor trouxe o dado

- **Contexto:** no ADR-0019, a IA escreveu que até 40 conexões no Render ficavam "dentro do limite do plano" e depois avisou que **não tinha conferido**.
- **Prompt do autor:** "a flag connection pool no render está disable"
- **O que aconteceu:**
  - a IA explicou a diferença entre o pool da aplicação e o pooling do servidor (PgBouncer) do Render;
  - mostrou que, com o pooling desligado, o limite que vale é o `max_connections` da instância;
  - o autor mediu: **100**.
- **Decisão:** manter os padrões (10 + 10 por processo). A IA trocou a frase não verificada do ADR-0019 pelo valor medido.

### 5. Staging e produção na mesma instância do banco

- **Prompt do autor:** "eu não entendi o ambiente staging vai usar o mesmo banco que a produção?"
- **O que a IA respondeu:** é a mesma instância, mas com bancos diferentes (`marketplace_staging` e `marketplace_production`), porque o plano gratuito permite um só PostgreSQL. Os dados ficam isolados, mas CPU, memória, conexões e o vencimento de 30 dias são compartilhados. Alternativa: um provedor externo (Neon ou Supabase) para o staging.
- **Decisão do autor:** "vamos seguir com a instância dividida". O trade-off foi registrado em `docs/apresentacao.md` e no ADR-0018.

### 6. A falha do deploy hook

- **Contexto:** o primeiro deploy falhou com `curl: (3) URL rejected: Malformed input`. O secret colado pelo PowerShell ficou com um caractere invisível.
- **Opções sugeridas pela IA:** colar o secret de novo, ou deixar o script de deploy mais robusto (remover espaços e validar o formato), que era a recomendada.
- **Decisão do autor:** corrigiu o secret pela interface do GitHub e pediu a documentação "sem o ajuste" no script. O deploy seguinte passou nos dois ambientes.

## Decisões de 07 a 10/11 (a completar pelo autor)

Os ADRs registram cada decisão e a alternativa descartada. O prompt e a sugestão da IA de cada uma **não foram anotados no dia**. Ficam aqui para o autor completar só as que mudaram o rumo do projeto, com o que lembra de fato.

| Data  | Decisão (ADR)                                  | Alternativa descartada                                                                  | Prompt / sugestão da IA                                                     |
| ----- | ---------------------------------------------- | --------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| 07/11 | Fastify (ADR-0001)                             | NestJS, Express                                                                         | _a completar_                                                               |
| 08/11 | Monólito modular (ADR-0002)                    | Microsserviços, monólito tradicional em camadas                                         | _a completar_                                                               |
| 08/11 | Reserva atômica de estoque (ADR-0009)          | Só validar o estoque (check-then-act), `SELECT ... FOR UPDATE`                          | _a completar_                                                               |
| 08/11 | Worker em processo separado (ADR-0010)         | Consumidores dentro da API                                                              | _a completar_                                                               |
| 09/11 | Pact com consumidor simulado (ADR-0012)        | Validar respostas contra a OpenAPI, Pact Broker                                         | _a completar_. O Pact encontrou um bug real (`415` no cancelamento).        |
| 09/11 | Idempotency-Key com trava por chave (ADR-0016) | Redis com TTL, aceitar o `409 Out of Stock`, trava que espera                           | _a completar_. O teste mostrou 9 de 10 duplicatas recebendo `Out of Stock`. |
| 10/11 | Deploy no Render com aprovação (ADR-0018)      | Pagar pela produção, staging em Neon/Upstash, deploy automático do Render a cada commit | _a completar_                                                               |

## Lições

- **A hipótese da IA só vale depois de medida.** O impasse do pool só virou diagnóstico depois do `pg_stat_activity`.
- **O autor precisa conferir o que a IA diz que fez.** Duas vezes no mesmo dia a verificação do autor encontrou lacunas: as decisões do k6 sem ADR e o limite de conexões não verificado.
- **Discordar da recomendação também é decidir.** No k6 contra o Render, o autor escolheu o oposto do que a IA recomendou, e o resultado acrescentou um argumento à apresentação.
- **Registrar no dia.** As entradas de 07 a 10/11 ficaram incompletas porque o prompt não foi anotado quando aconteceu.
