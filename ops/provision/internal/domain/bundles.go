package domain

import (
	"fmt"
	"regexp"
	"sort"
	"strings"
)

// SecretBundleHostPlaceholder is the single placeholder an approved bundle
// template may contain. The provisioning service replaces it with the host
// identity, so the shipped profile names one mapping and every host derives its
// own path from it.
const SecretBundleHostPlaceholder = "{host}"

// bundleHostPathPrefix is the only KV namespace a bundle template may point into:
// the per-host tree. A template that names anything else is refused at
// configuration load time, not at request time.
const bundleHostPathPrefix = "bao:" + HostKVPathPrefix + SecretBundleHostPlaceholder + "/"

// bundleNamePattern bounds a bundle name. It is a label, never a path.
var bundleNamePattern = regexp.MustCompile(`^[a-z][a-z0-9-]{0,31}$`)

// SecretBundles is the approved per-host bundle mapping from config/profiles.yaml:
// a bundle name to a KV path template such as
// `bao:secret/data/hosts/{host}/canary`. It holds references only; no value has a
// place here, and a shared literal path is refused because the host component is
// the placeholder.
type SecretBundles map[string]string

// validateSecretBundleTemplate enforces the per-host shape of one bundle. The
// rules are deliberately narrow: one placeholder, in the host position, under the
// hosts tree, with a non-empty tail of safe characters.
func validateSecretBundleTemplate(name, template string) error {
	if !bundleNamePattern.MatchString(name) {
		return fmt.Errorf("secret bundle name %q must match %s", name, bundleNamePattern)
	}
	if strings.TrimSpace(template) == "" {
		return fmt.Errorf("secret bundle %q has an empty path template", name)
	}
	if strings.Count(template, SecretBundleHostPlaceholder) != 1 {
		return fmt.Errorf("secret bundle %q must contain exactly one %s placeholder, so every host gets its own path",
			name, SecretBundleHostPlaceholder)
	}
	if !strings.HasPrefix(template, bundleHostPathPrefix) {
		return fmt.Errorf("secret bundle %q must be a per-host path starting with %q, not a shared path",
			name, bundleHostPathPrefix)
	}
	tail := strings.TrimPrefix(template, bundleHostPathPrefix)
	if strings.TrimSpace(tail) == "" {
		return fmt.Errorf("secret bundle %q needs a path below the host directory", name)
	}
	if strings.Contains(tail, "..") {
		return fmt.Errorf("secret bundle %q must not contain path traversal", name)
	}
	if strings.Contains(tail, SecretBundleHostPlaceholder) {
		return fmt.Errorf("secret bundle %q must name the placeholder once, in the host position", name)
	}
	rendered := strings.ReplaceAll(template, SecretBundleHostPlaceholder, "host-0000")
	if err := ValidateSecretRef(rendered); err != nil {
		return fmt.Errorf("secret bundle %q: %w", name, err)
	}
	return nil
}

// Render returns the concrete references for one host identity, sorted by bundle
// name. Two hosts always render different references: the placeholder occupies
// the host segment, which no profile can move.
func (b SecretBundles) Render(hostID string) ([]string, error) {
	if err := ValidateHostID(hostID); err != nil {
		return nil, err
	}
	names := make([]string, 0, len(b))
	for name := range b {
		names = append(names, name)
	}
	sort.Strings(names)
	out := make([]string, 0, len(names))
	for _, name := range names {
		template := b[name]
		if err := validateSecretBundleTemplate(name, template); err != nil {
			return nil, err
		}
		ref := strings.ReplaceAll(template, SecretBundleHostPlaceholder, hostID)
		if err := ValidateSecretRef(ref); err != nil {
			return nil, err
		}
		out = append(out, ref)
	}
	return out, nil
}

// clone copies the mapping so a caller cannot mutate the catalog's copy.
func (b SecretBundles) clone() SecretBundles {
	if b == nil {
		return nil
	}
	out := make(SecretBundles, len(b))
	for name, template := range b {
		out[name] = template
	}
	return out
}
