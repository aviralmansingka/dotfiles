FROM ubuntu:22.04

# Avoid interactive prompts during package installation
ENV DEBIAN_FRONTEND=noninteractive

# Update package list and install dependencies
RUN apt-get update && apt-get install -y \
    git \
    curl \
    wget \
    zsh \
    tmux \
    neovim \
    stow \
    build-essential \
    fd-find \
    ripgrep \
    fzf \
    tree \
    python3 \
    python3-pip \
    golang-go \
    nodejs \
    npm \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# Install act (GitHub Actions local runner)
RUN curl -s https://raw.githubusercontent.com/nektos/act/master/install.sh | bash && \
    mv bin/act /usr/local/bin/

# Create test user
RUN useradd -m -s /bin/zsh testuser
USER testuser
WORKDIR /home/testuser

# Create dotfiles directory
RUN mkdir -p /home/testuser/dotfiles

# Set default shell to zsh
ENV SHELL=/bin/zsh

# Copy dotfiles (this will be done at build time)
# COPY --chown=testuser:testuser . /home/testuser/dotfiles/

CMD ["/bin/zsh"]