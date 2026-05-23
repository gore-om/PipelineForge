# PipelineForge

PipelineForge is a production-ready DevOps bootstrap and validation platform. It analyzes repositories, detects runtime stacks, generates deterministic DevOps templates, validates configuration quality, and prepares projects for CI/CD and cloud deployment.

## Stage 1 Scope

- Premium blue DevOps interface
- Two repository intake options:
  - GitHub repository URL
  - Local ZIP upload
- Stack detection for Node, React, Vite, Next.js, Python, Java, Docker, and database hints
- Deterministic golden-template recommendations
- Validation rules and production-readiness score
- Modular Jenkins pipeline preview

## Run Locally

```bash
npm install
npm run dev
```

Frontend: `http://localhost:5173`

Backend: `http://localhost:8080`

## Next Stages

1. Generate downloadable Dockerfile, Jenkinsfile, and compose templates.
2. Add sandbox Docker validation.
3. Add Jenkins pipeline generation with stack-aware stage toggles.
4. Add cloud deployment targets.
5. Add cost estimation, drift detection, and security gates.

## PipelineForge Production Deployment

PipelineForge itself is planned for AWS deployment with Azure Pipelines and Terraform.

Production deployment code now lives in:

- `client/Dockerfile`
- `server/Dockerfile`
- `azure-pipelines.production.yml`
- `infra/aws-production`

Target AWS services:

- Amazon ECR for frontend/API container images
- Amazon ECS Fargate for runtime
- Application Load Balancer for public routing
- CloudWatch Logs for container logs
- S3 for uploaded repositories and generated artifacts
- Optional RDS PostgreSQL for persisted product data
- IAM roles for ECS tasks and deployment access

The first production path is ECS Fargate, not EKS, to keep v1 simpler and faster to operate. EKS can be added later if PipelineForge itself needs Kubernetes-native operations.
