; Shadow of snacks.nvim's markdown/images.scm with the `mermaid` pattern
; removed, so ```mermaid fences never reach snacks.image's mmdc/PNG pipeline.
; Mermaid renders as inline ASCII instead (helpers/mermaid_render.lua).
;
; IMPORTANT: file placement alone does NOT disable the plugin's query —
; snacks' images.scm starts with `; extends`, so nvim merges it into this
; shadow rather than replacing it. helpers/mermaid_render.lua.setup_inline()
; therefore registers this file as an explicit treesitter query
; (vim.treesitter.query.set), which bypasses runtimepath merging entirely.
;
; The `math` pattern is kept unchanged so LaTeX math still renders
; (needs tectonic or pdflatex).

(fenced_code_block
  (info_string (language) @lang)
  (#eq? @lang "math")
  (code_fence_content) @image.content
  (#set! injection.language "latex")
  (#set! image.ext "math.tex")
) @image
