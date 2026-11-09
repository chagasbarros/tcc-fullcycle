# SLO — Leitura do catálogo

> Serviço: `marketplace-api` · Rota: `GET /catalog/products` · Janela: **30 dias corridos** · Responsável: Chagas Barros

## Por que esta rota

A listagem do catálogo é a porta de entrada da loja: toda visita começa por ela. É também a rota de maior volume e a que recebe o cache no Redis (ver `docs/desempenho.md`). Se ela fica lenta ou falha, o cliente não chega ao pedido.

## Objetivos

| SLI (o que medimos)                                                                 | SLO (meta em 30 dias)    | Orçamento de erro                         |
| ----------------------------------------------------------------------------------- | ------------------------ | ----------------------------------------- |
| **Latência:** fração das requisições respondidas em **até 200 ms**                  | **≥ 95%** (p95 < 200 ms) | 5% das requisições podem passar de 200 ms |
| **Disponibilidade:** fração das requisições **sem erro do servidor** (status ≠ 5xx) | **≥ 99%** (erro < 1%)    | 1% das requisições podem falhar com 5xx   |

- **Erros do cliente (4xx) não contam** contra o SLO: um `400` por parâmetro inválido é a API funcionando.
- A latência é medida **dentro da API** (do recebimento da requisição ao envio da resposta), não no navegador do cliente. Rede e Render ficam de fora.

## Como é medido

O histograma `http_request_duration_seconds` (`src/shared/http/metrics.ts`) é coletado pelo Prometheus a cada 5 s. Ele tem um bucket exatamente em **0,2 s**, então a latência é uma contagem exata e não uma estimativa.

```promql
# SLI de latência: fração das requisições em até 200 ms (30 dias)
sum(rate(http_request_duration_seconds_bucket{route="/catalog/products", method="GET", le="0.2"}[30d]))
/
sum(rate(http_request_duration_seconds_count{route="/catalog/products", method="GET"}[30d]))

# SLI de disponibilidade: fração das requisições sem 5xx (30 dias)
# "or vector(0)": sem nenhum 5xx a série não existe, e a conta daria vazio em vez de 100%.
1 - (
  (sum(rate(http_request_duration_seconds_count{route="/catalog/products", method="GET", status_code=~"5.."}[30d])) or vector(0))
  /
  sum(rate(http_request_duration_seconds_count{route="/catalog/products", method="GET"}[30d]))
)
```

O dashboard **Marketplace — RED** no Grafana (`ops/grafana/dashboards/marketplace-red.json`) mostra os dois indicadores no topo. Lá a janela é de **5 minutos**, para que a demo e o k6 mostrem o efeito na hora. A janela oficial de 30 dias é a das consultas acima.

## Orçamento de erro na prática

Com, por exemplo, 1 milhão de leituras do catálogo em 30 dias:

- até **50.000** podem passar de 200 ms;
- até **10.000** podem falhar com 5xx.

Se o orçamento estiver sendo consumido rápido demais:

1. **Prioridade muda:** novas funcionalidades param, e o trabalho vai para confiabilidade e desempenho.
2. **Kill switch:** a flag `catalog-cache-enabled` (Unleash) liga ou desliga o cache do catálogo sem novo deploy. Se o Redis for a causa, desliga-se o cache; se o banco for a causa, garante-se que ele esteja ligado.
3. **Investigação:** o p95 por rota no Grafana mostra **quando** piorou; o trace no Jaeger mostra **onde** o tempo foi gasto (SQL, Redis, código); os logs com `traceId` mostram **o quê** aconteceu.

## Limitações conhecidas

- **Sem alertas:** o projeto não tem Alertmanager. O SLO é acompanhado no dashboard, não dispara notificação. Num ambiente real, o próximo passo seria um alerta de _burn rate_ (consumo do orçamento mais rápido que o normal).
- **Prometheus local guarda 15 dias por padrão**, menos que a janela de 30 dias. Em produção seria preciso aumentar a retenção ou usar um armazenamento de longo prazo.
- **Métricas por instância:** cada processo da API tem o próprio histograma. Com várias instâncias, a soma por `sum(...)` nas consultas já agrega todas.
