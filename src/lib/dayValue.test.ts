import { describe, expect, it } from "vitest";
import { dayValue, parseHour } from "./dayValue";

describe("day value from in/out time (same rules as the database)", () => {
  it.each([
    ["9", "6", 1], ["6", "6", 1.5], ["9", "1", 0.5], ["6", "2", 1], ["8", "8", 1.5],
    ["9.30", "6", 1], ["9:30", "1:30", 0.5], ["9am", "9pm", 1.5], ["10am", "11am", 0], ["21", "23", 0],
  ])("in %s out %s = %s", (i, o, v) => expect(dayValue(i, o)).toBe(v));
  it("reads 9.30 as half past nine", () => expect(parseHour("9.30", false)).toBe(9.5));
  it("out-time without am/pm is afternoon", () => expect(parseHour("6", true)).toBe(18));
});
