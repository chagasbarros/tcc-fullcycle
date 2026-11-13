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

**Critério deste arquivo** (módulo 4: "a IA redige, o código prova"): só entram entradas verificáveis. Os prompts estão citados como foram escritos, inclusive os em inglês. Foram recuperados em 13/11 do histórico das conversas com a IA e conferidos com os ADRs e o histórico do git. Horários no fuso de Brasília.

## Prompts que mudaram o rumo (07 a 10/11)

### Fastify e monólito modular: decididos antes da IA

- **ADR-0001 (Fastify):** o arquivo já existia na pasta quando o Claude Code foi aberto pela primeira vez (07/11, prompt "Leia leia o arquivo CLAUDE.md"). A IA só o moveu para `docs/adr/`.
- **ADR-0002 (monólito modular):** a arquitetura já estava definida pelo autor no `CLAUDE.md`. A IA redigiu o ADR em 08/11, seguindo o plano, sem apresentar opções.

### As quatro perguntas do domínio viraram ADRs (08/11)

- **Contexto:** antes de escrever o domínio, a IA fez quatro perguntas, cada uma com uma recomendação.

  | Pergunta                    | Recomendação da IA                       | Decisão do autor | ADR      |
  | --------------------------- | ---------------------------------------- | ---------------- | -------- |
  | Como gerar UUID v7          | lib `uuid`                               | igual            | ADR-0006 |
  | Estados do pedido           | 4 estados (`PENDING_PAYMENT` → 3 finais) | igual            | ADR-0007 |
  | Clientes sem módulo próprio | só `customerId` no pedido                | igual            | ADR-0008 |
  | Estoque ao criar o pedido   | reservar e devolver                      | igual            | ADR-0009 |

- **Prompt do autor:** "As quatros perguntas do início de domingo viram adrs"
- **Por que importa:** a IA tinha tratado as quatro respostas como detalhes de implementação. O autor exigiu que virassem ADRs, com as alternativas descartadas. A reserva atômica de estoque (ADR-0009) acabou sendo a decisão com mais números medidos do projeto.

### Um schema do PostgreSQL por módulo (08/11)

- **Sugestões da IA:** um schema por módulo (`catalog`, `orders`, `payments`), que foi a recomendada, ou tudo no `public` com prefixo no nome das tabelas.
- **Prompt do autor:** "Opção A e registre a decisão" → ADR-0005.

### Worker separado e providers de pagamento determinísticos (08/11)

- **Sugestões da IA:**
  - **onde o worker roda:** processo separado (recomendada) ou dentro da API;
  - **como os providers fake decidem:** uma regra fixa (recomendada; o cartão recusa valores terminados em 13 centavos) ou um sorteio com taxa configurável.
- **Prompt do autor:** "concordo as duas recomendações e registre essas decisões em adr" → ADR-0010 e ADR-0011.
- **Consequência:** o `POST /orders` passou a exigir `paymentMethod`, uma mudança de contrato registrada no PR 7.

### O Pact sem ADR (09/11)

- **O que a IA fez:** implementou o teste de contrato com Pact e um consumidor simulado (`storefront`) **sem apresentar alternativas e sem ADR**.
- **Prompt do autor:** "Antes de abrir o PR 9, faça o registro da decisão do pact no adr" → ADR-0012.
- **Resultado:** o Pact encontrou um bug real. O `POST /orders/{id}/cancel` respondia `415` a um corpo vazio enviado em partes (_chunked_), o que os testes com `inject` não reproduziam.

### Observabilidade (09/11)

- **Sugestões da IA:**
  - **trace:** instrumentação automática do OpenTelemetry com `bullmq-otel` (recomendada) ou spans manuais;
  - **métricas:** um hook próprio no Fastify (recomendada) ou o plugin `fastify-metrics`.
- **Decisão do autor:** as duas recomendações (ADR-0013). Resultado medido: um pedido gerou 34 spans em 2 serviços, num único trace.

### Plano gratuito no Render, contra a recomendação da IA (09/11)

- **Prompt do autor:** "you may proceed" (início do cache, da flag, da idempotência e do deploy)
- **Sugestões da IA e decisões do autor:**

  | Pergunta                               | Recomendação da IA                                              | Decisão do autor      |
  | -------------------------------------- | --------------------------------------------------------------- | --------------------- |
  | Flag `catalog-cache-enabled` no Render | Unleash local, variável de ambiente no Render                   | igual (ADR-0015)      |
  | Worker no Render                       | **pagar o Background Worker** (cerca de US$ 7/mês por ambiente) | **só plano gratuito** |
  | Onde guardar a `Idempotency-Key`       | PostgreSQL                                                      | igual (ADR-0016)      |
  | Estoque no cache do catálogo           | aceitar até 60 s de defasagem                                   | igual (ADR-0014)      |

- **Por que importa:** o plano gratuito mudou o desenho do deploy. No Render, o worker roda dentro da API, contrariando o ADR-0010, e staging e produção dividem a única instância gratuita de PostgreSQL e de Redis (ADR-0018).

### O teste que mudou a idempotência (09/11)

- **O que aconteceu:** um teste da IA com PostgreSQL real mandou 10 requisições simultâneas com a mesma `Idempotency-Key` e estoque para 1 pedido. Resultado: 1 × `201` e **9 × `409 Out of Stock`**. Um cliente com duplo clique veria erro num pedido que deu certo.
- **Sugestões da IA:** uma trava por chave com `pg_try_advisory_xact_lock` (recomendada) ou aceitar o comportamento e documentar.
- **Decisão do autor:** a trava por chave (ADR-0016).
- **Consequência três dias depois:** essa trava causou o impasse no pool de conexões que o k6 encontrou em 12/11 (entrada 1 de 12/11, ADR-0019).

### O CI que roda em push (09/11)

- **Prompt do autor:** "This ci is intended to run on pull request, but it runs on pushes"
- **O que a IA respondeu:** o push só dispara o CI na `main`, ou seja, nos merges. A IA recomendou manter, porque isso testa a `main` como ela realmente ficou, dá o badge do README e é o sinal para o deploy.
- **Decisão do autor:** "you can leave it as is, but record this decision in an ADR" → ADR-0017.

### O que faltava de segunda e terça (10/11)

- **Prompt do autor:** "is there anything missing from the execution plan for Monday and Tuesday?"
- **O que a IA encontrou:** os ambientes `staging` e `production` ainda não existiam no GitHub, os ADRs 0003 e 0004 dependiam do módulo 4, e o `docs/ia.md` não tinha sido começado, apesar de o `CLAUDE.md` pedir o registro no dia.

### O deploy no plano gratuito (10/11)

- **Prompt do autor:** "so, let´s continue with the process of deploy on Render"
- **O que a IA fez antes de propor:** leu a documentação do Render e encontrou dois limites que mudavam o plano: **só 1 PostgreSQL e 1 Redis gratuitos por workspace**, e **nenhum comando de pre-deploy** para rodar as migrations.
- **Sugestões da IA e decisões do autor** (todas iguais à recomendação, ADR-0018):
  - **dois ambientes:** compartilhar as instâncias, isoladas por banco e por banco lógico do Redis, em vez de pagar a produção ou usar Neon e Upstash;
  - **promoção:** GitHub Actions com aprovação, em vez de uma branch `production`;
  - **migrations:** no início do contêiner, em vez de um passo do pipeline com o banco aberto para a internet.
- **Erro da IA:** ela estimou que a imagem cresceria cerca de 60 MB com o CLI do Prisma. Medido, não cresceu nada: o CLI já vinha como dependência transitiva.

### Decisões que a IA tomou sem perguntar

O `CLAUDE.md` pede duas opções e a decisão do autor em toda escolha relevante. Estas não seguiram a regra e ficam registradas:

| Data  | Decisão                                                                                             | Como foi tratada                                                |
| ----- | --------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| 09/11 | Pact com consumidor simulado                                                                        | O autor pediu o ADR depois (ADR-0012)                           |
| 09/11 | SLO dividido em duas metas: 95% em até 200 ms e 99% sem 5xx                                         | A IA pediu para o autor conferir; não houve resposta registrada |
| 09/11 | Unleash com um PostgreSQL próprio, depois de ele não conseguir criar o schema no banco da aplicação | Registrado no ADR-0015, sem opções apresentadas                 |

### Outras escolhas do autor (recomendação da IA aceita)

| Data  | Escolha                                                               | Alternativa descartada            |
| ----- | --------------------------------------------------------------------- | --------------------------------- |
| 07/11 | ESM (`"type": "module"`)                                              | CommonJS                          |
| 08/11 | Compose crescendo junto com o código (api, postgres e redis primeiro) | Os 8 serviços no primeiro dia     |
| 09/11 | Jobs paralelos no CI                                                  | Um job sequencial                 |
| 09/11 | Trivy escaneando a imagem Docker                                      | Escanear só o sistema de arquivos |

## Prompts que mudaram o rumo (12 e 13/11)

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

### 7. O deploy que voltou para um commit antigo

- **Prompt do autor (12/11, 21:54):** "o que é este erro no deploy: Canceling since a higher priority waiting request for deploy exists"
- **O que a IA respondeu:** a mensagem não é erro. O GitHub mantém só um deploy na fila por grupo de concorrência e descartou o mais antigo.
- **O que aconteceu depois:** os dois ambientes apareceram num commit **mais antigo** (`5e95bbe`, PR 21) que a `main` (`0591b92`, PR 22). A IA levantou a suspeita de um deploy automático do Render fora do GitHub Actions e pediu ao autor que conferisse o painel.
- **Diagnóstico corrigido em 13/11:** a suspeita estava errada. A API do GitHub mostrou que a execução `43341801110` do workflow foi **reexecutada** (tentativa 2, às 22:27) e aprovada em produção. Uma reexecução publica o commit que disparou o CI original, mesmo que a `main` já esteja à frente.
- **Correção (13/11, proposta pela IA e aprovada pelo autor):** o deploy disparado pelo CI só publica o commit se ele ainda for o último da `main`. A checagem acontece no início do workflow e de novo logo antes de cada ambiente, o que cobre a fila, a reexecução e a aprovação tardia. Rodar à mão para fazer rollback continua funcionando. O impacto foi nulo, porque os dois commits diferem só no `CONTRIBUTORS.md`.
- **Por que importa:** é o mesmo padrão da entrada 1. A hipótese da IA só valeu depois de conferida com os dados, e desta vez a primeira hipótese estava errada.

## Lições

- **A hipótese da IA só vale depois de medida.** O impasse do pool só virou diagnóstico depois do `pg_stat_activity`.
- **O autor precisa conferir o que a IA diz que fez.** A verificação do autor encontrou lacunas várias vezes: os ADRs das quatro perguntas do domínio, o do Pact, o das decisões do k6 e o limite de conexões não verificado.
- **A IA também decide sem perguntar.** Três decisões não seguiram a regra das duas opções. Elas ficaram registradas acima.
- **Discordar da recomendação também é decidir.** No k6 contra o Render, o autor escolheu o oposto do que a IA recomendou, e o resultado acrescentou um argumento à apresentação.
- **Registrar no dia.** Os prompts de 07 a 10/11 só puderam ser recuperados porque o histórico das conversas ainda existia. Anotar no momento teria evitado depender disso.
