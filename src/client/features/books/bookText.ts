type TextPosition = { part: number; offset: number };
export type BookNoteTextPart = { text: string; breakBefore?: boolean };
export type BookNoteText = {
  text: string;
  starts: TextPosition[];
  ends: TextPosition[];
};

// Keep source offsets while collapsing EPUB indentation and paragraph boundaries.
// Inline nodes stay adjacent, so a word split by <em> still matches that word.
export function buildBookNoteText(parts: readonly BookNoteTextPart[]): BookNoteText {
  const characters: string[] = [];
  const starts: TextPosition[] = [];
  const ends: TextPosition[] = [];
  const append = (character: string, start: TextPosition, end: TextPosition) => {
    if (/\s/u.test(character)) {
      if (!characters.length) return;
      if (characters[characters.length - 1] === " ") {
        ends[ends.length - 1] = end;
        return;
      }
      character = " ";
    }
    characters.push(character);
    starts.push(start);
    ends.push(end);
  };
  parts.forEach((part, index) => {
    if (part.breakBefore && characters.length) {
      const previousEnd = ends[ends.length - 1]!;
      append(" ", previousEnd, { part: index, offset: 0 });
    }
    for (let offset = 0; offset < part.text.length; offset += 1) {
      append(part.text[offset]!, { part: index, offset }, { part: index, offset: offset + 1 });
    }
  });
  if (characters[characters.length - 1] === " ") {
    characters.pop(); starts.pop(); ends.pop();
  }
  return { text: characters.join(""), starts, ends };
}
