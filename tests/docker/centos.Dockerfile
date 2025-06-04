FROM quay.io/centos/centos:stream9

# Metadata
LABEL org.opencontainers.image.title="Dotfiles CentOS Development Environment"
LABEL org.opencontainers.image.description="CentOS Stream 9 with complete development toolchain for dotfiles management"
LABEL org.opencontainers.image.vendor="Aviral Mansingka"
LABEL org.opencontainers.image.licenses="MIT"
LABEL org.opencontainers.image.source="https://github.com/aviralmansingka/dotfiles"
LABEL dev.dotfiles.platform="centos"
LABEL dev.dotfiles.base="quay.io/centos/centos:stream9"

# Enable EPEL and additional repositories (generated from dependencies.yml)
RUN dnf install -y epel-release && \
    dnf config-manager --set-enabled crb && \
    dnf update -y

# Install dependencies (generated from dependencies.yml)
RUN dnf install -y --allowerasing \
    awscli \
    curl \
    gcc \
    gcc-c++ \
    git \
    golang \
    lazygit \
    make \
    neovim \
    nodejs \
    npm \
    python3 \
    python3-pip \
    ripgrep \
    rust \
    stow \
    tig \
    tmux \
    tree \
    wget \
    zsh \
    && dnf clean all

# Install packages that are available in EPEL/repos
RUN dnf install -y ripgrep || echo "ripgrep not available via dnf"

# Install fzf via git (as fallback)
RUN git clone --depth 1 https://github.com/junegunn/fzf.git ~/.fzf && \
    ~/.fzf/install --bin && \
    cp ~/.fzf/bin/fzf /usr/local/bin/

# Create simple fd alternative (for basic functionality)
RUN printf '#!/bin/bash\nfind "$@" 2>/dev/null' > /usr/local/bin/fd && chmod +x /usr/local/bin/fd

# Install act (GitHub Actions local runner)
RUN curl -s https://raw.githubusercontent.com/nektos/act/master/install.sh | bash && \
    mv bin/act /usr/local/bin/

# Install sudo for development user
RUN dnf install -y sudo && dnf clean all

# Create development user
RUN useradd -m -s /bin/zsh testuser && \
    echo "testuser:testuser" | chpasswd && \
    usermod -aG wheel testuser

# Switch to user and setup environment
USER testuser
WORKDIR /home/testuser

# Create dotfiles directory and set up basic environment
RUN mkdir -p /home/testuser/dotfiles && \
    mkdir -p /home/testuser/.config

# Set environment variables
ENV SHELL=/bin/zsh
ENV USER=testuser
ENV HOME=/home/testuser

# Add a welcome message
RUN echo 'echo "🚀 Welcome to the Dotfiles CentOS Development Environment!"' >> ~/.zshrc && \
    echo 'echo "📁 Mount your dotfiles to /home/testuser/dotfiles to get started"' >> ~/.zshrc && \
    echo 'echo "🛠️  Available tools: git, zsh, tmux, neovim, stow, act, and more"' >> ~/.zshrc

# Expose common development ports
EXPOSE 3000 8000 8080

CMD ["/bin/zsh"]