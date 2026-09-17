import test from "node:test";
import assert from "node:assert/strict";
import { parseSeniority } from "../parsers/seniority.parser.js";
import { buildJobUniqueKey } from "../normalizer/job.normalizer.js";

test("SeniorityParser — deterministic classification of job titles", async (t) => {
  await t.test("identifies C-Level & Executives", () => {
    assert.equal(parseSeniority("Chief Technology Officer"), "C-Level / Executive");
    assert.equal(parseSeniority("Co-Founder & CEO"), "C-Level / Executive");
    assert.equal(parseSeniority("CFO"), "C-Level / Executive");
    assert.equal(parseSeniority("Founding Engineer"), "C-Level / Executive");
  });

  await t.test("identifies VP and Head of roles", () => {
    assert.equal(parseSeniority("VP of Engineering"), "VP / Head of");
    assert.equal(parseSeniority("Vice President, Product"), "VP / Head of");
    assert.equal(parseSeniority("Head of Agronomic Benefits"), "VP / Head of");
  });

  await t.test("identifies Directors and Managers", () => {
    assert.equal(parseSeniority("Director of Sustainability"), "Director");
    assert.equal(parseSeniority("Engineering Manager"), "Manager");
    assert.equal(parseSeniority("Senior Product Manager"), "Manager");
  });

  await t.test("identifies Staff / Lead / Principal roles", () => {
    assert.equal(parseSeniority("Tech Lead - Climate Modeling"), "Lead / Principal / Staff");
    assert.equal(parseSeniority("Principal Battery Scientist"), "Lead / Principal / Staff");
    assert.equal(parseSeniority("Staff Software Engineer"), "Lead / Principal / Staff");
  });

  await t.test("identifies Senior roles", () => {
    assert.equal(parseSeniority("Senior Software Engineer"), "Senior");
    assert.equal(parseSeniority("Sr. Data Scientist"), "Senior");
    assert.equal(parseSeniority("Electrical Engineer III"), "Senior");
  });

  await t.test("identifies Entry-Level and Intern roles", () => {
    assert.equal(parseSeniority("Junior Full Stack Developer"), "Entry-Level / Junior");
    assert.equal(parseSeniority("Associate Product Manager"), "Entry-Level / Junior");
    assert.equal(parseSeniority("Software Engineering Intern"), "Intern / Co-op");
  });

  await t.test("defaults unspecified to Mid-Level", () => {
    assert.equal(parseSeniority("Software Engineer"), "Mid-Level");
    assert.equal(parseSeniority("Account Executive"), "Mid-Level");
    assert.equal(parseSeniority(""), "Mid-Level");
  });
});

test("JobUniqueKey — deterministic cross-platform hash generation", () => {
  const key1 = buildJobUniqueKey("Form Energy", "Senior Battery Engineer", "Somerville, MA", true);
  const key2 = buildJobUniqueKey("Form Energy Inc.", "Senior Battery Engineer", "Somerville, MA", true);

  assert.equal(key1, "form-energy:::senior-battery-engineer:::remote");
  assert.equal(key2, "form-energy-inc:::senior-battery-engineer:::remote");
});
