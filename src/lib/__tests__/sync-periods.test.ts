import { describe, it, expect } from "vitest";
import { computeGaps } from "../sync-periods";

describe("computeGaps", () => {
  it("returns the full range when no periods are fetched", () => {
    const gaps = computeGaps("2024-01-01", "2024-01-31", []);
    expect(gaps).toEqual([{ start: "2024-01-01", end: "2024-01-31" }]);
  });

  it("returns empty when the entire range is already fetched", () => {
    const gaps = computeGaps("2024-01-01", "2024-01-31", [
      { period_start: "2024-01-01", period_end: "2024-01-31" },
    ]);
    expect(gaps).toEqual([]);
  });

  it("returns empty when fetched range exceeds desired range", () => {
    const gaps = computeGaps("2024-01-05", "2024-01-20", [
      { period_start: "2024-01-01", period_end: "2024-01-31" },
    ]);
    expect(gaps).toEqual([]);
  });

  it("returns gap at the beginning when fetched starts later", () => {
    const gaps = computeGaps("2024-01-01", "2024-01-31", [
      { period_start: "2024-01-15", period_end: "2024-01-31" },
    ]);
    expect(gaps).toEqual([{ start: "2024-01-01", end: "2024-01-15" }]);
  });

  it("returns gap at the end when fetched ends earlier", () => {
    const gaps = computeGaps("2024-01-01", "2024-01-31", [
      { period_start: "2024-01-01", period_end: "2024-01-15" },
    ]);
    expect(gaps).toEqual([{ start: "2024-01-16", end: "2024-01-31" }]);
  });

  it("returns gap in the middle between two fetched periods", () => {
    const gaps = computeGaps("2024-01-01", "2024-01-31", [
      { period_start: "2024-01-01", period_end: "2024-01-10" },
      { period_start: "2024-01-20", period_end: "2024-01-31" },
    ]);
    expect(gaps).toEqual([{ start: "2024-01-11", end: "2024-01-20" }]);
  });

  it("returns multiple gaps with fetched periods scattered", () => {
    const gaps = computeGaps("2024-01-01", "2024-01-31", [
      { period_start: "2024-01-05", period_end: "2024-01-10" },
      { period_start: "2024-01-20", period_end: "2024-01-25" },
    ]);
    expect(gaps).toHaveLength(3);
    expect(gaps[0]).toEqual({ start: "2024-01-01", end: "2024-01-05" });
    expect(gaps[1]).toEqual({ start: "2024-01-11", end: "2024-01-20" });
    expect(gaps[2]).toEqual({ start: "2024-01-26", end: "2024-01-31" });
  });

  it("merges adjacent fetched periods (no gap between them)", () => {
    const gaps = computeGaps("2024-01-01", "2024-01-31", [
      { period_start: "2024-01-01", period_end: "2024-01-15" },
      { period_start: "2024-01-16", period_end: "2024-01-31" },
    ]);
    expect(gaps).toEqual([]);
  });

  it("merges overlapping fetched periods", () => {
    const gaps = computeGaps("2024-01-01", "2024-01-31", [
      { period_start: "2024-01-01", period_end: "2024-01-20" },
      { period_start: "2024-01-15", period_end: "2024-01-31" },
    ]);
    expect(gaps).toEqual([]);
  });

  it("handles unsorted fetched periods", () => {
    const gaps = computeGaps("2024-01-01", "2024-01-31", [
      { period_start: "2024-01-20", period_end: "2024-01-31" },
      { period_start: "2024-01-01", period_end: "2024-01-10" },
    ]);
    expect(gaps).toEqual([{ start: "2024-01-11", end: "2024-01-20" }]);
  });

  it("handles single-day desired range with no coverage", () => {
    const gaps = computeGaps("2024-06-15", "2024-06-15", []);
    expect(gaps).toEqual([{ start: "2024-06-15", end: "2024-06-15" }]);
  });

  it("handles single-day desired range that is already covered", () => {
    const gaps = computeGaps("2024-06-15", "2024-06-15", [
      { period_start: "2024-06-15", period_end: "2024-06-15" },
    ]);
    expect(gaps).toEqual([]);
  });

  it("handles many small fetched periods with small gaps", () => {
    // Simulates 7-day chunks with 1-day gaps between them
    const periods = [
      { period_start: "2024-01-01", period_end: "2024-01-07" },
      { period_start: "2024-01-09", period_end: "2024-01-15" },
      { period_start: "2024-01-17", period_end: "2024-01-23" },
    ];
    const gaps = computeGaps("2024-01-01", "2024-01-23", periods);
    expect(gaps).toEqual([
      { start: "2024-01-08", end: "2024-01-09" },
      { start: "2024-01-16", end: "2024-01-17" },
    ]);
  });

  it("handles fetched period that starts before desired range", () => {
    const gaps = computeGaps("2024-03-01", "2024-03-31", [
      { period_start: "2024-02-15", period_end: "2024-03-10" },
    ]);
    expect(gaps).toEqual([{ start: "2024-03-11", end: "2024-03-31" }]);
  });

  it("handles fetched period that ends after desired range", () => {
    const gaps = computeGaps("2024-03-01", "2024-03-31", [
      { period_start: "2024-03-20", period_end: "2024-04-15" },
    ]);
    expect(gaps).toEqual([{ start: "2024-03-01", end: "2024-03-20" }]);
  });

  it("handles year boundary correctly", () => {
    const gaps = computeGaps("2023-12-28", "2024-01-05", [
      { period_start: "2023-12-30", period_end: "2024-01-02" },
    ]);
    expect(gaps).toEqual([
      { start: "2023-12-28", end: "2023-12-30" },
      { start: "2024-01-03", end: "2024-01-05" },
    ]);
  });
});
