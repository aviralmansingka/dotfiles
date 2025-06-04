FROM alpine:latest

# Metadata
LABEL org.opencontainers.image.title="Dotfiles Alpine Development Environment"
LABEL org.opencontainers.image.description="Alpine Linux with lightweight development toolchain for dotfiles management"
LABEL org.opencontainers.image.vendor="Aviral Mansingka"
LABEL org.opencontainers.image.licenses="MIT"
LABEL org.opencontainers.image.source="https://github.com/aviralmansingka/dotfiles"
LABEL dev.dotfiles.platform="alpine"
LABEL dev.dotfiles.base="alpine:latest"

# Install dependencies (generated from dependencies.yml)
RUN apk update && apk add --no-cache \
    bash \
    curl \
    fd \
    fzf \
    gcc \
    git \
    go \
    lazygit \
    make \
    musl-dev \
    neovim \
    nodejs \
    npm \
    py3-pip \
    python3 \
    ripgrep \
    rust \
    stow \
    tmux \
    tree \
    wget \
    zsh

# Install act (GitHub Actions local runner)
RUN curl -s https://raw.githubusercontent.com/nektos/act/master/install.sh | sh && \
    mv bin/act /usr/local/bin/

# Install sudo for development user
RUN apk add --no-cache sudo

# Create development user  
RUN adduser -D -s /bin/zsh testuser && \
    echo "testuser:testuser" | chpasswd && \
    adduser testuser wheel && \
    echo '%wheel ALL=(ALL) NOPASSWD: ALL' >> /etc/sudoers

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
RUN echo 'echo "🚀 Welcome to the Dotfiles Alpine Development Environment!"' >> ~/.zshrc && \
    echo 'echo "📁 Mount your dotfiles to /home/testuser/dotfiles to get started"' >> ~/.zshrc && \
    echo 'echo "🛠️  Available tools: git, zsh, tmux, neovim, stow, act, and more"' >> ~/.zshrc

# Expose common development ports
EXPOSE 3000 8000 8080

CMD ["/bin/zsh"]