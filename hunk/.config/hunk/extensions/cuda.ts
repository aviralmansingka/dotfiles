import type { HunkExtensionAPI } from "hunkdiff/extension";

export default function (hunk: HunkExtensionAPI) {
  // ponytail: reuse bundled C++ highlighting until Hunk ships a CUDA grammar.
  hunk.registerFileLanguage(".cu", "cpp");
  hunk.registerFileLanguage(".cuh", "cpp");
}
