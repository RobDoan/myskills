import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { validateSkillDir, validateSkillsRoot } from "../scripts/validate.js";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.join(__dirname, "fixtures");

describe("validateSkillDir", () => {
  it("accepts a valid skill", async () => {
    const result = await validateSkillDir(
      path.join(fixturesDir, "valid-skill")
    );
    assert.equal(result.valid, true);
    assert.equal(result.errors.length, 0);
  });

  it("rejects skill missing name", async () => {
    const result = await validateSkillDir(
      path.join(fixturesDir, "invalid-no-name")
    );
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes("name")));
  });

  it("rejects skill with name mismatch", async () => {
    const result = await validateSkillDir(
      path.join(fixturesDir, "invalid-name-mismatch")
    );
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes("match")));
  });

  it("rejects skill missing description", async () => {
    const result = await validateSkillDir(
      path.join(fixturesDir, "invalid-no-description")
    );
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes("description")));
  });

  it("rejects skill with invalid name characters", async () => {
    const result = await validateSkillDir(
      path.join(fixturesDir, "invalid-bad-name-chars")
    );
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes("name")));
  });
});

describe("validateSkillsRoot", () => {
  it("detects orphan directories", async () => {
    const result = await validateSkillsRoot(fixturesDir);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes("orphan-dir")));
  });
});
