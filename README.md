# discloud-gke

Monorepo de uma plataforma estilo Discloud: upload de `.zip` pelo Discord, build em Cloud Build, imagem no Artifact Registry e deploy em GKE regional (BR/US).

## Arquitetura

- **packages/api**: control-plane (Fastify + TypeScript + Prisma).
- **packages/bot**: bot Discord (`discord.js` v14) com sistema de ticket privado para upload.
- **packages/web**: frontend web com login/cadastro e dashboard de administração.
- **packages/shared**: tipos/plans/regiões compartilhadas.
- **infra/**:
  - `cloudbuild/cloudbuild.yaml`: pipeline de build por zip.
  - `gke/manifests`: manifesto base de deployment seguro.
  - `scripts`: bootstrap GCP (APIs, buckets, Artifact Registry, GKE regional, IAM).
- **templates/**: Dockerfiles por linguagem (`node`, `python`, `java`).

## Planos por cargo Discord

- **Neurion Basic**
  - Upload até **200MB**
  - CPU limite por app: **1 vCPU** (`1000m`)
  - Até **1 bot ativo**
- **Canary Premium**
  - Upload até **500MB**
  - CPU limite por app: **2 vCPU** (`2000m`)
  - Até **3 bots ativos**

## Fluxo `.up` com ticket privado

1. Usuário executa `.up` (sem nome).
2. Bot valida cargo do usuário (`Neurion Basic` ou `Canary Premium`).
3. Bot cria **ticket privado** (canal visível só para usuário + staff opcional).
4. No ticket, o usuário escolhe região (`br` ou `us`) via seletor.
5. Usuário envia `.zip` no ticket.
6. Em `.up`, o nome da app é derivado automaticamente do nome do arquivo `.zip`; em `.commit`, o usuário escolhe qual app modificar quando tiver mais de uma.

## Fluxo técnico de deploy

1. Bot chama API e envia zip em `POST /apps/:id/upload`.
2. API valida limite de upload pelo plano.
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
   - CPU limit baseado no plano (`1000m`/`2000m`)
7. Bot retorna status/logs/restart/stop/move.

## Segurança Kubernetes

- Containers com `runAsNonRoot: true`.
- `allowPrivilegeEscalation: false`.
- `capabilities.drop: ["ALL"]`.
- `resources.requests/limits` definidos.
- `topologySpreadConstraints` por `topology.kubernetes.io/zone`.

## Endpoints da API

- `POST /auth/discord` (stub com `userId`)
- `POST /auth/register` (cadastro em PostgreSQL com senha forte)
- `POST /auth/login` (login com verificação de hash)
- `POST /apps` (agora recebe metadados de plano e limites)
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
- `.up` (**reage ✅ e abre ticket privado sem precisar de nome**)
- `.commit` (**reage ✅ e abre ticket; se houver múltiplos bots, permite escolher qual modificar**)
- `.status <nome>`
- `.logs <nome>`
- `.console <nome>` (atalho para visualizar logs/console)
- `.freetier` (abre ticket para escolher bot/minecraft/hytale por 30 dias)
- `.restart <nome>`
- `.stop <nome>`
- `.move <nome> <br|us>`

## Rodando local (mock GCP)

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
5. Suba API + bot + frontend:
   ```bash
   npm run dev
   # ou apenas frontend
   npm run dev -w @discloud-gke/web  # http://localhost:5173
   ```

## Variáveis importantes do bot (tickets)

- `TICKET_CATEGORY_ID`: categoria Discord para tickets (opcional)
- `TICKET_STAFF_ROLE_ID`: role staff que pode ver tickets (opcional)

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



## Free Tier

- Comando `.freetier` abre ticket privado.
- No ticket, o usuário escolhe:
  - `bot`: seleciona app/bot e envia `.zip`.
  - `minecraft` ou `hytale`: cria hospedagem de jogo por 30 dias.
- Em caso de abuso de recursos, o serviço Free Tier pode ser suspenso.


## Frontend (login/cadastro + dashboard)

- O frontend foi inspirado no layout de cloud console: área de autenticação com painel esquerdo claro + painel direito escuro com glow, e dashboard all-black estilo IBM Cloud.
- Fluxo atual:
  - Cadastro em PostgreSQL via API (`/auth/register`) com senha forte obrigatória e detecção de email duplicado (retorno 409).
  - Login via API (`/auth/login`) com verificação segura de senha hash (`scrypt` (Node crypto)).
  - Dashboard para administração visual de recursos, plano e status Free Tier.
  - Após cadastro/login com sucesso: redirecionamento automático para o dashboard.
- O frontend foi inspirado no layout de cloud console, agora com dashboard all-black no estilo IBM Cloud.
- Fluxo atual:
  - Cadastro em PostgreSQL via API (`/auth/register`) com senha forte obrigatória.
  - Login via API (`/auth/login`) com verificação segura de senha hash (`scrypt` (Node crypto)).
  - Dashboard para administração visual de recursos, plano e status Free Tier.
  - Após cadastro/login com sucesso: redirecionamento automático para o dashboard.
- O frontend foi inspirado no layout de cloud console: tela de autenticação split-screen e dashboard com cards de recursos, em HTML/CSS/JS para um MVP rápido.
- Fluxo atual:
  - Cadastro com nome/email/senha (mock em `localStorage`).
  - Login por email/senha (com botões sociais simulados).
  - Dashboard para administração visual de recursos, plano e status Free Tier.
- URL local padrão: `http://localhost:5173`.

> Observação: autenticação está em modo local/mock no frontend para acelerar MVP. Em produção, conecte com endpoints reais de auth da API.
