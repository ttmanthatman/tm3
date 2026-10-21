/// <reference types="node" />

import assert from "node:assert/strict";
import test from "node:test";
import { installBookReaderCompatibility, type ObjectGroupBy, type MapGroupBy } from "./compatibility.js";

const object = Object as ObjectConstructor & { groupBy: ObjectGroupBy };
const map = Map as MapConstructor & { groupBy: MapGroupBy };

test("older Android grouping fallbacks accept iterables and preserve keys and item order", () => {
  const objectDescriptor = Object.getOwnPropertyDescriptor(Object, "groupBy")!;
  const mapDescriptor = Object.getOwnPropertyDescriptor(Map, "groupBy")!;
  try {
    Object.defineProperty(Object, "groupBy", { value: undefined, configurable: true, writable: true });
    Object.defineProperty(Map, "groupBy", { value: undefined, configurable: true, writable: true });
    installBookReaderCompatibility();

    const symbol = Symbol("metadata");
    const indexed: number[] = [];
    const groups = object.groupBy(new Set(["__proto__", "constructor", "__proto__2", "symbol"]), (value, index) => {
      indexed.push(index);
      return value === "symbol" ? symbol : value.replace(/2$/, "");
    });
    assert.equal(Object.getPrototypeOf(groups), null);
    assert.deepEqual(groups.__proto__, ["__proto__", "__proto__2"]);
    assert.deepEqual(groups.constructor, ["constructor"]);
    assert.deepEqual(groups[symbol], ["symbol"]);
    assert.deepEqual(indexed, [0, 1, 2, 3]);
    assert.equal(Object.keys(Object).includes("groupBy"), false);

    const author = {}, title = {};
    const entries = [{ key: author, value: "author 1" }, { key: title, value: "title" }, { key: author, value: "author 2" }];
    const grouped = map.groupBy(entries.values(), entry => entry.key);
    assert.deepEqual([...grouped.keys()], [author, title]);
    assert.deepEqual(grouped.get(author), [entries[0], entries[2]]);
    assert.equal(map.groupBy([NaN, NaN], value => value).size, 1);
    assert.deepEqual(object.groupBy([], () => "empty"), Object.create(null));
    assert.deepEqual(map.groupBy([], () => null), new Map());
  } finally {
    Object.defineProperty(Object, "groupBy", objectDescriptor);
    Object.defineProperty(Map, "groupBy", mapDescriptor);
  }
});

test("compatibility preserves available native APIs and can fill either missing API", () => {
  const objectDescriptor = Object.getOwnPropertyDescriptor(Object, "groupBy")!;
  const mapDescriptor = Object.getOwnPropertyDescriptor(Map, "groupBy")!;
  try {
    installBookReaderCompatibility();
    assert.equal(object.groupBy, objectDescriptor.value);
    assert.equal(map.groupBy, mapDescriptor.value);
    Object.defineProperty(Object, "groupBy", { value: undefined, configurable: true, writable: true });
    installBookReaderCompatibility();
    assert.equal(map.groupBy, mapDescriptor.value);
    assert.equal(typeof object.groupBy, "function");
    const fallback = object.groupBy;
    Object.defineProperty(Map, "groupBy", { value: undefined, configurable: true, writable: true });
    installBookReaderCompatibility();
    assert.equal(object.groupBy, fallback);
    assert.equal(typeof map.groupBy, "function");
  } finally {
    Object.defineProperty(Object, "groupBy", objectDescriptor);
    Object.defineProperty(Map, "groupBy", mapDescriptor);
  }
});
