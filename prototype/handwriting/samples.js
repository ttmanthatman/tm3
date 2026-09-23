// Deterministic synthetic strokes for capacity and playback checks; these are not handwriting samples.
export function makeSample(count) {
  const glyphs = [
    [[[1800, 2400], [8000, 2400]], [[4800, 900], [4800, 8600]], [[4800, 4600], [1900, 8200]], [[4900, 4600], [8100, 8300]]],
    [[[2100, 2300], [7700, 2300]], [[5000, 1500], [5000, 8500]], [[1700, 6000], [8300, 6000]]],
  ];
  return {
    kind: "handwriting",
    version: 1,
    characters: Array.from({ length: count }, (_, index) => ({
      strokes: glyphs[index % 2].map((line, strokeIndex) => ({
        points: line.map(([x, y], pointIndex) => [x, y, strokeIndex * 380 + pointIndex * 95]),
      })),
    })),
  };
}
