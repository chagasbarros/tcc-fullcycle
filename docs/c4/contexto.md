# C4 — Nível 1: Contexto

> Quem usa o Marketplace e com quais sistemas ele conversa. O detalhe interno está em [`conteiner.md`](conteiner.md).

```mermaid
C4Context
  title Marketplace — diagrama de contexto

  Person(cliente, "Cliente", "Compra produtos: navega no catálogo, faz e acompanha pedidos")
  Person(operador, "Operador", "Autor do projeto: acompanha métricas, traces e liga/desliga flags")

  System_Ext(loja, "Loja (front-end)", "Aplicação do cliente. Não faz parte do projeto; o contrato com ela é testado com Pact (ADR-0012)")

  System(marketplace, "Marketplace", "Monólito modular: catálogo, pedidos e pagamentos (ADR-0002)")

  System_Ext(provedor, "Provedor de pagamento", "Cartão e Pix. Hoje simulado dentro do sistema (ADR-0011)")
  System_Ext(github, "GitHub", "Código, pull requests e CI (GitHub Actions)")
  System_Ext(render, "Render", "Hospedagem de staging e production")

  Rel(cliente, loja, "Usa", "navegador")
  Rel(loja, marketplace, "Consulta catálogo, cria e cancela pedidos", "HTTPS/JSON (OpenAPI 3.1)")
  Rel(marketplace, provedor, "Cobra o pedido", "assíncrono, via fila")
  Rel(operador, marketplace, "Observa e opera", "Grafana, Jaeger, Unleash")
  Rel(github, render, "Publica a main depois do CI verde", "deploy")
  Rel(render, marketplace, "Executa")

  UpdateLayoutConfig($c4ShapeInRow="3", $c4BoundaryInRow="1")
```

## Elementos

| Elemento                  | Tipo              | Papel                                                                                                                                                     |
| ------------------------- | ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Cliente**               | Pessoa            | Identificado só por um `customerId` (UUID) enviado no corpo; não há cadastro nem login no projeto (ADR-0008).                                             |
| **Operador**              | Pessoa            | Usa o Grafana (métricas RED e SLO), o Jaeger (traces) e o Unleash (kill switch do cache).                                                                 |
| **Loja (front-end)**      | Sistema externo   | Não foi construída. O consumidor `storefront` do Pact representa as chamadas que ela faria, e a API é verificada contra esse contrato no CI (ADR-0012).   |
| **Marketplace**           | Sistema do autor  | API REST e processamento assíncrono de pagamentos. Contrato em [`docs/openapi.yaml`](../openapi.yaml), Swagger UI em `/docs`.                             |
| **Provedor de pagamento** | Sistema externo   | Num sistema real seria um gateway (adquirente, PSP Pix). Aqui é simulado por `FakeCardProvider` e `FakePixProvider`, trocáveis pela interface (ADR-0011). |
| **GitHub / Render**       | Sistemas externos | O CI roda em todo pull request e no push para a `main` (ADR-0017); o Render publica os ambientes (ADR-0018).                                              |

## Fora do escopo

- Autenticação, cadastro de clientes, frete e nota fiscal.
- Notificações ao cliente (e-mail, push). O cliente acompanha o pedido consultando `GET /orders/{id}`.
