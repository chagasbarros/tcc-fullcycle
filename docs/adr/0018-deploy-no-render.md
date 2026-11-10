# ADR-0018 — Deploy no Render (plano gratuito): staging automático, produção com aprovação

- **Status:** Aceito
- **Data:** 2026-11-10
- **Decisor:** Chagas Barros

## Contexto e problema

O projeto precisa de dois ambientes, `staging` e `production`, com configuração só por variável de ambiente e uma estratégia de deploy registrada (`CLAUDE.md`, seção 7). A hospedagem é o Render, no **plano gratuito**: o projeto é acadêmico e deve ficar no ar até a apresentação de 16/11.

A documentação do Render (consultada em 10/11) impõe limites no plano gratuito:

- **Só 1 PostgreSQL e 1 Key Value (Redis) gratuitos por _workspace_.** O PostgreSQL tem 1 GB, não tem backup e expira em 30 dias. O Key Value tem 25 MB e **perde os dados quando reinicia**.
- **Não existe _Background Worker_ gratuito**, e o comando de _pre-deploy_ (onde as migrations rodariam) só existe nos planos pagos.
- **O serviço web "dorme"** após 15 minutos sem tráfego; acordar leva cerca de 1 minuto.

## Fatores de decisão

- Custo zero
- Ambientes isolados: o que se faz em staging não pode afetar os dados de produção
- Produção só recebe o que passou no CI e foi testado em staging
- Rollback simples e explicável
- Mesma imagem Docker e mesmo código em todos os ambientes

## Opções consideradas

**Dois ambientes com uma instância gratuita de cada:**

1. **Compartilhar, isolados:** dois bancos de dados na mesma instância PostgreSQL e dois bancos lógicos no mesmo Redis.
2. **Pagar pela produção:** cerca de US$ 16 por mês em instâncias pagas.
3. **Staging em provedores externos gratuitos:** Neon e Upstash.

**Promoção de staging para produção:**

1. **GitHub Actions com Environments:** staging automático e produção com aprovação.
2. **Branch `production`:** promover é atualizar essa branch.

**Migrations:**

1. **No início do contêiner**, antes do servidor.
2. **Como passo do pipeline**, com o banco aberto para a internet.

**Worker** (decidido antes, ao escolher o plano gratuito): rodar os consumidores **dentro do processo da API** no Render.

## Decisão

**Compartilhar com isolamento, promover com Actions e aprovação, migrations no início do contêiner e worker dentro da API no Render.**

| Item                  | Como ficou                                                                                                                                                                                                                                                                      |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Infraestrutura        | `render.yaml` (_Blueprint_): 1 PostgreSQL, 1 Key Value e 2 serviços web Docker (`marketplace-api-staging` e `marketplace-api-production`), na região `virginia`, a mais próxima do Brasil.                                                                                      |
| Isolamento            | **PostgreSQL:** os bancos `marketplace_production` e `marketplace_staging` ficam na mesma instância. **Redis:** o banco lógico `0` é de produção e o `1` é de staging, indicado no fim do `REDIS_URL`. Verificado localmente: as filas de staging só criaram chaves no banco 1. |
| Redis                 | `maxmemoryPolicy: noeviction`: o BullMQ exige isso, porque um job descartado seria um pagamento perdido. Com a memória cheia, o que falha é a escrita no cache, e o cache já cai para o banco (ADR-0014).                                                                       |
| Worker                | Com `RUN_WORKER_IN_PROCESS=true`, a API inicia os consumidores no próprio processo (`src/worker-runtime.ts`). É o mesmo código do processo separado usado localmente (ADR-0010).                                                                                                |
| Migrations            | `start-with-migrations.sh` roda `prisma migrate deploy` e depois inicia o servidor. Se a migration falhar, o servidor não sobe, o _health check_ falha e o Render **mantém a versão anterior no ar**.                                                                           |
| Configuração          | Só por variáveis de ambiente, validadas com Zod no boot. Os valores comuns ficam num _env group_; as URLs de staging são informadas uma vez na criação. Nenhum segredo no repositório.                                                                                          |
| Deploy                | `.github/workflows/deploy.yml`: depois do CI verde na `main`, deploy em **staging** automático; **produção espera aprovação** (revisor obrigatório no GitHub Environment `production`) e recebe **o mesmo commit**.                                                             |
| Como o deploy é feito | O _deploy hook_ de cada serviço (segredo no GitHub Environment) é chamado com `ref=<commit>`. O job espera `/health` responder `version = <commit>`, que vem de `RENDER_GIT_COMMIT`, e faz um _smoke test_ (`GET /catalog/products` com resposta 200).                          |
| Rollback              | Rodar o workflow à mão com um commit anterior da `main`. Só commits que estão na `main` são aceitos. Também é possível usar o botão de rollback do painel do Render.                                                                                                            |

## Consequências

- **Positivas:**
  - **Custo zero**, com os dois ambientes e o fluxo de entrega exigidos.
  - **Produção nunca recebe algo que não passou pelo CI e por staging,** e cada deploy fica registrado no GitHub (Environments → _deployments_), com quem aprovou.
  - **Deploy confirmado, não presumido:** o pipeline só fica verde quando a versão nova responde. O Render só troca o tráfego depois que a instância nova passa no _health check_.
  - **Verificado localmente como no Render:** a migration rodou num banco vazio no início do contêiner, e um pedido chegou a `PAID` com o worker dentro da API.
  - A imagem não cresceu: o CLI do Prisma já vinha como dependência transitiva.
- **Negativas:**
  - **Isolamento parcial:** staging e produção dividem a mesma CPU, memória (256 MB), conexões (100) e os 25 MB do Redis. Um teste de carga em staging afeta a produção, por isso **o k6 roda no ambiente local**.
  - **Filas sem persistência:** se o Key Value gratuito reiniciar, os jobs pendentes se perdem. Os pedidos afetados ficam em `PENDING_PAYMENT`, sem cobrança duplicada nem estoque inconsistente. Em produção real, o Key Value seria pago (com persistência), ou se usaria o _Transactional Outbox_ já listado em "O que faria diferente".
  - **API e worker no mesmo processo:** um pagamento lento disputa CPU com as requisições. Esse é exatamente o problema que o ADR-0010 evita no ambiente local. No plano gratuito, a carga é baixa.
  - **Primeira requisição lenta:** depois de 15 minutos sem tráfego, a resposta leva cerca de 1 minuto. **Antes da apresentação, é preciso "acordar" o serviço.**
  - **Expiração:** o PostgreSQL gratuito expira 30 dias após a criação; criado em 11/11, expira em 11/12, depois da apresentação.
  - **Passos manuais** (`docs/deploy.md`): criar o banco `marketplace_staging`, informar as URLs de staging, copiar os _deploy hooks_ e as URLs para os GitHub Environments.
  - **O banco aceita conexões externas** (senha e TLS) para permitir esse passo manual. A lista de IPs pode ser esvaziada depois.
  - Sem Unleash, Prometheus, Grafana ou Jaeger no Render: o _kill switch_ é a variável `CATALOG_CACHE_ENABLED` (ADR-0015) e a observabilidade completa fica no ambiente local.

## Alternativas descartadas

- **Pagar pela produção:** daria isolamento real e Redis com persistência, mas teria custo mensal enquanto o projeto estivesse no ar, sem ganho para a avaliação.
- **Staging em Neon e Upstash:** isolamento real e custo zero, mas com dois provedores e contas a mais para criar e explicar, e com uma stack diferente entre os ambientes.
- **Branch `production`:** menos peças, mas o GitHub Environment só guardaria configuração, sem aprovação nem histórico. O rollback seria "voltar a branch", o que reescreve histórico ou exige um commit de reversão.
- **Migrations no pipeline:** a imagem ficaria igual, mas o banco precisaria ficar aberto permanentemente para os IPs variáveis dos _runners_ do GitHub, e haveria um segredo a mais por ambiente. No início do contêiner, a migration roda dentro da rede do Render.
- **Deploy automático do Render a cada commit** (`autoDeployTrigger: commit` ou `checksPass`): é mais simples, mas publicaria em produção sem aprovação e sem passar por staging.
