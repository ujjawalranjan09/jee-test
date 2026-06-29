import { describe, it, expect, beforeEach } from "vitest";
import { getJson, setJson, remove } from "../utils/storage";

describe("storage utils", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  describe("getJson", () => {
    it("returns fallback when key missing", () => {
      expect(getJson("missing", 42)).toBe(42);
    });

    it("returns parsed JSON when key exists", () => {
      localStorage.setItem("test", JSON.stringify({ a: 1 }));
      expect(getJson("test", {})).toEqual({ a: 1 });
    });

    it("returns fallback on invalid JSON", () => {
      localStorage.setItem("bad", "not-json{{{");
      expect(getJson("bad", [])).toEqual([]);
    });
  });

  describe("setJson", () => {
    it("stores JSON stringified value", () => {
      setJson("key", [1, 2, 3]);
      expect(localStorage.getItem("key")).toBe("[1,2,3]");
    });

    it("handles nested objects", () => {
      setJson("nested", { a: { b: "c" } });
      expect(JSON.parse(localStorage.getItem("nested")!)).toEqual({ a: { b: "c" } });
    });
  });

  describe("remove", () => {
    it("removes a key", () => {
      setJson("toRemove", true);
      remove("toRemove");
      expect(localStorage.getItem("toRemove")).toBeNull();
    });
  });
});
