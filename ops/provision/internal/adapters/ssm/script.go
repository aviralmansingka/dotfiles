package ssm

import (
	"fmt"
	"strings"

	"github.com/aviralmansingka/dotfiles/ops/provision/internal/domain"
)

// ScriptOptions is everything the host-side program needs. Every field is a
// server-resolved value: the parameter path and the nonce identify the attempt,
// the tag and host name are the approved ones, and the key path is fixed
// configuration. No field can be a client value.
type ScriptOptions struct {
	// ParameterName is the store path the host reads. It is the only thing about
	// the key that reaches SSM command history.
	ParameterName string
	// Nonce is the last segment of ParameterName. The script refuses a path that
	// does not carry it, so a replayed command cannot read another attempt's key.
	Nonce string
	// Region is the parameter's region, passed explicitly: SSM names are
	// regional, and the host may carry no default region.
	Region string
	// HostKeyPath is where the key is written, on tmpfs, mode 0600.
	HostKeyPath string
	// HostName is the tailnet hostname the node joins with.
	HostName string
	// Tag is the approved tailnet tag.
	Tag string
}

// Script builds the host-side program text that one SSM Run Command runs.
//
// The value never appears here, and nothing in the program can print it:
//
//   - `set +x` disables shell tracing before anything else runs, so a traced
//     command line can never reach the invocation's stderr and from there SSM
//     command history;
//   - the parameter value is captured in an unexported shell variable and written
//     with one redirect, so it never becomes an argument, a process environment
//     entry, or a line of output;
//   - the key file is created under `umask 077`, asserted 0600, and removed with a
//     trap on every exit path;
//   - the last steps prove the file is gone before the node status is printed.
//
// The program prints exactly one thing on success: `tailscale status --json`.
// The worker reads the device id and the tags from it and nothing else.
func Script(opts ScriptOptions) (string, error) {
	if err := ValidateParameterName(opts.ParameterName); err != nil {
		return "", err
	}
	if err := validateNonce(opts.Nonce); err != nil {
		return "", err
	}
	if err := domain.ValidateAWSRegion(opts.Region); err != nil {
		return "", err
	}
	if err := domain.ValidateHostName(opts.HostName); err != nil {
		return "", err
	}
	if err := domain.ValidateTailnetTag(opts.Tag); err != nil {
		return "", err
	}
	if !domain.IsApprovedTailnetTag(opts.Tag) {
		return "", domain.Invalid("tailnet_tag",
			fmt.Sprintf("%q is not the approved tag %q", opts.Tag, domain.ApprovedTailnetTag))
	}
	if !strings.HasPrefix(opts.HostKeyPath, "/run/") {
		return "", fmt.Errorf("ssm: host key path %q must live under /run", opts.HostKeyPath)
	}
	if strings.ContainsAny(opts.HostKeyPath, "'\"`$ \t") {
		return "", fmt.Errorf("ssm: host key path %q must not contain quotes, whitespace, or shell metacharacters", opts.HostKeyPath)
	}

	var b strings.Builder
	b.WriteString("set -eu\n")
	b.WriteString("set +x\n")
	b.WriteString("umask 077\n")
	// The SSM agent runs as root with a minimal environment: snap-installed aws
	// lives in /snap/bin, and the official Tailscale installer links the client
	// into /usr/bin.
	b.WriteString("PATH='/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:/snap/bin'\n")
	b.WriteString("export PATH\n")
	b.WriteString("PARAM='" + opts.ParameterName + "'\n")
	b.WriteString("NONCE='" + opts.Nonce + "'\n")
	b.WriteString("KEY='" + opts.HostKeyPath + "'\n")
	b.WriteString(`
cleanup() {
  rm -f "$KEY"
}
trap cleanup 0
trap 'cleanup; exit 1' 1 2 15
case "$PARAM" in
  */"$NONCE") ;;
  *) echo "fleet-enroll: the parameter name does not carry this command's nonce" >&2; exit 1 ;;
esac
mkdir -p "$(dirname "$KEY")"
VALUE=$(aws ssm get-parameter --region '` + opts.Region + `' --name "$PARAM" --with-decryption --query Parameter.Value --output text)
printf '%s' "$VALUE" > "$KEY"
unset VALUE
chmod 600 "$KEY"
tailscale up --auth-key="file:$KEY" --advertise-tags='` + opts.Tag + `' --hostname='` + opts.HostName + `' --accept-routes=false
rm -f "$KEY"
trap - 0 1 2 15
if [ -e "$KEY" ]; then
  echo "fleet-enroll: the enrollment key file is still present after the join" >&2
  exit 1
fi
tailscale status --json
`)
	return b.String(), nil
}
