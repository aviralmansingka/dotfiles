# Backlog

This document contains all annoyances I've felt with my current setup.
Instead of burning work hours solving for a poorly aligned symbol or bad
scrolling experience, I want to record all of them here, and tackle them the way
I would solve problems at work.

## Issues

- [ ] Checkbox symbol misaligned
  - The checkbox symbols are not aligned in JetBrains font. Need to figure out why
  - [ ]  <- Example
- [ ] Finding TODOs
  - After the upgrade away from telescope this functionality appears to be broken
- [ ] Slow DAP
  - Switching buffers
- [ ] Snacks picker
  - I want the project picker to not be descending
  - I want to customize how lsp UIs look
    - I want more space for the code to be viewed
- [ ] Lazy border should be rounded

## Configuration

### Collaborating features

- [ ] Do a full PR review in `octo.nvim`

### Language features

- should everything be single file or modular?
  - [!IDEA] will learn about modules in neovim/lua

#### test.lua

- Language support
  - Python, Rust
- UI
  - [ ] `<leader>to` -> I want the output in a centered floating window

#### dap.lua  

- Language support
  - Python, Rust, Golang
- Debug-local keymaps
  - [x] `<localleader>b` -> toggle breakpoint
  - [x] `<localleader>c` -> continue
  - [x] `<localleader>d` -> step over
  - [x] `<localleader>s` -> step into
  - [x] `<localleader>a` -> step out from current function to the call site
    - Maybe need treesitter?
    - Also have stack information
- UI redesign
  - [ ] `<localleader>fo` -> show console output widget
  - [ ] `<localleader>fe` -> open expression widget
  - [ ] `<localleader>fs` -> stack traces widget
    - View them with snacks.picker UI to see context
  - `<localleader>i` I want to be able to hover over a variable and see its value
    - How will I handle large values?
      - Need to be able to interact within the hover
      - Need to be able to search within the hover
      - Something like Yazi?
    - What about functions?
      - Can I invoke them?

### Markdown

- Better task management
  - I want a shortcut to add a journal entry (in addition to journal today)
  - I want to be able to search todos
- Better todos
  - If a line ends with a `-`, and I hit enter, I want it to be a sub-bullet
  - Complete parent item causes child to be complete
- Subtle autocomplete
  - I want darker borders
  - I want it to trigger less often (> 7 characters) (maybe only markdown snippets)
- Fixes
  - [!IDEA] isn't working as expected
    - Is this an error with the emoji? Can I just use something else?

### colorscheme.lua

- Code block vs inline
  - I want `inline` code to be gruvbox orange instead of green

## Features

### Work notes

- As a user, I would like a shortcut to open my modal work notes quickly
- As a user, I would like to have a shortcut to open a git-commit style message
  - When complete, I want it to go to the right section of my weekly summary
    with the timestamp

### Neovide

- There is some issue with the clipboard
- copy-paste
- colors are still weird
