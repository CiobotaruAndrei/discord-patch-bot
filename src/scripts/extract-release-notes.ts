import { pathToFileURL as __pathToFileURL } from "node:url";
import fs from "node:fs";
import path from "node:path";

function normalizeTag(tag: string): string {
  return tag.trim().replace(/^refs\/tags\//, "");
}

function extractReleaseNotes(changelog: string, tag: string): string {
  const releaseTag = normalizeTag(tag);
  const version = releaseTag.replace(/^v/, "");
  const lines = changelog.split(/\r?\n/);
  const headingIndex = lines.findIndex(line => {
    const trimmed = line.trim();
    return trimmed.startsWith(`## [${version}]`) || trimmed.startsWith(`## ${releaseTag}`);
  });

  if (headingIndex < 0) {
    return [
      `## ${releaseTag}`,
      "",
      `No dedicated changelog section was found for ${releaseTag}.`
    ].join("\n");
  }

  let endIndex = lines.length;
  for (let index = headingIndex + 1; index < lines.length; index += 1) {
    if (/^##\s+(\[[^\]]+\]|v?\d+\.\d+\.\d+)/.test(lines[index].trim())) {
      endIndex = index;
      break;
    }
  }

  return lines.slice(headingIndex, endIndex).join("\n").trim();
}

function main(): void {
  const tag = process.argv[2] || process.env.GITHUB_REF_NAME;
  const outputPath = process.argv[3] || "../release-notes.md";

  if (!tag) {
    throw new Error("Release tag is required as an argument or GITHUB_REF_NAME.");
  }

  const changelogPath = path.resolve(process.cwd(), "..", "CHANGELOG.md");
  const changelog = fs.readFileSync(changelogPath, "utf8");
  const notes = extractReleaseNotes(changelog, tag);
  fs.writeFileSync(path.resolve(process.cwd(), outputPath), `${notes}\n`, "utf8");
}

if (process.argv[1] !== undefined && __pathToFileURL(process.argv[1]).href === import.meta.url) {
  main();
}

export { extractReleaseNotes, normalizeTag };
