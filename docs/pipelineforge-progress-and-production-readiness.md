# PipelineForge Progress and Production Readiness

## Current Phase

PipelineForge is now in the production-readiness buildout phase.

The product MVP is no longer just a repository analyzer. It now has a working staged workflow that can accept a repo, detect stack signals, validate deployment readiness, generate deterministic DevOps assets, run sandbox-style checks, and explain what still blocks production deployment.

The current engineering focus is:

1. Make PipelineForge itself deployable to AWS using Jenkins and Terraform.
2. Make generated deployment assets more production-safe for real multi-service apps.
3. Continue validating with `Sovereign_Code.zip` as the first serious test repository.

## What PipelineForge Does Today

### 1. Repository Intake

PipelineForge supports two source options:

- GitHub repository URL
- Local repository ZIP upload

The ZIP upload path has been tested with `Sovereign_Code.zip`.

The frontend now reports a clear API/proxy error if it receives HTML or another non-JSON response from the API. This fixed the earlier `Unexpected token '<'` failure caused by the frontend hitting the wrong backend port.

### 2. Login / First Screen Experience

The first screen is a premium blue DevOps-style landing surface with login and signup controls.

The repo upload flow appears only after entering the app workflow, so the UI no longer feels like every feature is dumped onto one screen.

### 3. Stack and Runtime Detection

PipelineForge can detect:

- Node.js
- JavaScript
- Express
- React / Vite / Next-style signals
- Python hints
- Java / Maven hints
- Docker-ready apps
- PostgreSQL usage
- Multi-service layouts

For `Sovereign_Code.zip`, PipelineForge correctly detects:

- Backend service: `ledgerly-backend`
- Backend runtime: Node.js / Express
- Backend port: `8080`
- Frontend service: `ledgerly-frontend`
- Frontend runtime: static frontend served by Nginx
- Frontend port: `80`
- Database dependency: PostgreSQL
- Required runtime environment:
  - `PORT`
  - `APP_ENV`
  - `APP_VERSION`
  - `DATABASE_URL`
  - `DB_SSL`
  - `CORS_ORIGIN`
  - `LOG_LEVEL`
  - `TOKEN_SECRET`

### 4. Validation Engine

PipelineForge has a rule-based validation engine. It does not rely fully on AI generation.

The validation model checks:

- Repository intake
- Package manifest
- Service model
- Dockerfile presence
- Ignore rules
- Build command
- Start command
- Test command
- Runtime environment
- Secret externalization
- Committed `.env` risk

It also produces:

- Production readiness score
- Score breakdown
- Reasons why the score is below 100
- Path-to-100 recommendations
- Blocking/review/ready promotion decision

Important fix already made:

- If the score is already 100, PipelineForge no longer says awkward things like "Why 100 and not 100".
- Blocking gates and readiness score now communicate separately.

### 5. Template and Generated File Engine

PipelineForge generates deterministic files from structured templates and rules.

For simple apps, it can generate:

- Dockerfile
- `.dockerignore`
- Jenkinsfile
- `azure-pipelines.yml`
- `docker-compose.yml`
- Kubernetes deployment/service/ingress YAML

For multi-service apps like Sovereign Code, it generates service-aware assets:

- Backend Dockerfile
- Frontend Dockerfile
- Backend `.dockerignore`
- Frontend `.dockerignore`
- Multi-service `docker-compose.yml`
- Kubernetes Secret manifest
- Kubernetes backend/frontend Deployment manifest
- Kubernetes backend/frontend Service manifest
- Kubernetes Ingress manifest
- Jenkinsfile with separate image build stages
- Azure Pipelines YAML with separate backend/frontend image build stages

### 6. Deployment Inputs

PipelineForge now asks for production inputs before marking generated configs as ready.

Current important inputs include:

- App port
- Image registry
- Build command
- Start command
- Test command
- Public domain
- Database URL
- Token secret
- CORS origin

For Sovereign Code, registry/domain/database/token/CORS values must be supplied before sandbox and cloud release gates can pass.

### 7. Sandbox Validation

PipelineForge can run static sandbox checks against generated files.

Checks include:

- Dockerfile syntax/readiness
- Docker ignore hygiene
- Compose smoke-test structure
- Kubernetes deployment image and port readiness
- Kubernetes service selector and target port readiness
- Ingress route readiness
- Azure Pipelines stage readiness
- Jenkinsfile stage readiness

For Sovereign Code, static sandbox validation passes after required deployment inputs are supplied.

### 8. Runtime and Security Gates

PipelineForge has runtime/security gate surfaces for:

- Local toolchain inspection
- Runtime dry-run checks
- Security gates
- Secret exposure checks
- Container user checks
- Image tag policy checks
- Ingress TLS checks
- Deployment lock checks

Some runtime checks depend on local Docker, kubectl, Terraform, Trivy, and cloud credentials being available.

### 9. Pipeline Stage

PipelineForge supports two CI/CD provider paths:

- Azure Pipelines
- Jenkins

For PipelineForge's own production deployment, Jenkins is now the preferred CI/CD provider.

For generated user-app pipelines, PipelineForge can show stack-aware modular stages such as:

- Checkout
- Detect services
- Install dependencies
- Run tests
- Build backend image
- Build frontend image
- Security scan
- Push images
- Deploy

Deployment remains locked until cloud target, secrets, credentials, and environment approvals are configured.

### 10. Infra Stage

PipelineForge supports cloud target planning for:

- Azure
- AWS

The infra stage now includes a manual cloud handoff checklist that shows:

- Service map
- Required cloud values
- Deployment secrets
- Registry/domain/credential requirements

For Sovereign Code on AWS, the recommended manual validation target is:

- ECR
- EKS
- RDS PostgreSQL
- Secrets
- ALB / ingress
- Route 53
- ACM
- CloudWatch
- IAM roles

### 11. Documentation and Test Planning

Current docs include:

- `docs/sovereign-code-test-plan.md`
- `docs/sovereign-code-aws-manual-validation.txt`
- `docs/pipelineforge-progress-and-production-readiness.md`

These documents support manual QA and staged production hardening.

## PipelineForge Itself: Production Deployment Path

PipelineForge itself is planned to deploy to AWS with:

- Jenkins for CI/CD
- Terraform for infrastructure
- Amazon ECR for images
- Amazon ECS Fargate for runtime
- Application Load Balancer for public routing
- S3 for uploaded repo and generated artifact storage
- CloudWatch Logs for observability
- Optional RDS PostgreSQL later for persisted product data

The reason we chose ECS Fargate for PipelineForge itself is simplicity:

- Faster first production deployment
- Lower operational overhead than EKS
- Good fit for a frontend container plus API container
- EKS can still be added later if PipelineForge needs Kubernetes-native platform operations

## Production Fix Completed In This Stage

PipelineForge API now consistently uses port `8095` for local and production alignment.

Updated:

- Local API default: `8095`
- Vite dev proxy: `/api -> http://localhost:8095`
- API Dockerfile: `PORT=8095`
- API Dockerfile: `EXPOSE 8095`
- ECS API target group: configurable `api_container_port`, default `8095`
- ECS API service load balancer port: `8095`
- ECS security group API ingress: `8095`
- README local backend URL: `http://localhost:8095`

The production CI/CD path now uses Jenkins instead of Azure Pipelines:

- `Jenkinsfile.production` is the executable Jenkins pipeline.
- `jenkins.yaml` documents the Jenkins job contract, required tools, credentials, stages, and AWS permissions.
- The old `azure-pipelines.production.yml` file was removed.

## Remaining Work Before Calling PipelineForge Production-Ready

### Product Features

1. Add a clearer service topology panel.
2. Improve recommendations so every action points to an exact field or stage.
3. Add downloadable project bundles instead of only per-file preview/download.
4. Add persistent project history.
5. Add real user authentication and authorization.
6. Add workspace/team model.
7. Add artifact storage for uploaded repos and generated output.
8. Add audit trail for generated files and release decisions.

### Validation Engine

1. Add real Docker build execution when Docker is available.
2. Add `docker compose config` and optional compose smoke run.
3. Add `kubectl apply --dry-run=client` for generated Kubernetes YAML.
4. Add Terraform format/validate checks for generated infra.
5. Add Trivy or equivalent image/config security scanning.
6. Add policy-as-code gates for secrets, image tags, root containers, TLS, and exposed ports.

### Cloud Generation

1. Expand generated AWS Terraform beyond starter files.
2. Expand generated Azure Terraform beyond starter files.
3. Add ECS task definition generation for user apps if ECS is selected.
4. Add complete EKS manifests and ingress annotations for AWS Load Balancer Controller.
5. Add AWS Secrets Manager or External Secrets integration.
6. Add cost estimation for selected infra.
7. Add drift detection between generated Terraform and deployed infrastructure.

### PipelineForge App Deployment

1. Finalize AWS ECS Terraform validation.
2. Add Terraform state bootstrap automation.
3. Add Jenkins controller/agent setup documentation.
4. Add production environment variable and secret strategy.
5. Add ALB HTTPS redirect and certificate handling.
6. Add private subnet/NAT or VPC endpoint strategy before stricter production hardening.
7. Add monitoring alarms for API 5xx, target health, CPU, memory, and storage.

## Current Production Readiness Estimate

Approximate status:

- UI workflow: 70%
- Analyzer and validation engine: 65%
- Multi-service support: 60%
- Generated Docker/Compose/Kubernetes/CI assets: 60%
- Sandbox/static checks: 55%
- Real executable validation: 30%
- Cloud infra generation for user apps: 30%
- PipelineForge self-deployment infra: 45%
- Authentication, persistence, audit, teams: 15%

Overall product production readiness:

About 50%.

This is much stronger than the earlier 35% because PipelineForge now has real multi-service detection, service-aware generation, input-aware validation, sandbox checks, production handoff docs, and its own AWS deployment foundation. It is still not 100% because real cloud apply, persistence, auth, artifact storage, executable validation, and full Terraform generation are not complete yet.
