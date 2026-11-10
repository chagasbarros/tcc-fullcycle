# Deploy no Render — passo a passo

> Decisões em ADR-0018. Faça uma vez só. Depois disso, todo merge na `main` com CI verde publica em **staging** sozinho, e **produção** espera a sua aprovação no GitHub.

## O que já está pronto no repositório

| Arquivo                            | Papel                                                                                      |
| ---------------------------------- | ------------------------------------------------------------------------------------------ |
| `render.yaml`                      | _Blueprint_: PostgreSQL, Key Value e os serviços `staging` e `production`, todos gratuitos |
| `.github/workflows/deploy.yml`     | Staging automático e produção com aprovação, depois do CI verde                            |
| `.github/scripts/render-deploy.sh` | Chama o _deploy hook_, espera `/health` mostrar o commit novo e faz o _smoke test_         |
| `ops/render/start.sh`              | Roda as migrations e depois inicia a API                                                   |
| GitHub Environments                | `staging` e `production` (com revisor obrigatório) já criados, aceitando só a `main`       |
| Variável `DEPLOY_ENABLED`          | Liga o workflow de deploy. Só deve ser criada no fim do passo 3                            |

## 1. Criar os recursos no Render

1. Crie a conta em <https://render.com> (dá para entrar com o GitHub).
2. **New → Blueprint** → conecte o repositório `chagasbarros/tcc-fullcycle`, branch `main`.
3. O Render lê o `render.yaml` e pede os valores marcados como `sync: false` (só os de **staging**). Por enquanto, preencha com um valor provisório que passe na validação:
   - `DATABASE_URL`: `postgresql://pendente:pendente@localhost:5432/pendente`
   - `REDIS_URL`: `redis://localhost:6379/1`
4. **Apply**. O Render cria tudo e faz o primeiro deploy.
   - **Produção** deve subir: a migration roda no banco `marketplace_production`.
   - **Staging** vai falhar, porque ainda não tem banco. Isso é esperado e se resolve no passo 2.

## 2. Criar o banco de staging e ligar o staging

1. No Render, abra **marketplace-db → Connections** e copie a **External Database URL**.
2. No seu terminal, crie o segundo banco na mesma instância (rodando no Docker, não precisa instalar o `psql`):

   ```bash
   docker run --rm -it postgres:16-alpine psql "<External Database URL>" -c "CREATE DATABASE marketplace_staging"
   ```

3. Em **marketplace-api-staging → Environment**, troque:
   - `DATABASE_URL` → a **Internal Database URL** do `marketplace-db`, trocando o nome do banco no final (`/marketplace_production`) por **`/marketplace_staging`**;
   - `REDIS_URL` → a **Internal Key Value URL** do `marketplace-redis`, com **`/1`** no final.
4. **Save, rebuild and deploy.** Staging sobe e roda as migrations no banco dele.

## 3. Ligar o GitHub ao Render

Em cada serviço, abra **Settings → Deploy Hook** e copie a URL. Ela é **secreta**: não cole em issue, commit ou chat.

No GitHub: **Settings → Environments → `staging`** (e depois `production`):

| Onde                      | Nome                     | Valor                                                                                              |
| ------------------------- | ------------------------ | -------------------------------------------------------------------------------------------------- |
| Environment **secrets**   | `RENDER_DEPLOY_HOOK_URL` | o _deploy hook_ do serviço daquele ambiente                                                        |
| Environment **variables** | `APP_URL`                | a URL pública do serviço, sem barra no final (ex.: `https://marketplace-api-staging.onrender.com`) |

Por fim, ligue o deploy: **Settings → Secrets and variables → Actions → Variables → New repository variable**, com `DEPLOY_ENABLED` = `true`. Até isso existir, o workflow de deploy é pulado (fica cinza, não vermelho).

## 4. Testar o fluxo

1. **Actions → Deploy → Run workflow** (deixe o commit vazio = última `main`).
2. **Staging** publica sozinho e fica verde quando `/health` mostra o commit.
3. **Production** fica em _Waiting_: clique em **Review deployments → Approve**.
4. Confira `https://<produção>.onrender.com/health` e `/docs`.

Daqui em diante, cada merge na `main` dispara esse fluxo depois do CI.

## Operação

| Situação                           | O que fazer                                                                                                                                      |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Rollback**                       | **Actions → Deploy → Run workflow** com o commit anterior da `main` (precisa de aprovação em produção). Ou use **Rollback** no painel do Render. |
| **Desligar o cache** (kill switch) | Mude `CATALOG_CACHE_ENABLED` para `false` no _env group_ `marketplace-common`. O Render reinicia os serviços (cerca de 1 min).                   |
| **Antes da apresentação**          | Abra `/health` de produção uns 2 minutos antes: o serviço gratuito dorme após 15 minutos sem tráfego.                                            |
| **Fechar o banco para a internet** | Depois do passo 2, esvazie **marketplace-db → Networking → Access Control**. A API usa a URL interna.                                            |
| **Validade**                       | O PostgreSQL gratuito expira 30 dias após a criação, com mais 14 dias para virar pago antes de ser apagado.                                      |
