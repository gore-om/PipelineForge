resource "aws_db_subnet_group" "main" {
  count      = var.create_database ? 1 : 0
  name       = "${local.name_prefix}-db-subnets"
  subnet_ids = aws_subnet.private[*].id

  tags = local.common_tags
}

resource "aws_db_instance" "postgres" {
  count                   = var.create_database ? 1 : 0
  identifier              = "${local.name_prefix}-postgres"
  engine                  = "postgres"
  engine_version          = "16"
  instance_class          = "db.t4g.micro"
  allocated_storage       = 20
  storage_encrypted       = true
  db_name                 = var.database_name
  username                = var.database_username
  password                = var.database_password
  db_subnet_group_name    = aws_db_subnet_group.main[0].name
  vpc_security_group_ids  = [aws_security_group.database[0].id]
  backup_retention_period = 7
  deletion_protection     = var.database_deletion_protection
  skip_final_snapshot     = !var.database_deletion_protection
  publicly_accessible     = false

  tags = local.common_tags
}
