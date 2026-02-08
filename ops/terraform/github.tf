data "github_repository" "dotfiles" {
  full_name = "aviralmansingka/dotfiles"
}

resource "github_actions_secret" "hostinger_api_token" {
  repository      = data.github_repository.dotfiles.name
  secret_name     = "HOSTINGER_API_TOKEN"
  plaintext_value = var.hostinger_api_token
}
