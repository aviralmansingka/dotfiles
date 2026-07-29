# PROTOTYPE — promote Atlas into the main Sidekick preview

Question: when the selected agent is correlated to an official Task Run, does pressing `<C-w>` to replace the main preview with the interactive `atlas observe --id <run>` terminal—and focusing it—feel better than toggling between the Workspaces and Agents selectors?

Run:

```sh
SIDEKICK_ATLAS_FOCUS_PROTOTYPE=1 nvim
```

Then open the Sidekick agent picker, hover a registered Task Run participant, wait for the bottom-right Atlas preview to appear, and press `<C-w>`.

Expected prototype behavior:

- Matched Task participant: `<C-w>` promotes interactive Atlas into the main preview and focuses it.
- Quit Atlas with `q`: the ordinary preview and picker input return for the same selected agent.
- Unmatched/non-Task participant: `<C-w>` keeps the existing Workspaces/Agents toggle.
- The bottom-right Atlas preview is never focused.

This is disposable interaction evidence, not production code.
