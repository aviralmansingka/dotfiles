# Packer VM Image Builder

Build QCOW2 VM images with dotfiles and development tools pre-installed for deployment to Hostinger VPS (KVM).

## Prerequisites

- [Packer](https://www.packer.io/) >= 1.9.0
- QEMU (`qemu-system-x86_64`, `qemu-img`)

### macOS Installation

```bash
brew install packer qemu
```

**Note**: macOS uses HVF (Hypervisor.framework) for acceleration. This is the default.

### Ubuntu/Debian Installation

```bash
sudo apt-get install packer qemu-system-x86 qemu-utils
```

For KVM acceleration on Linux, ensure your user is in the `kvm` group:
```bash
sudo usermod -aG kvm $USER
# Log out and back in
```

## Quick Start

```bash
cd dotfiles/packer

# Initialize Packer plugins
packer init .

# Validate configuration
packer validate -var-file=ubuntu-22.04.pkrvars.hcl .

# Build image (use kvm on Linux for faster builds)
packer build -var-file=ubuntu-22.04.pkrvars.hcl .

# Linux with KVM (much faster)
packer build -var-file=ubuntu-22.04.pkrvars.hcl -var "accelerator=kvm" .
```

Output: `output/dotfiles-ubuntu-22.04.qcow2`

> **Note**: On Apple Silicon Macs, builds use software emulation (TCG) and take 30-60 minutes. For faster iteration, build on a Linux x86_64 machine with KVM.

## Build Options

### Ubuntu 22.04 LTS (Recommended)

```bash
packer build -var-file=ubuntu-22.04.pkrvars.hcl .
```

### Ubuntu 24.04 LTS

```bash
packer build -var-file=ubuntu-24.04.pkrvars.hcl .
```

### Custom Variables

```bash
packer build \
  -var-file=ubuntu-22.04.pkrvars.hcl \
  -var "disk_size=30G" \
  -var "memory=4096" \
  -var "dotfiles_branch=main" \
  .
```

### Debug Build (Non-headless)

```bash
packer build \
  -var-file=ubuntu-22.04.pkrvars.hcl \
  -var "headless=false" \
  -on-error=abort \
  .
```

## Directory Structure

```
packer/
├── ubuntu.pkr.hcl           # Main Packer configuration
├── variables.pkr.hcl        # Variable definitions
├── ubuntu-22.04.pkrvars.hcl # Ubuntu 22.04 settings
├── ubuntu-24.04.pkrvars.hcl # Ubuntu 24.04 settings
├── config/
│   └── cloud-init/
│       ├── meta-data        # Instance metadata
│       ├── user-data        # Cloud-init config
│       └── network-config   # Network settings (DHCP)
├── scripts/
│   ├── setup-user.sh        # Create non-root user
│   ├── setup-deps.sh        # Install packages
│   ├── setup-dotfiles.sh    # Clone and stow dotfiles
│   └── cleanup.sh           # Minimize image size
└── README.md                # This file
```

## What's Included

### Tools Installed

- **Core**: git, zsh, tmux, stow, neovim
- **Languages**: Go, Python 3, Node.js, Rust/Cargo, Lua
- **CLI Tools**: fd, ripgrep, fzf, eza, lazygit, starship
- **Kubernetes**: kubectl, kubectx/kubens, k9s
- **Other**: uv (Python), zoxide, direnv, yq

### Dotfiles Deployed

- zsh configuration with Oh-My-Zsh
- tmux configuration with TPM plugins
- Neovim/LazyVim with plugins pre-installed
- Starship prompt configuration
- Git configuration

### User Setup

- Username: `aviral`
- Shell: `/bin/zsh` (after first login)
- Sudo: passwordless sudo enabled
- Home: `/home/aviral`

## Deployment to Hostinger VPS

### 1. Build the Image

```bash
cd dotfiles/packer
packer init .
packer build -var-file=ubuntu-22.04.pkrvars.hcl .
```

### 2. Convert Format (if needed)

Hostinger may require RAW format instead of QCOW2:

```bash
qemu-img convert -f qcow2 -O raw \
  output/dotfiles-ubuntu-22.04.qcow2 \
  output/dotfiles-ubuntu-22.04.raw
```

### 3. Upload to Hostinger

1. Log into Hostinger hPanel
2. Navigate to VPS → Operating System → Custom OS/ISO
3. Upload the image file
4. Select it as the OS for your VPS

### 4. First Boot Configuration

```bash
# SSH into the VPS
ssh aviral@<your-vps-ip>

# Add your SSH public key
mkdir -p ~/.ssh
echo "your-public-key" >> ~/.ssh/authorized_keys
chmod 600 ~/.ssh/authorized_keys

# Change to zsh shell
chsh -s $(which zsh)

# Disable password authentication (recommended)
sudo sed -i 's/PasswordAuthentication yes/PasswordAuthentication no/' /etc/ssh/sshd_config
sudo systemctl restart sshd
```

## Testing Locally

### Test with QEMU

```bash
# macOS Apple Silicon (software emulation - slow)
qemu-system-x86_64 \
  -m 2048 \
  -hda output/dotfiles-ubuntu-22.04.qcow2 \
  -nographic \
  -accel tcg

# Linux (KVM acceleration - fast)
qemu-system-x86_64 \
  -m 2048 \
  -hda output/dotfiles-ubuntu-22.04.qcow2 \
  -nographic \
  -enable-kvm

# Login as aviral with password: packer
# (Change password immediately or add SSH key)
```

### Verify Tools

```bash
# After SSH/console login
which zsh tmux nvim git stow starship lazygit
nvim --version
zsh --version
```

## Customization

### Change Dotfiles Repository

```bash
packer build \
  -var-file=ubuntu-22.04.pkrvars.hcl \
  -var "dotfiles_repo=https://github.com/yourusername/dotfiles.git" \
  -var "dotfiles_branch=main" \
  .
```

### Add More Packages

Edit `scripts/setup-deps.sh` to install additional packages.

### Change User

Edit `variables.pkr.hcl` to change the default `ssh_username`, and update `config/cloud-init/user-data` accordingly.

## Troubleshooting

### Accelerator Options

The `accelerator` variable controls QEMU virtualization:

| Platform | Accelerator | Performance | Notes |
|----------|-------------|-------------|-------|
| Linux x86_64 | `kvm` | Fast | Requires `/dev/kvm` access |
| macOS Intel | `hvf` | Fast | Native x86_64 only |
| macOS Apple Silicon | `tcg` | Slow | **Required** - no x86_64 HW accel |
| Any | `tcg` | Slow | Software emulation (default) |

**Important**: On Apple Silicon Macs (M1/M2/M3), you **must** use `tcg` for x86_64 images. HVF only accelerates native ARM VMs.

### Linux: Use KVM for faster builds

```bash
packer build -var-file=ubuntu-22.04.pkrvars.hcl -var "accelerator=kvm" .
```

### Linux: KVM permission denied

```bash
# Add yourself to the kvm group
sudo usermod -aG kvm $USER
# Log out and back in

# Verify KVM access
ls -la /dev/kvm
```

### Build fails with KVM error on CI

GitHub Actions runners don't support KVM. Use TCG:

```bash
packer build -var "accelerator=tcg" -var-file=ubuntu-22.04.pkrvars.hcl .
```

Note: TCG is software emulation and will be significantly slower (expect 30-60 min builds).

### SSH timeout during provisioning

Increase the timeout in `ubuntu.pkr.hcl`:

```hcl
ssh_timeout = "30m"
```

### Cloud-init not completing

Check cloud-init logs in the VM:

```bash
sudo cat /var/log/cloud-init-output.log
sudo cloud-init status --long
```

## CI/CD

The GitHub Actions workflow (`.github/workflows/packer-build.yml`) automatically:

1. Validates configuration on every PR
2. Builds images on push to main or manual trigger
3. Creates releases with compressed images on tags

### Manual Build Trigger

Go to Actions → Packer Build → Run workflow → Select Ubuntu version
