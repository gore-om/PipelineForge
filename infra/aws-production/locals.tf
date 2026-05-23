locals {
  name_prefix  = "${var.project_name}-${var.environment}"
  short_prefix = "pf-${var.environment}"

  common_tags = {
    Project     = var.project_name
    Environment = var.environment
    ManagedBy   = "terraform"
  }

  frontend_container_name = "frontend"
  api_container_name      = "api"
}
