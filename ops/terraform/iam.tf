# ─── IAM Users ────────────────────────────────────────────────────────────────

resource "aws_iam_user" "aviral" {
  name = "aviral"

  tags = {
    AKIAXQDYCVWIGR4H36G5 = "devbox"
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
