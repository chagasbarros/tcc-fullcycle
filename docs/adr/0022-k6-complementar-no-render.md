# ADR-0022 — k6 complementar no ambiente hospedado (Render staging)

- **Status:** Aceito
- **Data:** 2026-11-12
- **Decisor:** Chagas Barros
- **Referência:** Ebook de System Design, módulo 4 ("Um teste de carga com k6")
- **Complementa:** ADR-0020 (decisão 2: medir o antes e o depois no compose local). Não substitui: o antes e o depois continuam no local.

## Contexto e problema

O ADR-0020 decidiu medir o antes e o depois no compose local. Na revisão do módulo 4, depois dessas medições, apareceu a recomendação de que o k6 rode "contra um ambiente estritamente representativo de produção, e jamais contra a máquina de desenvolvimento do autor", porque um banco na mesma máquina "afere exclusivamente os limites do hardware local".

Nenhum ambiente deste projeto é **estritamente** representativo de produção. O Render gratuito tem uma fração de CPU e divide a instância do banco com a produção (ADR-0018). Ainda assim, o staging é o ambiente hospedado mais próximo do real: outra máquina, rede de verdade, banco gerenciado.

## Decisão

**Manter o antes e o depois no local (ADR-0020) e acrescentar uma rodada no staging do Render**, com cuidado para não afetar a produção:

- **Carga leve:** até **30 VUs**, com os mesmos 3 estágios em versão curta (30 s de subida, 2 min de sustentação, 30 s de descida) e o mesmo mix 80/15/5
- **Dados criados pela API:** o `setup()` do k6 cria 500 produtos via `POST /catalog/products` (`PREPARE_PRODUCTS=500`), sem abrir o banco para a internet e sem usar a URL com senha
- **O SLO é medido dentro da API**, como o `docs/slo.md` define: o histograma do `/metrics` é lido antes e depois da rodada, e a diferença dá os percentis só do teste. O p95 do k6 inclui a ida e volta à Virgínia (cerca de 190 ms) e é registrado à parte.

## Consequências

- **Positivas:**
  - Mostra o SLO cumprido no ambiente hospedado: `GET /catalog/products` com **p95 de 5,0 ms** dentro da API e **99,77%** das requisições em até 200 ms, com zero erros
  - Separa latência da aplicação de latência de rede, o que só o `/metrics` permite
- **Negativas:**
  - **Não é comparável 1:1 com o local:** carga 10 vezes menor, catálogo com 500 produtos em vez de 5.003, cache ligado (no Render a flag vem do env group, sem Unleash) e CPU muito menor
  - O teste deixa dados no banco de staging (500 produtos e cerca de 430 pedidos) e divide CPU e conexões com a produção enquanto roda
  - O `/metrics` zera a cada deploy ou reinício. Por isso a leitura "antes" precisa ser feita logo antes da rodada.

## Alternativas descartadas

- **Mesma carga do local (300 VUs) no Render:** comparável em carga, mas saturaria a fração de CPU do plano gratuito, mediria o limite do plano e deixaria a produção lenta durante o teste.
- **Seed completo no staging:** dados iguais aos do local, mas exige reabrir o banco para a internet, usar a URL com senha e ocupar o banco gratuito, que é dividido com a produção.
- **Não medir no Render:** mais simples, mas deixaria sem resposta a ressalva do módulo 4.
