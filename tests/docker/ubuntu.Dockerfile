FROM ubuntu:22.04

# Metadata
LABEL org.opencontainers.image.title="Dotfiles Ubuntu Development Environment"
LABEL org.opencontainers.image.description="Ubuntu 22.04 with complete development toolchain for dotfiles management"
LABEL org.opencontainers.image.vendor="Aviral Mansingka"
LABEL org.opencontainers.image.licenses="MIT"
LABEL org.opencontainers.image.source="https://github.com/aviralmansingka/dotfiles"
LABEL dev.dotfiles.platform="ubuntu"
LABEL dev.dotfiles.base="ubuntu:22.04"

# Avoid interactive prompts during package installation
ENV DEBIAN_FRONTEND=noninteractive

# Install dependencies (generated from dependencies.yml)
RUN apt-get update && apt-get install -y \
    build-essential \
    curl \
    exa \
    fd-find \
    fzf \
    git \
    glow \
    golang-go \
    lazygit \
    luarocks \
    make \
    neovim \
    nodejs \
    npm \
    protobuf-compiler \
    python3 \
    python3-pip \
    ripgrep \
    rust-all \
    stow \
    tig \
    tmux \
    tmuxinator \
    tree \
    wget \
    zsh \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# Install act (GitHub Actions local runner)
RUN curl -s https://raw.githubusercontent.com/nektos/act/master/install.sh | bash && \
    mv bin/act /usr/local/bin/

# Create development user
RUN useradd -m -s /bin/zsh testuser && \
    echo "testuser:testuser" | chpasswd && \
    usermod -aG sudo testuser

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
RUN echo 'echo "🚀 Welcome to the Dotfiles Development Environment!"' >> ~/.zshrc && \
    echo 'echo "📁 Mount your dotfiles to /home/testuser/dotfiles to get started"' >> ~/.zshrc && \
    echo 'echo "🛠️  Available tools: git, zsh, tmux, neovim, stow, act, and more"' >> ~/.zshrc

# Expose common development ports
EXPOSE 3000 8000 8080

CMD ["/bin/zsh"]