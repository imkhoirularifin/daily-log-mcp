import { describe, expect, it } from "vitest";
import {
  mapWorkload,
  parseDifficulty,
  parseDisplayDate,
  parseProgress,
  parseStatus,
  toDisplayDate,
  ValidationError,
} from "../src/validation.js";

describe("date parsing", () => {
  it("parses DD/MM/YYYY to ISO", () => {
    expect(parseDisplayDate("17/09/2026")).toBe("2026-09-17");
    expect(parseDisplayDate("23/10/2026")).toBe("2026-10-23");
    expect(parseDisplayDate("01/01/2027")).toBe("2027-01-01");
  });

  it("rejects dates before 17/09/2026", () => {
    expect(() => parseDisplayDate("16/09/2026")).toThrow(ValidationError);
    expect(() => parseDisplayDate("01/01/2025")).toThrow(/17\/09\/2026/);
  });

  it("rejects invalid formats and calendars", () => {
    expect(() => parseDisplayDate("2026-09-17")).toThrow(ValidationError);
    expect(() => parseDisplayDate("31/02/2027")).toThrow(ValidationError);
    expect(() => parseDisplayDate("")).toThrow(ValidationError);
  });

  it("round-trips ISO ↔ display", () => {
    expect(toDisplayDate("2026-09-17")).toBe("17/09/2026");
    expect(parseDisplayDate(toDisplayDate("2026-12-31"))).toBe("2026-12-31");
  });
});

describe("workload mapping", () => {
  it("maps difficulty to 1..5 in order", () => {
    expect(mapWorkload("Sangat Mudah")).toBe(1);
    expect(mapWorkload("Mudah")).toBe(2);
    expect(mapWorkload("Sedang")).toBe(3);
    expect(mapWorkload("Sulit")).toBe(4);
    expect(mapWorkload("Sangat Sulit")).toBe(5);
  });

  it("rejects unknown difficulty", () => {
    expect(() => parseDifficulty("Easy")).toThrow(ValidationError);
  });
});

describe("progress and status", () => {
  it("defaults and validates progress", () => {
    expect(parseProgress(undefined)).toBe(100);
    expect(parseProgress(0)).toBe(0);
    expect(() => parseProgress(101)).toThrow(ValidationError);
    expect(() => parseProgress(1.5)).toThrow(ValidationError);
  });

  it("defaults and validates status", () => {
    expect(parseStatus(undefined)).toBe("Done");
    expect(parseStatus("Review")).toBe("Review");
    expect(() => parseStatus("Finished")).toThrow(ValidationError);
  });
});
