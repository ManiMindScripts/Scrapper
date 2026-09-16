import test from "node:test";
import assert from "node:assert/strict";
import { parseSalary } from "../parsers/salary.parser.js";

test("SalaryParser — ranges, currencies, and multipliers", async (t) => {
  await t.test("parses '$140,000 - $180,000'", () => {
    const res = parseSalary("$140,000 - $180,000");
    assert.deepEqual(res, {
      min: 140000,
      max: 180000,
      currency: "USD",
    });
  });

  await t.test("parses '$120k - $160k'", () => {
    const res = parseSalary("$120k - $160k");
    assert.deepEqual(res, {
      min: 120000,
      max: 160000,
      currency: "USD",
    });
  });

  await t.test("parses '€80,000 - €100,000'", () => {
    const res = parseSalary("€80,000 - €100,000");
    assert.deepEqual(res, {
      min: 80000,
      max: 100000,
      currency: "EUR",
    });
  });

  await t.test("parses '£65k - £85k / year'", () => {
    const res = parseSalary("£65k - £85k / year");
    assert.deepEqual(res, {
      min: 65000,
      max: 85000,
      currency: "GBP",
    });
  });

  await t.test("parses single value '$150,000'", () => {
    const res = parseSalary("$150,000");
    assert.deepEqual(res, {
      min: 150000,
      max: 150000,
      currency: "USD",
    });
  });

  await t.test("handles null or empty input", () => {
    assert.deepEqual(parseSalary(null), { min: null, max: null, currency: null });
    assert.deepEqual(parseSalary(""), { min: null, max: null, currency: null });
    assert.deepEqual(parseSalary("Competitive compensation"), { min: null, max: null, currency: null });
  });
});
