// Foliate's EPUB metadata parser needs ES2024 grouping APIs, which older
// Android browsers and WebViews do not provide. Install before parser imports.
export type ObjectGroupBy = <T, K extends PropertyKey>(items: Iterable<T>, callback: (item: T, index: number) => K) => Partial<Record<K, T[]>>;
export type MapGroupBy = <T, K>(items: Iterable<T>, callback: (item: T, index: number) => K) => Map<K, T[]>;

function objectGroupBy<T, K extends PropertyKey>(items: Iterable<T>, callback: (item: T, index: number) => K): Partial<Record<K, T[]>> {
  if (typeof callback !== "function") throw new TypeError("groupBy callback must be a function");
  const groups = Object.create(null) as Partial<Record<K, T[]>>;
  let index = 0;
  for (const item of items) {
    const key = callback(item, index++);
    (groups[key] ??= []).push(item);
  }
  return groups;
}

function mapGroupBy<T, K>(items: Iterable<T>, callback: (item: T, index: number) => K): Map<K, T[]> {
  if (typeof callback !== "function") throw new TypeError("groupBy callback must be a function");
  const groups = new Map<K, T[]>();
  let index = 0;
  for (const item of items) {
    const key = callback(item, index++);
    const group = groups.get(key);
    if (group) group.push(item);
    else groups.set(key, [item]);
  }
  return groups;
}

export function installBookReaderCompatibility(): void {
  if (typeof (Object as ObjectConstructor & { groupBy?: ObjectGroupBy }).groupBy !== "function") {
    Object.defineProperty(Object, "groupBy", { value: objectGroupBy, writable: true, configurable: true });
  }
  if (typeof (Map as MapConstructor & { groupBy?: MapGroupBy }).groupBy !== "function") {
    Object.defineProperty(Map, "groupBy", { value: mapGroupBy, writable: true, configurable: true });
  }
}

installBookReaderCompatibility();
