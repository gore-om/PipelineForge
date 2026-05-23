# PipelineForge Test Plan: Sovereign_Code.zip

## Test Objective

Validate that PipelineForge can analyze `Sovereign_Code.zip`, identify what the app needs to run in CI/CD and cloud, generate useful deployment assets, and clearly block unsafe deployment when prerequisites are missing.

## Sample Repo Profile

- Repo archive: `D:\Sovereign_Code.zip`
- Structure: multi-service app
- Backend: Node.js + Express, `app/backend/src/server.js`
- Backend port: `8080`
- Frontend: static HTML/CSS/JS served by Nginx, `app/frontend`
- Frontend port: `80`
- Database: PostgreSQL required through `DATABASE_URL`
- Existing containers: `app/backend/Dockerfile`, `app/frontend/Dockerfile`
- Existing health endpoints:
  - Backend: `/health`
  - Frontend: `/health`
- Required runtime env:
  - `PORT`
  - `APP_ENV`
  - `APP_VERSION`
  - `DATABASE_URL`
  - `DB_SSL`
  - `CORS_ORIGIN`
  - `LOG_LEVEL`
  - `TOKEN_SECRET` should be supplied securely even though app has a local fallback.

## Current PipelineForge Result

Latest verification through `POST /api/analyze/upload` and `POST /api/sandbox/validate`:

- Correct:
  - ZIP upload works.
  - Detects Node.js and JavaScript.
  - Detects Express.
  - Detects PostgreSQL.
  - Detects backend and frontend as separate deployable services.
  - Detects backend port `8080` and frontend port `80`.
  - Detects service Dockerfiles.
  - Detects package manifest.
  - Detects backend and frontend entrypoints.
  - Parses `.env.example` and `process.env.*` usage, including `TOKEN_SECRET`.
  - Marks cloud database as required in Azure and AWS infra plans.
  - Generates per-service Docker contexts, Compose, Kubernetes, Jenkins, and Azure Pipelines assets.
  - Generates Compose with frontend, backend, and Postgres.
  - Generates Kubernetes backend/frontend deployments, services, ingress, and runtime secret placeholders.
  - Generates CI/CD stages that build frontend and backend images separately.
  - Validate UI asks for registry, domain, database URL, token secret, and CORS origin before release checks.
  - Keeps cloud deployment blocked until runtime secrets and deployment inputs are mapped.
  - Static sandbox validation passes all 8 checks after registry, domain, and secret inputs are supplied.

- Still incomplete:
  - UI does not yet expose a dedicated service topology panel.
  - Cloud Terraform files are still starter-level and do not yet create full RDS/Azure PostgreSQL, secrets, and observability modules.
  - Runtime Docker/Kubernetes dry-runs still depend on local Docker/Kubectl availability and credentials.

## Required Inputs For This Repo

PipelineForge should ask for these before deployment:

- Cloud provider: AWS or Azure
- Container registry:
  - AWS: ECR repository names for frontend and backend
  - Azure: ACR repository names for frontend and backend
- Public domain or ingress host
- Backend image tag
- Frontend image tag
- Backend service name, default `ledgerly-backend`
- Frontend service name, default `ledgerly-frontend`
- Backend port, default `8080`
- Frontend port, default `80`
- PostgreSQL provisioning choice:
  - managed cloud database, recommended for production
  - in-cluster Postgres, acceptable only for sandbox/dev
- `DATABASE_URL` secret source
- `TOKEN_SECRET` secret source
- `CORS_ORIGIN`
- TLS/ingress configuration
- CI/CD provider: Azure Pipelines or Jenkins
- Manual approval environment name for production

## Test Cases

| ID | Area | Scenario | Expected Result | Current Status |
| --- | --- | --- | --- | --- |
| SC-001 | Upload | Upload `Sovereign_Code.zip` | Upload succeeds and repo name is `Sovereign_Code` | Pass |
| SC-002 | Stack detection | Detect backend runtime | Node.js + Express detected | Pass |
| SC-003 | Stack detection | Detect frontend runtime | Static Nginx frontend service detected separately | Pass |
| SC-004 | Stack detection | Detect database | PostgreSQL detected from `pg` dependency and `DATABASE_URL` | Pass |
| SC-005 | Service detection | Detect multi-service repo | PipelineForge identifies backend and frontend services | Pass |
| SC-006 | Port detection | Detect backend port | Backend port is `8080` | Pass |
| SC-007 | Port detection | Detect frontend port | Frontend port is `80` | Pass |
| SC-008 | Entrypoints | Detect app entrypoints | Backend `server.js` and frontend `app.js` shown | Pass |
| SC-009 | Docker detection | Detect existing Dockerfiles | Backend and frontend Dockerfiles shown separately | Pass |
| SC-010 | Ignore rules | Check `.dockerignore` | Warns missing backend/frontend `.dockerignore` | Pass |
| SC-011 | Build command | No build script for backend/static frontend | Warn or mark "not required", not blocking | Pass |
| SC-012 | Test command | No test script | Warn and keep tests optional | Pass |
| SC-013 | Env detection | Parse `.env.example` | Shows required env vars and secret candidates | Pass |
| SC-014 | Secret detection | `TOKEN_SECRET` fallback exists | Warn that production secret must be supplied externally | Pass |
| SC-015 | Compose generation | Generate sandbox compose | Includes frontend, backend, postgres, network, env wiring | Pass |
| SC-016 | K8s generation | Generate backend deployment | Backend deployment uses port `8080`, env secrets, probes `/health` | Pass |
| SC-017 | K8s generation | Generate frontend deployment | Frontend deployment uses Nginx port `80` and backend service route | Pass |
| SC-018 | K8s generation | Generate services | Creates `ledgerly-backend` and frontend service mappings | Pass |
| SC-019 | K8s generation | Generate ingress | Routes public traffic to frontend and `/api` to backend behavior | Pass |
| SC-020 | Infra plan | AWS plan | Includes ECR, EKS/ECS choice, RDS PostgreSQL, secrets, logs | Partial |
| SC-021 | Infra plan | Azure plan | Includes ACR, AKS, Azure PostgreSQL, secrets, logs | Partial |
| SC-022 | CI/CD | Azure pipeline generation | Builds and pushes frontend/backend images separately | Pass |
| SC-023 | CI/CD | Jenkins generation | Builds and pushes frontend/backend images separately | Pass |
| SC-024 | Validation | Sandbox checks before inputs | Blocks with clear missing input list | Pass |
| SC-025 | Validation | Sandbox with supplied registry/domain | Placeholders should resolve and K8s check should not fail for unresolved registry | Pass |
| SC-026 | Validation | Evidence bundle | Shows config, sandbox, runtime, and security evidence | Pass |
| SC-027 | Release decision | Blocking readiness | Deployment remains blocked until service model and required inputs are resolved | Pass |
| SC-028 | UX | Recommendations | Recommendations point to exact stage and exact missing repo/cloud item | Partial |

## Acceptance Criteria For This Repo

PipelineForge can be considered ready for `Sovereign_Code.zip` when it can:

1. Identify it as a multi-service app.
2. Represent backend and frontend as separate deployable services.
3. Detect backend port `8080` and frontend port `80`.
4. Detect PostgreSQL as a required backing service.
5. Ask for all required production inputs before deployment.
6. Generate Docker/Compose/Kubernetes assets for frontend, backend, and Postgres connectivity.
7. Generate Azure Pipelines or Jenkins stages that build and push both images.
8. Generate cloud infra plan including registry, Kubernetes or container runtime, managed PostgreSQL, secrets, and observability.
9. Keep deployment blocked until registry, domain, database secret, and cloud credentials are configured.
10. Produce a clear readiness report explaining what is missing and how to fix it.

## Priority Defects To Fix Next

1. Add a frontend service topology panel so users can inspect backend, frontend, ports, env, and database dependencies clearly.
2. Expand Terraform beyond starter previews into full AWS/Azure modules for registry, runtime, managed PostgreSQL, secrets, and observability.
3. Add real runtime validation for generated multi-service Compose and Kubernetes manifests when Docker/Kubectl are available.
4. Improve recommendations so runtime secret mapping and service-specific fixes point to exact stages and fields.
