# ADR-0020 — Teste de carga com k6: como rodar, contra qual ambiente e com qual cenário

- **Status:** Aceito
- **Data:** 2026-11-12
- **Decisor:** Chagas Barros
- **Relacionado:** ADR-0014 (cache do catálogo), ADR-0015 (feature flags), ADR-0018 (Render), ADR-0019 (pool da trava), `docs/slo.md`, `docs/desempenho.md`

## Contexto e problema

O curso exige k6 em 3 estágios com o antes e o depois de uma otimização: p95, RPS, taxa de erro, gargalo identificado e evidência. Antes de escrever o script, três escolhas mudam o que os números significam:

1. **Como rodar o k6:** ele não estava instalado na máquina.
2. **Contra qual ambiente medir:** o compose local ou o Render.
3. **Qual cenário de carga:** que rotas e em que proporção.

## Fatores de decisão

- Números **reproduzíveis**: qualquer pessoa roda o mesmo teste com um comando
- Medir **a aplicação**, não o limite de um plano gratuito
- Ter a **evidência** à mão: `pg_stat_activity`, `EXPLAIN ANALYZE`, logs, Grafana e Jaeger
- Não afetar a produção
- Ligar o resultado ao **SLO** declarado (`GET /catalog/products`, p95 < 200 ms, erro < 1%)

## Decisão 1 — k6 em Docker

O k6 roda com a imagem `grafana/k6:1.0.0` (versão fixada), na rede do compose, chamado por `k6/run.mjs` (`npm run k6:baseline` / `npm run k6:after`). O mesmo script também alterna a flag `catalog-cache-enabled` no Unleash antes de cada rodada.

- **Positivo:** nada a instalar, mesma versão em qualquer máquina, e o k6 alcança a API pelo nome do serviço (`http://api:3000`).
- **Negativo:** o k6 disputa CPU com a API dentro do Docker Desktop. Com 300 VUs isso não limitou o teste: a rodada com cache chegou perto do teto teórico do cenário.
- **Descartada: instalar o k6 no Windows** (winget ou scoop). Ele não disputaria recursos com a API, mas o teste passaria a depender da máquina e exigiria um passo de instalação a mais no README.

## Decisão 2 — Medir no compose local

O antes e o depois são medidos na stack do `docker compose up -d`, com o seed (5.003 produtos e 100.003 pedidos).

- **Positivo:** o ambiente é o mesmo nas três rodadas; a evidência fica à mão (foi o `pg_stat_activity` que mostrou o gargalo do ADR-0019); e a produção não é afetada.
- **Negativo:** os números são do notebook do autor (Docker Desktop no Windows, 12 CPUs lógicas), não de produção. Eles servem para **comparar antes e depois**, não para prometer capacidade em produção.
- **Descartada: medir no Render (staging).** O plano gratuito tem uma fração de CPU e o serviço dorme sem tráfego, então o número mediria o limite do plano, não a aplicação. Além disso, o staging divide a instância do PostgreSQL e do Key Value com a produção (ADR-0018): um teste de carga no staging deixaria a produção mais lenta.

## Decisão 3 — Cenário misto com foco no SLO

O cenário (`k6/marketplace.js`) mistura **80%** de `GET /catalog/products` (página aleatória), **15%** de `GET /catalog/products/{id}` e **5%** de `POST /orders` (com `Idempotency-Key`). Os VUs pausam entre 0,1 e 0,5 s entre as ações.

- **Os 3 estágios:** 1 min de subida até 300 VUs, 3 min de sustentação, 1 min de descida. Os 300 VUs foram calibrados: com 100, a API não sofria (p95 de 6 ms).
- **Os thresholds são o SLO:** p95 < 200 ms e erro < 1% em `GET /catalog/products`. Com isso, o k6 diz direto se o SLO foi cumprido.
- **Positivo:** é próximo do uso real (a maior parte das visitas só lê o catálogo) e exercita também a escrita: reserva de estoque, trava de idempotência e fila. **Foi justamente a escrita que revelou o gargalo:** os pedidos esgotavam o pool de conexões e travavam as leituras (ADR-0019). Um cenário só de leitura não teria mostrado isso.
- **Negativo:** é mais difícil isolar uma única causa, porque leitura e escrita disputam os mesmos recursos. Para atenuar, cada rota tem a sua métrica (`tags: name`).
- **Descartada: só `GET /catalog/products`.** É exatamente a rota do SLO e o efeito do cache ficaria mais limpo de explicar, mas o cenário não passaria pelo pedido nem pela fila, e o gargalo real não apareceria.

## Consequências

- Os números de `docs/desempenho.md` valem para **comparação** no mesmo ambiente. Medir a capacidade em produção exigiria outro ambiente, dedicado e pago.
- Os resultados de cada rodada ficam em `k6/results/` (resumo JSON e amostras do `pg_stat_activity`), para conferência.
