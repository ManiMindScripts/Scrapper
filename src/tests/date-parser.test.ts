import test from "node:test";
import assert from "node:assert/strict";
import { parsePostedDate } from "../parsers/date.parser.js";

test("DateParser — relative and absolute date parsing", async (t) => {
  const ref = new Date("2026-09-16T12:00:00.000Z");

  await t.test("parses 'just now' and 'today'", () => {
    assert.equal(parsePostedDate("just now", ref), ref.toISOString());
    assert.equal(parsePostedDate("today", ref), ref.toISOString());
  });

  await t.test("parses 'yesterday'", () => {
    const expected = new Date("2026-09-15T12:00:00.000Z").toISOString();
    assert.equal(parsePostedDate("yesterday", ref), expected);
  });

  await t.test("parses '3 days ago' with or without 'Posted'", () => {
    const expected = new Date("2026-09-13T12:00:00.000Z").toISOString();
    assert.equal(parsePostedDate("3 days ago", ref), expected);
    assert.equal(parsePostedDate("Posted 3 days ago", ref), expected);
    assert.equal(parsePostedDate("• 3 days ago", ref), expected);
  });

  await t.test("parses 'a day ago' and 'a week ago'", () => {
    const expectedDay = new Date("2026-09-15T12:00:00.000Z").toISOString();
    assert.equal(parsePostedDate("a day ago", ref), expectedDay);

    const expectedWeek = new Date("2026-09-09T12:00:00.000Z").toISOString();
    assert.equal(parsePostedDate("a week ago", ref), expectedWeek);
  });

  await t.test("parses compact '3d ago', '2w ago'", () => {
    const expected3d = new Date("2026-09-13T12:00:00.000Z").toISOString();
    assert.equal(parsePostedDate("3d ago", ref), expected3d);

    const expected2w = new Date("2026-09-02T12:00:00.000Z").toISOString();
    assert.equal(parsePostedDate("2w ago", ref), expected2w);
  });

  await t.test("parses ISO absolute strings", () => {
    assert.equal(
      parsePostedDate("2026-08-20T00:00:00.000Z", ref),
      "2026-08-20T00:00:00.000Z",
    );
  });

  await t.test("returns null for empty/invalid input", () => {
    assert.equal(parsePostedDate(null), null);
    assert.equal(parsePostedDate(""), null);
    assert.equal(parsePostedDate("not-a-date"), null);
  });
});
