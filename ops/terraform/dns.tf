# ─── aviralmansingka.me ──────────────────────────────────────────────────────

resource "hostinger_dns_record" "am_a_root" {
  zone  = "aviralmansingka.me"
  name  = "@"
  type  = "A"
  value = "84.32.84.32"
  ttl   = 50
}

resource "hostinger_dns_record" "am_cname_www" {
  zone  = "aviralmansingka.me"
  name  = "www"
  type  = "CNAME"
  value = "aviralmansingka.me."
  ttl   = 300
}

resource "hostinger_dns_record" "am_caa_issue_pki_goog" {
  zone  = "aviralmansingka.me"
  name  = "@"
  type  = "CAA"
  value = "0 issue \"pki.goog\""
}

resource "hostinger_dns_record" "am_caa_issue_comodoca" {
  zone  = "aviralmansingka.me"
  name  = "@"
  type  = "CAA"
  value = "0 issue \"comodoca.com\""
}

resource "hostinger_dns_record" "am_caa_issue_digicert" {
  zone  = "aviralmansingka.me"
  name  = "@"
  type  = "CAA"
  value = "0 issue \"digicert.com\""
}

resource "hostinger_dns_record" "am_caa_issue_globalsign" {
  zone  = "aviralmansingka.me"
  name  = "@"
  type  = "CAA"
  value = "0 issue \"globalsign.com\""
}

resource "hostinger_dns_record" "am_caa_issue_letsencrypt" {
  zone  = "aviralmansingka.me"
  name  = "@"
  type  = "CAA"
  value = "0 issue \"letsencrypt.org\""
}

resource "hostinger_dns_record" "am_caa_issue_sectigo" {
  zone  = "aviralmansingka.me"
  name  = "@"
  type  = "CAA"
  value = "0 issue \"sectigo.com\""
}

resource "hostinger_dns_record" "am_caa_issuewild_comodoca" {
  zone  = "aviralmansingka.me"
  name  = "@"
  type  = "CAA"
  value = "0 issuewild \"comodoca.com\""
}

resource "hostinger_dns_record" "am_caa_issuewild_globalsign" {
  zone  = "aviralmansingka.me"
  name  = "@"
  type  = "CAA"
  value = "0 issuewild \"globalsign.com\""
}

resource "hostinger_dns_record" "am_caa_issuewild_letsencrypt" {
  zone  = "aviralmansingka.me"
  name  = "@"
  type  = "CAA"
  value = "0 issuewild \"letsencrypt.org\""
}

resource "hostinger_dns_record" "am_caa_issuewild_pki_goog" {
  zone  = "aviralmansingka.me"
  name  = "@"
  type  = "CAA"
  value = "0 issuewild \"pki.goog\""
}

resource "hostinger_dns_record" "am_caa_issuewild_sectigo" {
  zone  = "aviralmansingka.me"
  name  = "@"
  type  = "CAA"
  value = "0 issuewild \"sectigo.com\""
}

resource "hostinger_dns_record" "am_caa_issuewild_digicert" {
  zone  = "aviralmansingka.me"
  name  = "@"
  type  = "CAA"
  value = "0 issuewild \"digicert.com\""
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

resource "hostinger_dns_record" "ax_caa_issue_pki_goog" {
  zone  = "avirus.xyz"
  name  = "@"
  type  = "CAA"
  value = "0 issue \"pki.goog\""
}

resource "hostinger_dns_record" "ax_caa_issue_comodoca" {
  zone  = "avirus.xyz"
  name  = "@"
  type  = "CAA"
  value = "0 issue \"comodoca.com\""
}

resource "hostinger_dns_record" "ax_caa_issue_digicert" {
  zone  = "avirus.xyz"
  name  = "@"
  type  = "CAA"
  value = "0 issue \"digicert.com\""
}

resource "hostinger_dns_record" "ax_caa_issue_globalsign" {
  zone  = "avirus.xyz"
  name  = "@"
  type  = "CAA"
  value = "0 issue \"globalsign.com\""
}

resource "hostinger_dns_record" "ax_caa_issue_letsencrypt" {
  zone  = "avirus.xyz"
  name  = "@"
  type  = "CAA"
  value = "0 issue \"letsencrypt.org\""
}

resource "hostinger_dns_record" "ax_caa_issue_sectigo" {
  zone  = "avirus.xyz"
  name  = "@"
  type  = "CAA"
  value = "0 issue \"sectigo.com\""
}

resource "hostinger_dns_record" "ax_caa_issuewild_comodoca" {
  zone  = "avirus.xyz"
  name  = "@"
  type  = "CAA"
  value = "0 issuewild \"comodoca.com\""
}

resource "hostinger_dns_record" "ax_caa_issuewild_globalsign" {
  zone  = "avirus.xyz"
  name  = "@"
  type  = "CAA"
  value = "0 issuewild \"globalsign.com\""
}

resource "hostinger_dns_record" "ax_caa_issuewild_letsencrypt" {
  zone  = "avirus.xyz"
  name  = "@"
  type  = "CAA"
  value = "0 issuewild \"letsencrypt.org\""
}

resource "hostinger_dns_record" "ax_caa_issuewild_pki_goog" {
  zone  = "avirus.xyz"
  name  = "@"
  type  = "CAA"
  value = "0 issuewild \"pki.goog\""
}

resource "hostinger_dns_record" "ax_caa_issuewild_sectigo" {
  zone  = "avirus.xyz"
  name  = "@"
  type  = "CAA"
  value = "0 issuewild \"sectigo.com\""
}

resource "hostinger_dns_record" "ax_caa_issuewild_digicert" {
  zone  = "avirus.xyz"
  name  = "@"
  type  = "CAA"
  value = "0 issuewild \"digicert.com\""
}
