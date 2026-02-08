resource "hostinger_vps" "dev" {
  plan           = "KVM 4"
  data_center_id = 17
  template_id    = 1077
  hostname       = "srv717581.hstgr.cloud"
}

resource "aws_s3_bucket" "vm_images" {
  bucket = "aviral-dotfiles-vm-images"
}

resource "aws_s3_bucket" "terraform_state" {
  bucket = "aviral-dotfiles-terraform-state"
}

output "vps_ipv4" {
  value = hostinger_vps.dev.ipv4_address
}