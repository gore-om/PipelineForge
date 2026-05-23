# PipelineForge AWS Production Infrastructure

This folder provisions the AWS foundation for running PipelineForge itself.

## Target Architecture

- Azure Pipelines builds and deploys
- Amazon ECR stores frontend and API images
- Amazon ECS Fargate runs frontend and API services
- Application Load Balancer exposes the app
- Path routing sends `/api/*` to the API service
- S3 stores uploaded repositories and generated artifacts
- CloudWatch stores application logs
- Optional RDS PostgreSQL is available for later persistent app data

## First Deploy Flow

1. Create remote Terraform state resources manually or with a bootstrap stack.
2. Configure `backend.hcl` from `backend.hcl.example`.
3. Configure `terraform.tfvars` from `terraform.tfvars.example`.
4. Run:

```bash
terraform init -backend-config=backend.hcl
terraform plan
terraform apply
```

For the first Terraform apply, set placeholder image tags. Azure Pipelines will later build and push real image tags to ECR, then run Terraform with the new image tags.

## Notes

This v1 uses ECS Fargate instead of EKS to keep PipelineForge production deployment simpler, faster, and cheaper to operate. EKS can be added later if we specifically need Kubernetes for PipelineForge itself.
