output "vps_id" {
  value       = hostinger_vps.dev.id
  description = "Hostinger VPS ID"
}

output "vps_ipv4" {
  value       = hostinger_vps.dev.ipv4_address
  description = "VPS public IPv4 address"
}
