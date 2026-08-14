# Require holder consent for healthy lease transfer

Only the Lease Holder may approve or deny a healthy transfer request. A healthy holder cannot be forcibly displaced in
V1: it keeps live authority while one requester waits and may renew without clearing that request. The requester is
promoted only after approval, deliberate release, hide, close, detach, explicit switch, or expiry. This makes transfer
explicit and keeps stale-holder recovery bounded without reintroducing silent takeover.
