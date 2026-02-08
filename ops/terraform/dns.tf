# ─── aviralmansingka.me ──────────────────────────────────────────────────────

resource "hostinger_dns_record" "am_a_root" {
  zone  = "aviralmansingka.me"
  name  = "@"
  type  = "A"
  value = "84.32.84.32"
  ttl   = 50
}

resource "hostinger_dns_record" "am_a_wildcard" {
  zone  = "aviralmansingka.me"
  name  = "*"
  type  = "A"
  value = "84.32.84.32"
  ttl   = 50
}

# ─── avirus.xyz ──────────────────────────────────────────────────────────────

resource "hostinger_dns_record" "ax_a_root" {
  zone  = "avirus.xyz"
  name  = "@"
  type  = "A"
  value = "157.173.210.202"
}

resource "hostinger_dns_record" "ax_a_wildcard" {
  zone  = "avirus.xyz"
  name  = "*"
  type  = "A"
  value = "157.173.210.202"
}
