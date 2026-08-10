// Identity-keyed memoization for pure message-derived computations (markdown
// rendering, DOM segment parsing, waveform resampling). Store updates replace
// message objects wholesale, so results keyed on object identity never go
// stale, and garbage collection handles eviction on its own.
export function memoizeMessage<T extends object, R>(compute: (input: T) => R): (input: T) => R {
  const cache = new WeakMap<T, R>();
  return (input: T): R => {
    if (cache.has(input)) return cache.get(input) as R;
    const value = compute(input);
    cache.set(input, value);
    return value;
  };
}
