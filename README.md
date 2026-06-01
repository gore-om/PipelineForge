# PipelineForge

PipelineForge is a production-ready DevOps bootstrap and validation platform. It analyzes repositories, detects runtime stacks, generates deterministic DevOps templates, validates configuration quality, and prepares projects for CI/CD and cloud deployment.

## Current Capabilities

- Premium blue DevOps interface
- Two repository intake options:
  - GitHub repository URL
  - Local ZIP upload
- Stack detection for Node, React, Vite, Next.js, Express, Python, Java, Docker, and database hints
- Multi-service detection for frontend/backend repositories
- Service-level port detection
- PostgreSQL dependency detection
- Deterministic golden-template selection
- Validation rules and production-readiness score
- Score explanation and path-to-100 recommendations
- Deployment input resolution for registry, domain, database URL, token secret, and CORS origin
- Generated Docker, Compose, Kubernetes, Jenkins, and Azure Pipelines assets
- Release bundle ZIP export with generated files, manifest, readiness report, and redacted deployment inputs
- Backend project-history persistence for recent analyses
- Static sandbox validation and security gate previews
- ECS Fargate task/service validation for generated AWS deployments
- Manual deployment handoff checklist and release evidence view

## Run Locally

```bash
npm install
npm run dev
```

Frontend: `http://localhost:5173`

Backend/API: `http://localhost:8095`

## Regression Test

Run the Sovereign Code regression before manual cloud testing:

```bash
npm run test:sovereign
```

By default, the test uses `D:\Sovereign_Code.zip`. To use another archive:

```bash
npm run test:sovereign -- D:\path\to\repo.zip
```

The runner starts the API on a temporary test port, disables analysis persistence, uploads the ZIP, validates multi-service detection, checks AKS/EKS/ECS generated assets, runs ECS sandbox/runtime/security APIs, and verifies the release bundle layout with redacted secrets.

## Next Stages

1. Add project persistence, authentication, and workspace history.
2. Add a service topology panel for frontend/backend/database visibility.
3. Add executable Docker, Compose, Kubernetes, Terraform, and security validations.
4. Expand generated AWS/Azure Terraform beyond starter previews.
5. Add cost estimation, drift detection, and observability gates.

## PipelineForge Production Deployment

PipelineForge itself is planned for AWS deployment with Jenkins and Terraform.

Production deployment code now lives in:

- `client/Dockerfile`
- `server/Dockerfile`
- `Jenkinsfile.production`
- `jenkins.yaml`

Target AWS services:

- Amazon ECR for frontend/API container images
- Amazon ECS Fargate for runtime
- Application Load Balancer for public routing
- CloudWatch Logs for container logs
- S3 for uploaded repositories and generated artifacts
- Optional RDS PostgreSQL for persisted product data
- IAM roles for ECS tasks and Jenkins deployment access

The first production path is ECS Fargate, not EKS, to keep v1 simpler and faster to operate. EKS can be added later if PipelineForge itself needs Kubernetes-native operations.
