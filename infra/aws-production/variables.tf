variable "project_name" {
  type    = string
  default = "pipelineforge"
}

variable "environment" {
  type    = string
  default = "production"
}

variable "aws_region" {
  type    = string
  default = "us-east-1"
}

variable "frontend_image_tag" {
  type        = string
  description = "Frontend image tag pushed by Azure Pipelines."
}

variable "api_image_tag" {
  type        = string
  description = "API image tag pushed by Azure Pipelines."
}

variable "desired_count" {
  type    = number
  default = 1
}

variable "certificate_arn" {
  type        = string
  default     = ""
  description = "Optional ACM certificate ARN. When empty, only HTTP listener is created."
}

variable "allowed_http_cidr_blocks" {
  type    = list(string)
  default = ["0.0.0.0/0"]
}

variable "create_database" {
  type    = bool
  default = false
}

variable "database_name" {
  type    = string
  default = "pipelineforge"
}

variable "database_username" {
  type      = string
  default   = "pipelineforge"
  sensitive = true
}

variable "database_password" {
  type      = string
  default   = ""
  sensitive = true
}
