# discloud-gke

Monorepo de uma plataforma estilo Discloud: upload de `.zip` pelo Discord, build em Cloud Build, imagem no Artifact Registry e deploy em GKE regional (BR/US).

## Arquitetura

- **packages/api**: control-plane (Fastify + TypeScript + Prisma).
- **packages/bot**: bot Discord (`discord.js` v14).
- **packages/shared**: tipos e planos compartilhados.
- **infra/**:
  - `cloudbuild/cloudbuild.yaml`: pipeline de build por zip.
  - `gke/manifests`: manifesto base de deployment seguro.
  - `scripts`: bootstrap GCP (APIs, buckets, Artifact Registry, GKE regional, IAM).
- **templates/**: Dockerfiles por linguagem (`node`, `python`, `java`).

## Fluxo principal

1. Usuário executa `.up <nome> <br|us>` com anexo `.zip`.
2. Bot chama API e sobe o arquivo em `POST /apps/:id/upload`.
3. API salva no bucket da região (`bucket-br`/`bucket-us`).
4. API dispara Cloud Build com substitutions:
   - `_ZIP_GS_URL`
   - `_IMAGE`
   - `_APP_ID`
   - `_LANG`
5. Cloud Build detecta runtime (Node/Python/Java), injeta Dockerfile template, builda e faz push.
6. API aplica deployment no cluster regional da app:
   - namespace: `ns-u-<discordUserId>`
   - deployment: `app-<appId>`
   - `replicas=1`
7. Bot retorna status/logs/restart/stop/move.

## Segurança Kubernetes

- Containers com `runAsNonRoot: true`.
- `allowPrivilegeEscalation: false`.
- `capabilities.drop: ["ALL"]`.
- `resources.requests/limits` definidos.
- `topologySpreadConstraints` por `topology.kubernetes.io/zone`.

## Endpoints da API

- `POST /auth/discord` (stub com `userId`)
- `POST /apps`
- `GET /apps`
- `GET /apps/:id`
- `POST /apps/:id/upload` (multipart zip)
- `POST /apps/:id/deploy`
- `POST /apps/:id/restart`
- `POST /apps/:id/stop`
- `GET /apps/:id/logs`
- `POST /apps/:id/move`

## Comandos do bot

- `.plans`
- `.up <nome> <br|us>`
- `.commit <nome> <br|us>`
- `.status <nome>`
- `.logs <nome>`
- `.restart <nome>`
- `.stop <nome>`
- `.move <nome> <br|us>`

## Rodando local (mock GCP)

> Recomendado para desenvolvimento inicial sem custo em nuvem.

1. Copie variáveis:
   ```bash
   cp .env.example .env
   ```
2. Ajuste no `.env`:
   - `MOCK_GCP=true`
   - `DB_PROVIDER=sqlite`
   - `DATABASE_URL=file:./dev.db`
3. Instale dependências:
   ```bash
   npm install
   ```
4. Prisma (API):
   ```bash
   npm run prisma:generate -w @discloud-gke/api
   npm run prisma:migrate:dev -w @discloud-gke/api -- --name init
   ```
5. Suba API + bot:
   ```bash
   npm run dev
   ```

## Deploy em GCP (produção)

### 1) Pré-requisitos

- Projeto GCP com billing ativo.
- `gcloud` autenticado.
- Permissões de Owner/Editor para bootstrap.

### 2) Provisionamento base

```bash
./infra/scripts/01-enable-apis.sh <PROJECT_ID>
./infra/scripts/02-create-buckets.sh <PROJECT_ID> <BUCKET_BR> <BUCKET_US>
./infra/scripts/03-create-artifact-registry.sh <PROJECT_ID> <REPO> <LOCATION>
./infra/scripts/04-create-gke-regional.sh <PROJECT_ID>
./infra/scripts/05-service-accounts.sh <PROJECT_ID>
```

### 3) Configurar contextos de cluster

```bash
gcloud container clusters get-credentials discloud-br --region southamerica-east1 --project <PROJECT_ID>
gcloud container clusters get-credentials discloud-us --region us-central1 --project <PROJECT_ID>
```

Defina os contexts no `.env`:
- `K8S_CONTEXT_BR`
- `K8S_CONTEXT_US`

### 4) API Google (versões atuais)

A API usa clients modernos:
- `@google-cloud/storage` para upload de zip no GCS.
- `@google-cloud/cloudbuild` (`CloudBuildClient.createBuild`) para disparar build com substitutions.
- `@kubernetes/client-node` para deploy/restart/stop no GKE.

Para produção:
- `MOCK_GCP=false`
- `DB_PROVIDER=postgresql`
- `DATABASE_URL=postgresql://...`

### 5) Banco em produção

- Execute migrações:
  ```bash
  npm run prisma:migrate:dev -w @discloud-gke/api -- --name init
  # ou
  npm run prisma:deploy -w @discloud-gke/api
  ```

## Observações importantes

- O endpoint de logs está funcional em modo mock; em produção está preparado para evolução com leitura de pod logs em streaming.
- O worker está abstraído via interface `BuildQueue`, atualmente com implementação inline (`InlineBuildQueue`), facilitando mover para Pub/Sub/Cloud Tasks no futuro.
- `infra/cloudbuild/cloudbuild.yaml` está pronto para execução por trigger/job dedicado.

