# s3-boot deployment trigger
# When image_hash changes, SSH into the VPS and trigger the flash process.

resource "terraform_data" "s3boot_flash" {
  # Only trigger when image_hash actually changes
  triggers_replace = var.image_hash

  connection {
    type        = "ssh"
    host        = hostinger_vps.dev.ipv4_address
    user        = "root"
    private_key = var.ssh_private_key
    timeout     = "2m"
  }

  # Write SSH authorized keys so access is preserved after flash
  provisioner "remote-exec" {
    inline = [
      "mkdir -p /home/devuser/.ssh",
      "echo '${var.ssh_public_key}' > /home/devuser/.ssh/authorized_keys",
      "chmod 700 /home/devuser/.ssh",
      "chmod 600 /home/devuser/.ssh/authorized_keys",
      "chown -R devuser:devuser /home/devuser/.ssh",
      "mkdir -p /root/.ssh",
      "echo '${var.ssh_public_key}' > /root/.ssh/authorized_keys",
      "chmod 700 /root/.ssh",
      "chmod 600 /root/.ssh/authorized_keys",
    ]
  }

  # Upload the s3-boot scripts
  provisioner "file" {
    source      = "${path.module}/../s3-boot/scripts/"
    destination = "/tmp/s3-boot-scripts"
  }

  # Run the flash trigger
  provisioner "remote-exec" {
    inline = [
      "chmod +x /tmp/s3-boot-scripts/*.sh",
      "bash /tmp/s3-boot-scripts/trigger-flash.sh '${var.s3_bucket}' '${var.s3_region}' 'images/dotfiles-ubuntu-22.04.raw.lz4' '${var.image_hash}'",
    ]
  }
}
