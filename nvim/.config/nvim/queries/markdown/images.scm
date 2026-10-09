; Shadow of snacks.nvim's markdown/images.scm with the `mermaid` pattern
; removed — no `; extends` on purpose, so this file REPLACES the plugin's
; query and ```mermaid fences never reach snacks.image's mmdc/PNG pipeline.
; Mermaid renders as inline ASCII instead (helpers/mermaid_render.lua).
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
