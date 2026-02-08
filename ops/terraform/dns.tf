# ─── aviralmansingka.me ──────────────────────────────────────────────────────

resource "hostinger_dns_record" "am_a_root" {
  zone  = "aviralmansingka.me"
  name  = "@"
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

resource "hostinger_dns_record" "ax_aaaa_root" {
  zone  = "avirus.xyz"
  name  = "@"
  type  = "AAAA"
  value = "2a02:4780:84::32"
  ttl   = 1800
}

resource "hostinger_dns_record" "ax_cname_www" {
  zone  = "avirus.xyz"
  name  = "www"
  type  = "CNAME"
  value = "avirus.xyz."
  ttl   = 300
}
