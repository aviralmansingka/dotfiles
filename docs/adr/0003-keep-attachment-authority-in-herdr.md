---
status: accepted
---

# Keep attachment authority in Herdr

Herdr owns Agent Session identity, lifecycle, transcript storage, and attachment arbitration. Pi or Codex owns
conversation and model state, and the Agent TUI owns live rendering. An Attachment Lease alone grants live-input and
interactive-mouse authority. Surface Attachments own surface-native history, search, selection, clipboard, opening,
paste, and routing mechanics. A second Surface Attachment is an Observer unless it becomes the explicit Lease Holder.

This keeps one durable Agent Session independent of its views and replaces surface-defined takeover policy with one
canonical authority boundary. It deliberately rejects making Sidekick a session authority or cloning terminal
interaction mechanics inside Neovim.
