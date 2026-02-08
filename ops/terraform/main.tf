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

resource "aws_s3_bucket" "terraform_test_us_west_1" {
  provider = aws.us_west_1
  bucket   = "aviralmansingka-terraform-test-us-west-1"

  tags = {
    env = "test"
  }
}

resource "aws_s3_bucket" "terraform_test_ap_south_1" {
  provider = aws.ap_south_1
  bucket   = "aviralmansingka-terraform-test-ap-south-1"

  tags = {
    created_by  = "terraform"
    environment = "test"
  }
}

output "vps_ipv4" {
  value = hostinger_vps.dev.ipv4_address
}