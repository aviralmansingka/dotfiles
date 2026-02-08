data "github_repository" "dotfiles" {
  full_name = "aviralmansingka/dotfiles"
}

resource "github_actions_secret" "aws_access_key_id" {
  repository      = data.github_repository.dotfiles.name
  secret_name     = "AWS_ACCESS_KEY_ID"
  plaintext_value = var.aws_access_key_id
}

resource "github_actions_secret" "aws_secret_access_key" {
  repository      = data.github_repository.dotfiles.name
  secret_name     = "AWS_SECRET_ACCESS_KEY"
  plaintext_value = var.aws_secret_access_key
}

resource "github_actions_secret" "hostinger_api_token" {
  repository      = data.github_repository.dotfiles.name
  secret_name     = "HOSTINGER_API_TOKEN"
  plaintext_value = var.hostinger_api_token
}
