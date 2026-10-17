import * as CFI from "foliate-js/epubcfi.js";

/** Reuse Foliate's source-tree addresses, without wrapping or splitting text nodes. */
export function bookRangeCfi(base: string | undefined, range: Range): string | undefined {
  return base ? CFI.joinIndir(base, CFI.fromRange(range)) : undefined;
}
