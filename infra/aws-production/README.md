# PipelineForge AWS Production Infrastructure

This folder provisions the AWS foundation for running PipelineForge itself.

## Target Architecture

- Jenkins builds and deploys
- Amazon ECR stores frontend and API images
- Amazon ECS Fargate runs frontend and API services
- Application Load Balancer exposes the app
- Path routing sends `/api/*` to the API service
- PipelineForge API listens on port `8095`
- S3 stores uploaded repositories and generated artifacts
- CloudWatch stores application logs
- Optional RDS PostgreSQL is available for later persistent app data

## First Deploy Flow

1. Create remote Terraform state resources manually or with a bootstrap stack.
2. Configure `backend.hcl` from `backend.hcl.example`.
3. Configure `terraform.tfvars` from `terraform.tfvars.example`.
4. For a local first deploy, create ECR repositories first:

```bash
terraform init -backend-config=backend.hcl
terraform apply \
  -target=aws_ecr_repository.frontend \
  -target=aws_ecr_lifecycle_policy.frontend \
  -target=aws_ecr_repository.api \
  -target=aws_ecr_lifecycle_policy.api
```

5. Push frontend and API images to ECR.

6. Run the full infrastructure apply:

```bash
terraform plan
terraform apply
```

In Jenkins, set `BOOTSTRAP_ECR=true` for the first deployment so ECR exists before the image push stage. Keep `APPLY_TERRAFORM=false` until the generated plan is reviewed, then rerun with `APPLY_TERRAFORM=true`.

## Production Validation Gates

Before applying production infrastructure, confirm:

- `terraform fmt -check` passes.
- `terraform validate` passes after backend initialization.
- Jenkins has Docker, AWS CLI, Terraform, Node.js, and npm available.
- Jenkins has AWS credentials or an instance profile with ECR, ECS, ALB, IAM, S3, CloudWatch, and optional RDS permissions.
- Jenkins has a secret text credential named `aws-account-id`.
- `backend.hcl` exists and points to the production S3/DynamoDB Terraform state backend.
- `terraform.tfvars` sets real image tags, AWS region, and certificate settings.
- `Jenkinsfile.production` apply remains gated by `APPLY_TERRAFORM=true` plus manual approval.

## Notes

This v1 uses ECS Fargate instead of EKS to keep PipelineForge production deployment simpler, faster, and cheaper to operate. EKS can be added later if we specifically need Kubernetes for PipelineForge itself.
