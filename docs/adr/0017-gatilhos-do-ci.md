# ADR-0017 — Gatilhos do CI: em todo pull request e no push para a main

- **Status:** Aceito
- **Data:** 2026-11-09
- **Decisor:** Chagas Barros

## Contexto e problema

O pipeline (`.github/workflows/ci.yml`) roda lint, typecheck, testes unitários com coverage, integração, contrato, `npm audit`, Trivy, gitleaks e Spectral, em 4 jobs paralelos de cerca de 3 minutos. Ele é exigido para o merge por uma regra (_ruleset_) da `main`.

O fluxo do projeto é: uma _branch_ por tarefa, um pull request, merge na `main`. A dúvida que surgiu ao ver o histórico do Actions: o CI deveria rodar **só nos pull requests**, ou também em _push_?

## Fatores de decisão

- Garantir que a `main` (o que vai para produção) foi testada como ela realmente ficou
- Ter o "link do CI verde" exigido no README (`CLAUDE.md`, seção 7)
- Ter um sinal para o deploy no Render esperar (ADR-0018)
- Não gastar execuções à toa

## Opções consideradas

1. **`pull_request` + `push` só na `main`**
2. **Só `pull_request`**
3. **`push` em qualquer _branch_ + `pull_request`**

## Decisão

**Opção 1.**

```yaml
on:
  push:
    branches: [main] # depois de cada merge
  pull_request: # em cada PR e a cada novo push na branch do PR
concurrency:
  group: ci-${{ github.ref }}
  cancel-in-progress: true # um push novo cancela a execução antiga da mesma ref
```

- **No pull request:** o CI testa a _branch_ **combinada com a `main` daquele momento** (o _merge commit_ de teste que o GitHub cria). É ele que a regra da `main` exige para liberar o merge.
- **No push para a `main`** (o merge): o CI roda de novo sobre o resultado final.
- **Em _push_ para outras _branches_:** o CI não roda. Elas só são testadas quando viram pull request.

## Consequências

- **Positivas:**
  - **A `main` sempre tem um resultado de CI próprio.** Se dois PRs forem aprovados contra a mesma `main` e mesclados em sequência, o segundo foi testado contra uma `main` que já não existe. A execução no _push_ é a única que testa a combinação real. Com um PR por vez, o caso é raro, mas é a garantia.
  - **Badge e link para o README:** o status do CI na `main` é o que o selo do README mostra.
  - **Sinal para o deploy:** o Render pode ser configurado para publicar só depois que o CI da `main` passar (ADR-0018).
  - **Sem desperdício:** _branches_ sem PR não disparam o CI, e o `concurrency` cancela execuções que ficaram velhas.
- **Negativas:**
  - **Cada mudança roda o pipeline duas vezes:** uma no PR e outra no merge, cerca de 3 minutos a mais por merge. O repositório é público, então o GitHub Actions não cobra.
  - Um teste instável (_flaky_) teria duas chances de falhar. Até agora, nenhuma execução falhou.

## Alternativas descartadas

- **Só `pull_request`:** metade das execuções, mas a `main` nunca teria um resultado de CI próprio. Não haveria selo de status para o README nem sinal para o deploy esperar, e a combinação real de dois PRs mesclados em sequência nunca seria testada.
- **`push` em qualquer _branch_ + `pull_request`:** feedback já no primeiro _push_, antes de abrir o PR, mas cada _push_ numa _branch_ com PR aberto rodaria o pipeline **duas vezes** (pelo `push` e pelo `pull_request`). Com o fluxo de abrir o PR logo depois do _push_, isso só duplicaria o trabalho.
