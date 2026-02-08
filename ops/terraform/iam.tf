# ─── IAM Users ────────────────────────────────────────────────────────────────

resource "aws_iam_user" "aviral" {
  name = "aviral"

  tags = {
    AKIAXQDYCVWIGR4H36G5 = "devbox"
  }
}

resource "aws_iam_user" "dotfiles_ci" {
  name = "dotfiles-ci"

  tags = {
    AKIAXQDYCVWIBCYUSFU5 = "dotfiles-ci"
  }
}

# ─── IAM Group ────────────────────────────────────────────────────────────────

resource "aws_iam_group" "admin" {
  name = "admin"
}

# ─── Group Memberships ───────────────────────────────────────────────────────

resource "aws_iam_group_membership" "admin" {
  name  = "admin-group-membership"
  group = aws_iam_group.admin.name

  users = [
    aws_iam_user.aviral.name,
    aws_iam_user.dotfiles_ci.name,
  ]
}

# ─── Group Policy Attachments ────────────────────────────────────────────────

resource "aws_iam_group_policy_attachment" "admin_administrator_access" {
  group      = aws_iam_group.admin.name
  policy_arn = "arn:aws:iam::aws:policy/AdministratorAccess"
}

# ─── User Policy Attachments ────────────────────────────────────────────────

resource "aws_iam_user_policy_attachment" "aviral_change_password" {
  user       = aws_iam_user.aviral.name
  policy_arn = "arn:aws:iam::aws:policy/IAMUserChangePassword"
}

# ─── IAM Roles ───────────────────────────────────────────────────────────────

resource "aws_iam_role" "eks_cluster_role" {
  name               = "eks-cluster-role"
  max_session_duration = 3600

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Principal = {
          Service = "eks.amazonaws.com"
        }
        Action = "sts:AssumeRole"
      }
    ]
  })
}

resource "aws_iam_role" "go_serverless_executor" {
  name = "go-serverless-executor"
  path = "/service-role/"
  max_session_duration = 3600

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Principal = {
          Service = "lambda.amazonaws.com"
        }
        Action = "sts:AssumeRole"
      }
    ]
  })
}

# ─── Role Policy Attachments ────────────────────────────────────────────────

resource "aws_iam_role_policy_attachment" "eks_cluster_policy" {
  role       = aws_iam_role.eks_cluster_role.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonEKSClusterPolicy"
}

resource "aws_iam_role_policy_attachment" "go_serverless_microservice" {
  role       = aws_iam_role.go_serverless_executor.name
  policy_arn = aws_iam_policy.lambda_microservice_execution.arn
}

resource "aws_iam_role_policy_attachment" "go_serverless_basic_execution" {
  role       = aws_iam_role.go_serverless_executor.name
  policy_arn = aws_iam_policy.lambda_basic_execution.arn
}

# ─── Customer-Managed Policies ──────────────────────────────────────────────

resource "aws_iam_policy" "eks_dynamodb_policy" {
  name = "eks-dynamodb-policy"
  path = "/"

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = "dynamodb:*"
        Resource = "arn:aws:dynamodb:*:515647909264:table/*"
      }
    ]
  })
}

resource "aws_iam_policy" "lambda_microservice_execution" {
  name = "AWSLambdaMicroserviceExecutionRole-e59ebbfc-8e71-4b95-9392-f828ac45a6d1"
  path = "/service-role/"

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "dynamodb:DeleteItem",
          "dynamodb:GetItem",
          "dynamodb:PutItem",
          "dynamodb:Scan",
          "dynamodb:UpdateItem",
        ]
        Resource = "arn:aws:dynamodb:us-west-1:515647909264:table/*"
      }
    ]
  })
}

resource "aws_iam_policy" "lambda_basic_execution" {
  name = "AWSLambdaBasicExecutionRole-78725c3f-9305-4599-a610-41ee2d49f3b0"
  path = "/service-role/"

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = "logs:CreateLogGroup"
        Resource = "arn:aws:logs:us-west-1:515647909264:*"
      },
      {
        Effect = "Allow"
        Action = [
          "logs:CreateLogStream",
          "logs:PutLogEvents",
        ]
        Resource = [
          "arn:aws:logs:us-west-1:515647909264:log-group:/aws/lambda/go-serverless:*",
        ]
      }
    ]
  })
}