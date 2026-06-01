# PipelineForge AWS Internet Deployment Resources

This checklist is for deploying PipelineForge itself on the public internet. It does not create resources. Use it to plan AWS setup before writing or applying Terraform.

## Recommended Runtime

Use ECS Fargate for the first production deployment of PipelineForge.

Reason:

- PipelineForge has two deployable containers: frontend and API.
- ECS Fargate avoids managing EC2 worker nodes.
- It is simpler than EKS for the first internet deployment.
- It still supports load balancing, logs, IAM roles, ECR images, and private networking.

## Core AWS Resources

### 1. VPC

Required.

Purpose:

- Network boundary for PipelineForge.
- Hosts ALB, ECS tasks, optional RDS, NAT, and VPC endpoints.

Recommended:

- 1 VPC
- 2 public subnets in different Availability Zones
- 2 private subnets in different Availability Zones
- Internet gateway
- NAT gateway or VPC endpoints for private ECS tasks
- Route tables for public and private subnets

### 2. Public Subnets

Required.

Purpose:

- Application Load Balancer should live in public subnets.

### 3. Private Subnets

Required.

Purpose:

- ECS Fargate tasks should run privately.
- Optional RDS should run privately.

### 4. Internet Gateway

Required.

Purpose:

- Allows internet traffic to reach the public ALB.

### 5. NAT Gateway or VPC Endpoints

Required if ECS tasks run in private subnets and need outbound access.

Use one of these patterns:

- NAT Gateway: easier, but costs more.
- VPC endpoints: better long-term control for ECR, S3, CloudWatch Logs, Secrets Manager, and ECS.

Minimum useful endpoints if avoiding NAT:

- ECR API
- ECR Docker
- S3 Gateway endpoint
- CloudWatch Logs
- Secrets Manager
- ECS

### 6. Amazon ECR

Required.

Create repositories:

- `pipelineforge-frontend`
- `pipelineforge-api`

Recommended settings:

- Image scan on push
- Lifecycle policy to keep last 20-30 images
- Immutable tags for production once pipeline is stable

### 7. ECS Cluster

Required.

Purpose:

- Runs PipelineForge frontend and API services.

Recommended:

- ECS cluster with Container Insights enabled.
- Fargate capacity provider.

### 8. ECS Task Definitions

Required.

Create task definitions for:

- PipelineForge frontend
- PipelineForge API

Either use:

- one task definition with two containers, or
- separate frontend and API task definitions.

Recommended for clarity:

- separate frontend service
- separate API service

### 9. ECS Services

Required.

Create:

- `pipelineforge-frontend-service`
- `pipelineforge-api-service`

Recommended:

- Desired count: 1 for first deployment, 2 for production HA
- Deployment circuit breaker enabled
- Rollback enabled
- Private subnet placement
- Security group allowing traffic only from ALB

### 10. Application Load Balancer

Required.

Purpose:

- Public internet entry point.
- Routes browser traffic to frontend.
- Routes `/api/*` traffic to API.

Recommended listeners:

- HTTP 80 redirects to HTTPS 443
- HTTPS 443 forwards traffic

Recommended rules:

- `/api/*` -> API target group
- `/*` -> frontend target group

### 11. Target Groups

Required.

Create:

- Frontend target group
  - protocol: HTTP
  - port: 80
  - target type: IP
  - health path: `/health`

- API target group
  - protocol: HTTP
  - port: 8095
  - target type: IP
  - health path: `/api/health`

### 12. ACM Certificate

Required for HTTPS.

Create:

- public certificate for PipelineForge domain

Example:

- `pipelineforge.yourdomain.com`

Certificate must be in the same region as the ALB.

### 13. Route 53 Hosted Zone / DNS

Required if using your own domain.

Create:

- A or CNAME record from your domain to the ALB.

Example:

- `pipelineforge.yourdomain.com` -> ALB DNS name

### 14. CloudWatch Log Groups

Required.

Create:

- `/ecs/pipelineforge/frontend`
- `/ecs/pipelineforge/api`

Recommended:

- retention: 14 or 30 days for dev
- retention: 90+ days for production if audit is needed

### 15. S3 Artifact Bucket

Required for production-quality PipelineForge.

Purpose:

- Store uploaded ZIP repositories.
- Store generated release bundles.
- Store generated config artifacts.

Recommended:

- block public access
- server-side encryption
- versioning
- lifecycle cleanup

### 16. Database

Recommended, not strictly required for the current local JSON-history implementation.

Use when you want real production persistence.

Recommended service:

- Amazon RDS PostgreSQL

Purpose:

- users
- workspaces
- analysis history
- generated bundle metadata
- audit logs

For first internet test, PipelineForge can run without RDS, but production should move persistence to PostgreSQL.

### 17. AWS Secrets Manager

Required for production.

Store:

- API runtime secrets
- database URL if RDS is used
- session/JWT secret when real auth is added
- GitHub app/client secrets if GitHub integration becomes real

### 18. AWS WAF

Recommended after the first deployment.

Purpose:

- protect ALB from common web attacks
- rate-limit abusive requests

### 19. CloudWatch Alarms

Recommended.

Create alarms for:

- ALB 5xx count
- API target group unhealthy hosts
- frontend target group unhealthy hosts
- ECS CPU high
- ECS memory high
- ECS service desired/running count mismatch
- RDS CPU/storage/connections if RDS is used

## IAM Roles

### 1. ECS Task Execution Role

Required.

Trusted entity:

- `ecs-tasks.amazonaws.com`

Purpose:

- lets ECS/Fargate pull images from ECR
- writes container logs to CloudWatch
- reads runtime secrets if configured through task definition secrets

Attach managed policy:

- `AmazonECSTaskExecutionRolePolicy`

Add if using Secrets Manager in task definition:

- `secretsmanager:GetSecretValue`
- `kms:Decrypt` if secrets use a customer-managed KMS key

### 2. PipelineForge API Task Role

Required.

Trusted entity:

- `ecs-tasks.amazonaws.com`

Purpose:

- permissions used by the PipelineForge API at runtime

Minimum permissions:

- S3 read/write/delete/list for artifact bucket
- Secrets Manager read for app runtime secrets if needed
- CloudWatch put metrics if custom metrics are added

Keep this role separate from the execution role.

### 3. Jenkins Deployment Role / User

Required if Jenkins deploys to AWS.

Preferred:

- IAM role attached to Jenkins EC2 instance or Jenkins agent.

Alternative:

- IAM user access key stored in Jenkins credentials.

Permissions needed:

- ECR login, push, describe repositories
- ECS register task definition
- ECS update service
- ECS describe services/tasks
- IAM pass role for ECS task execution role and task role
- S3/DynamoDB access if using Terraform state
- CloudWatch Logs create/read if Terraform manages log groups
- ALB/Target Group permissions if Terraform manages ALB
- VPC/security group permissions if Terraform manages networking
- RDS permissions if Terraform manages database

Important:

- Jenkins needs `iam:PassRole` only for the exact ECS roles it deploys.

### 4. Terraform State Role

Recommended.

Purpose:

- lets Jenkins run Terraform with controlled permissions.

Can be same as Jenkins deployment role in early stage, but separate it later.

### 5. Optional RDS Monitoring Role

Optional.

Needed only if enhanced monitoring is enabled for RDS.

## Security Groups

### ALB Security Group

Inbound:

- 80 from internet
- 443 from internet

Outbound:

- to ECS services on frontend/API ports

### ECS Service Security Group

Inbound:

- frontend port 80 from ALB security group
- API port 8095 from ALB security group

Outbound:

- to S3/ECR/CloudWatch/Secrets Manager through NAT or VPC endpoints
- to RDS PostgreSQL port 5432 if database is used

### RDS Security Group

Inbound:

- 5432 from ECS service security group only

Outbound:

- default outbound is usually fine

## Jenkins Server Resources

If you do not already have Jenkins:

### Jenkins EC2

Required for Jenkins path.

Recommended first test:

- EC2 instance: `t3.medium`
- EBS volume: 30-50 GB
- Security group:
  - SSH only from your IP
  - Jenkins UI only from your IP or VPN
- IAM instance profile with deployment role permissions

Install:

- Java
- Jenkins
- Docker
- AWS CLI
- Terraform
- Node.js
- Git

Jenkins credentials:

- AWS account ID secret text
- GitHub credentials/token if repo is private
- Optional Docker/ECR credential helper

## Minimum First Internet Deployment

For a first working deployment, create only:

1. VPC
2. 2 public subnets
3. 2 private subnets
4. Internet gateway
5. NAT gateway or needed VPC endpoints
6. ECR frontend repository
7. ECR API repository
8. ECS cluster
9. ECS task execution role
10. PipelineForge API task role
11. ECS frontend task/service
12. ECS API task/service
13. ALB
14. frontend target group
15. API target group
16. ACM certificate
17. Route 53 record
18. CloudWatch log groups
19. S3 artifact bucket
20. Jenkins EC2 or existing Jenkins agent with AWS deploy role

## Later Production Hardening

Add after first deployment works:

- RDS PostgreSQL
- Secrets Manager integration for all app secrets
- WAF
- CloudWatch alarms
- AWS Backup for RDS
- S3 lifecycle policies
- ECR lifecycle policies
- VPC endpoints to reduce NAT dependency
- audit trail in PostgreSQL
- centralized structured logs
- stricter IAM least privilege

## Official AWS References

- ECS task execution role: https://docs.aws.amazon.com/AmazonECS/latest/developerguide/task_execution_IAM_role.html
- ECS IAM role overview: https://docs.aws.amazon.com/en_en/AmazonECS/latest/developerguide/ecs-iam-role-overview.html
- ECS load balancing: https://docs.aws.amazon.com/AmazonECS/latest/developerguide/service-load-balancing.html
- ECS with Application Load Balancer: https://docs.aws.amazon.com/AmazonECS/latest/developerguide/alb.html
- ECR private repositories: https://docs.aws.amazon.com/AmazonECR/latest/userguide/Repositories.html
- ECR lifecycle policies: https://docs.aws.amazon.com/AmazonECR/latest/userguide/lp_creation.html

