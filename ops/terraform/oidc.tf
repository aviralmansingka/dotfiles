# ─── GitHub Actions OIDC Federation ──────────────────────────────────────────

data "aws_caller_identity" "current" {}

resource "aws_iam_openid_connect_provider" "github_actions" {
  url             = "https://token.actions.githubusercontent.com"
  client_id_list  = ["sts.amazonaws.com"]
  thumbprint_list = ["ffffffffffffffffffffffffffffffffffffffff"]
}

resource "aws_iam_role" "github_actions" {
  name = "github-actions-terraform"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Principal = {
        Federated = aws_iam_openid_connect_provider.github_actions.arn
      }
      Action = "sts:AssumeRoleWithWebIdentity"
      Condition = {
        StringEquals = {
          "token.actions.githubusercontent.com:aud" = "sts.amazonaws.com"
        }
        StringLike = {
          "token.actions.githubusercontent.com:sub" = "repo:aviralmansingka/dotfiles:*"
        }
      }
    }]
  })
}

resource "aws_iam_role_policy" "github_actions" {
  name = "github-actions-ci"
  role = aws_iam_role.github_actions.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "EC2Full"
        Effect   = "Allow"
        Action   = "ec2:*"
        Resource = "*"
      },
      {
        Sid      = "IAMManagement"
        Effect   = "Allow"
        Action   = "iam:*"
        Resource = "*"
      },
      {
        Sid    = "S3StateAndImages"
        Effect = "Allow"
        Action = "s3:*"
        Resource = [
          "arn:aws:s3:::aviral-dotfiles-terraform-state",
          "arn:aws:s3:::aviral-dotfiles-terraform-state/*",
          "arn:aws:s3:::aviral-devbox-terraform-state",
          "arn:aws:s3:::aviral-devbox-terraform-state/*",
          "arn:aws:s3:::aviral-dotfiles-vm-images",
          "arn:aws:s3:::aviral-dotfiles-vm-images/*"
        ]
      },
      {
        Sid      = "STSGetCallerIdentity"
        Effect   = "Allow"
        Action   = "sts:GetCallerIdentity"
        Resource = "*"
      }
    ]
  })
}

resource "github_actions_secret" "aws_role_arn" {
  repository      = data.github_repository.dotfiles.name
  secret_name     = "AWS_ROLE_ARN"
  plaintext_value = aws_iam_role.github_actions.arn
}
