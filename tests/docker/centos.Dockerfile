FROM quay.io/centos/centos:stream9

# Enable EPEL and additional repositories
RUN dnf install -y epel-release && \
    dnf config-manager --set-enabled crb && \
    dnf update -y

# Install core dependencies
RUN dnf install -y --allowerasing \
    git \
    curl \
    wget \
    zsh \
    tmux \
    gcc \
    gcc-c++ \
    make \
    stow \
    tree \
    python3 \
    python3-pip \
    golang \
    nodejs \
    npm \
    && dnf clean all

# Install packages that are available in EPEL/repos
RUN dnf install -y ripgrep || echo "ripgrep not available via dnf"

# Install neovim (prefer package manager version)
RUN dnf install -y neovim || \
    (curl -LO https://github.com/neovim/neovim/releases/download/stable/nvim-linux64.tar.gz && \
     tar xf nvim-linux64.tar.gz && \
     cp nvim-linux64/bin/nvim /usr/local/bin/ && \
     mkdir -p /usr/local/share && \
     cp -r nvim-linux64/share/* /usr/local/share/ && \
     rm -rf nvim-linux64*)

# Install fzf via git (as fallback)
RUN git clone --depth 1 https://github.com/junegunn/fzf.git ~/.fzf && \
    ~/.fzf/install --bin && \
    cp ~/.fzf/bin/fzf /usr/local/bin/

# Create simple fd alternative (for basic functionality)
RUN printf '#!/bin/bash\nfind "$@" 2>/dev/null' > /usr/local/bin/fd && chmod +x /usr/local/bin/fd

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

CMD ["/bin/zsh"]