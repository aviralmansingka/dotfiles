package domain

import (
	"fmt"
	"regexp"
	"sort"
	"strings"
)

// SizeSpec is a server-side mapping from a logical size name to concrete
// provider parameters. Clients never supply instance types or disk sizes.
type SizeSpec struct {
	Name         string `json:"name"`
	InstanceType string `json:"instance_type"`
	DiskGB       int    `json:"disk_gb"`
}

// Profile is an approved host profile from config/profiles.yaml. It maps a
// logical profile name to a provider, allowed regions, allowed sizes, tags, and
// approved secret-bundle references. It holds references only, never values.
type Profile struct {
	Name          string              `json:"name"`
	DisplayName   string              `json:"display_name"`
	Provider      Provider            `json:"provider"`
	Regions       []string            `json:"regions"`
	Sizes         map[string]SizeSpec `json:"sizes"`
	Tags          map[string]string   `json:"tags"`
	SecretBundles []string            `json:"secret_bundles"`
	// FlakeRef is the approved flake target for this profile. It is resolved
	// server-side; clients cannot supply or override it.
	FlakeRef string `json:"flake_ref"`
}

var (
	profileNamePattern = regexp.MustCompile(`^[a-z][a-z0-9-]{0,31}$`)
	regionPattern      = regexp.MustCompile(`^[a-z]{2}(-[a-z]+)+-[0-9]$`)
	// flakeRefPattern is an allow-list for approved flake targets, not the
	// host-name deny-list. A real target looks like
	// `.#homeConfigurations.remote-mumbai.activationPackage`,
	// `github:owner/repo#host`, or `path:./nix#host`: letters, digits, `.`, `-`,
	// `_`, `~`, `:`, `/`, the URL-scheme characters `+ @ ? =`, and at most one `#`
	// attribute-path separator. It must start with a letter, digit, or `.` (so it
	// can never look like a CLI flag). Whitespace, newlines, `;` `$` backticks,
	// `|`, `&`, quotes, globs, and redirection cannot match the class at all, so
	// they fail by construction.
	flakeRefPattern = regexp.MustCompile(`^[A-Za-z0-9.][A-Za-z0-9._~:/@?=+-]*(#[A-Za-z0-9._+-]+(\.[A-Za-z0-9._+-]+)*)?$`)
)

// ValidateProfile rejects malformed profile definitions at configuration load
// time, so a profile cannot be half-approved at request time.
func ValidateProfile(p Profile) error {
	if !profileNamePattern.MatchString(p.Name) {
		return fmt.Errorf("profile %q: name must match %s", p.Name, profileNamePattern)
	}
	if p.Provider != ProviderAWS {
		return fmt.Errorf("profile %q: unsupported provider %q", p.Name, p.Provider)
	}
	if len(p.Regions) == 0 {
		return fmt.Errorf("profile %q: at least one region is required", p.Name)
	}
	for _, r := range p.Regions {
		if !regionPattern.MatchString(r) {
			return fmt.Errorf("profile %q: invalid region %q", p.Name, r)
		}
	}
	if len(p.Sizes) == 0 {
		return fmt.Errorf("profile %q: at least one size is required", p.Name)
	}
	for name, size := range p.Sizes {
		if size.Name == "" {
			size.Name = name
		}
		if !profileNamePattern.MatchString(name) {
			return fmt.Errorf("profile %q: invalid size name %q", p.Name, name)
		}
		if strings.TrimSpace(size.InstanceType) == "" || size.DiskGB <= 0 {
			return fmt.Errorf("profile %q: size %q needs instance_type and positive disk_gb", p.Name, name)
		}
		if strings.ContainsAny(size.InstanceType, hostNameForbidden) {
			return fmt.Errorf("profile %q: size %q has an unsafe instance type", p.Name, name)
		}
	}
	for k := range p.Tags {
		if strings.TrimSpace(k) == "" || strings.ContainsAny(k, hostNameForbidden) {
			return fmt.Errorf("profile %q: unsafe tag key %q", p.Name, k)
		}
	}
	for _, bundle := range p.SecretBundles {
		if strings.TrimSpace(bundle) == "" {
			return fmt.Errorf("profile %q: empty secret bundle reference", p.Name)
		}
	}
	if err := validateFlakeRef(p.FlakeRef); err != nil {
		return fmt.Errorf("profile %q: %w", p.Name, err)
	}
	return nil
}

// validateFlakeRef accepts only allow-listed flake targets. hostNameForbidden is
// deliberately not consulted here: it bans `#`, `:`, and `/`, which every
// realistic flake reference contains. The allow-list keeps the guarantee the
// deny-list was reaching for (no shell metacharacters, no whitespace, no
// traversal) without rejecting the configuration an operator must ship.
func validateFlakeRef(ref string) error {
	if strings.TrimSpace(ref) == "" {
		return fmt.Errorf("flake_ref is required")
	}
	if strings.Contains(ref, "..") {
		return fmt.Errorf("unsafe flake_ref %q: path segments must not contain \"..\"", ref)
	}
	if !flakeRefPattern.MatchString(ref) {
		return fmt.Errorf("unsafe flake_ref %q: must be a flake target of [A-Za-z0-9._~:/@?=+#-] with at most one #", ref)
	}
	return nil
}

// Catalog is the immutable set of approved profiles.
type Catalog struct {
	profiles map[string]Profile
}

// NewCatalog validates and indexes approved profiles.
func NewCatalog(profiles []Profile) (Catalog, error) {
	if len(profiles) == 0 {
		return Catalog{}, fmt.Errorf("no approved host profiles configured")
	}
	byName := make(map[string]Profile, len(profiles))
	for _, p := range profiles {
		p = normalizeProfile(p)
		if err := ValidateProfile(p); err != nil {
			return Catalog{}, err
		}
		if _, dup := byName[p.Name]; dup {
			return Catalog{}, fmt.Errorf("duplicate host profile %q", p.Name)
		}
		byName[p.Name] = p
	}
	return Catalog{profiles: byName}, nil
}

// Profile returns the approved profile with this name. The provider adapters
// use it to resolve a size key server-side, so a request cannot name a shape
// the catalog does not approve.
func (c Catalog) Profile(name string) (Profile, bool) {
	profile, ok := c.profiles[name]
	return profile, ok
}

// Profiles returns the approved profiles sorted by name.
func (c Catalog) Profiles() []Profile {
	out := make([]Profile, 0, len(c.profiles))
	for _, p := range c.profiles {
		out = append(out, p)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Name < out[j].Name })
	return out
}

// ResolvedHostSpec is the fully server-side-resolved request. It is the only
// thing the application layer hands to Temporal, and it contains no secrets.
type ResolvedHostSpec struct {
	Name          string
	Provider      Provider
	Profile       string
	Region        string
	Size          string
	InstanceType  string
	DiskGB        int
	Tags          map[string]string
	SecretBundles []string
	FlakeRef      string
}

// Resolve validates a client request against the approved catalog and applies
// the profile's size, tag, and secret mappings. Everything a provider needs is
// derived here; the client only chose name, profile, region, and size.
func (c Catalog) Resolve(req CreateHostRequest) (ResolvedHostSpec, error) {
	if err := ValidateHostName(req.Name); err != nil {
		return ResolvedHostSpec{}, err
	}
	provider, err := ValidateProvider(req.Provider)
	if err != nil {
		return ResolvedHostSpec{}, err
	}
	if req.Profile == "" {
		return ResolvedHostSpec{}, Invalid("profile", "is required")
	}
	profile, ok := c.profiles[req.Profile]
	if !ok {
		return ResolvedHostSpec{}, Invalid("profile", fmt.Sprintf("%q is not an approved profile", req.Profile))
	}
	if profile.Provider != provider {
		return ResolvedHostSpec{}, Invalid("provider", fmt.Sprintf("profile %q is not available on provider %q", profile.Name, provider))
	}
	if req.Region == "" {
		return ResolvedHostSpec{}, Invalid("region", "is required")
	}
	if !containsString(profile.Regions, req.Region) {
		return ResolvedHostSpec{}, Invalid("region", fmt.Sprintf("%q is not an approved region for profile %q", req.Region, profile.Name))
	}
	sizeName := req.Size
	if sizeName == "" {
		return ResolvedHostSpec{}, Invalid("size", "is required")
	}
	size, ok := profile.Sizes[sizeName]
	if !ok {
		return ResolvedHostSpec{}, Invalid("size", fmt.Sprintf("%q is not an approved size for profile %q", sizeName, profile.Name))
	}
	tags := cloneStringMap(profile.Tags)
	tags["Name"] = req.Name
	tags["fleet-managed"] = "true"
	tags["fleet-profile"] = profile.Name
	return ResolvedHostSpec{
		Name:          req.Name,
		Provider:      provider,
		Profile:       profile.Name,
		Region:        req.Region,
		Size:          sizeName,
		InstanceType:  size.InstanceType,
		DiskGB:        size.DiskGB,
		Tags:          tags,
		SecretBundles: append([]string(nil), profile.SecretBundles...),
		FlakeRef:      profile.FlakeRef,
	}, nil
}

func normalizeProfile(p Profile) Profile {
	if p.Tags == nil {
		p.Tags = map[string]string{}
	}
	sizes := make(map[string]SizeSpec, len(p.Sizes))
	for name, size := range p.Sizes {
		if size.Name == "" {
			size.Name = name
		}
		sizes[name] = size
	}
	p.Sizes = sizes
	return p
}

func containsString(values []string, want string) bool {
	for _, v := range values {
		if v == want {
			return true
		}
	}
	return false
}

func cloneStringMap(in map[string]string) map[string]string {
	if in == nil {
		return nil
	}
	out := make(map[string]string, len(in))
	for k, v := range in {
		out[k] = v
	}
	return out
}
