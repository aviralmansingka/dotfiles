FROM alpine:latest

# Install dependencies
RUN apk update && apk add --no-cache \
    git \
    curl \
    wget \
    zsh \
    tmux \
    neovim \
    stow \
    gcc \
    musl-dev \
    make \
    fd \
    ripgrep \
    fzf \
    tree \
    python3 \
    py3-pip \
    go \
    nodejs \
    npm \
    bash

# Install act (GitHub Actions local runner)
RUN curl -s https://raw.githubusercontent.com/nektos/act/master/install.sh | sh && \
    mv bin/act /usr/local/bin/

# Create test user
RUN adduser -D -s /bin/zsh testuser
USER testuser
WORKDIR /home/testuser

# Create dotfiles directory
RUN mkdir -p /home/testuser/dotfiles

# Set default shell to zsh
ENV SHELL=/bin/zsh

CMD ["/bin/zsh"]