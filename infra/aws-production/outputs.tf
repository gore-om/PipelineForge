output "frontend_ecr_repository_url" {
  value = aws_ecr_repository.frontend.repository_url
}

output "api_ecr_repository_url" {
  value = aws_ecr_repository.api.repository_url
}

output "load_balancer_dns_name" {
  value = aws_lb.main.dns_name
}

output "artifact_bucket_name" {
  value = aws_s3_bucket.artifacts.bucket
}

output "ecs_cluster_name" {
  value = aws_ecs_cluster.main.name
}

output "frontend_service_name" {
  value = aws_ecs_service.frontend.name
}

output "api_service_name" {
  value = aws_ecs_service.api.name
}
