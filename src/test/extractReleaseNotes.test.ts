import test from "node:test";
import assert from "node:assert/strict";

const { extractReleaseNotes, normalizeTag } = require("../scripts/extract-release-notes") as {
  extractReleaseNotes: (changelog: string, tag: string) => string;
  normalizeTag: (tag: string) => string;
};

test("release notes extraction normalizes refs/tags prefixes", () => {
  assert.equal(normalizeTag("refs/tags/v1.2.3"), "v1.2.3");
});

test("release notes extraction returns only the matching changelog section", () => {
  const changelog = [
    "# Changelog",
    "",
    "## [Unreleased]",
    "",
    "- Future work",
    "",
    "## [1.2.3] - 2026-05-22",
    "",
    "### Added",
    "",
    "- Current release note",
    "",
    "## [1.2.2] - 2026-05-21",
    "",
    "- Old release note"
  ].join("\n");

  const notes = extractReleaseNotes(changelog, "v1.2.3");

  assert.match(notes, /## \[1\.2\.3\]/);
  assert.match(notes, /Current release note/);
  assert.doesNotMatch(notes, /Old release note/);
  assert.doesNotMatch(notes, /Future work/);
});

test("release notes extraction writes a small fallback when a tag has no section", () => {
  const notes = extractReleaseNotes("# Changelog\n\n## [Unreleased]\n", "v9.9.9");

  assert.match(notes, /## v9\.9\.9/);
  assert.match(notes, /No dedicated changelog section/);
});
