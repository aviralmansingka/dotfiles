variable "aws_region" {
  type    = string
  default = "${env("AWS_REGION")}"
}

variable "aws_profile" {
  type    = string
  default = "${env("AWS_PROFILE")}"
}

variable "instance_type" {
  type    = string
  default = "t3.medium"
}

variable "ami_name_prefix" {
  type    = string
  default = "dotfiles-devbox"
}
