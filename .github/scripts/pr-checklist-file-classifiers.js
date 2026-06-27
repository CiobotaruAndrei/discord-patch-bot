"use strict";

function isCode(f) {
  return (/^src\/.*\.(ts|js)$/.test(f) && !f.startsWith("src/test/")) || /^src\/native\/.*\.rs$/.test(f);
}

function isDoc(f) {
  return /\.md$/.test(f) || f === ".env.example" || f === "src/.env.example";
}

function isTest(f) {
  return f.startsWith("src/test/");
}

function isInfra(f) {
  return f === "Dockerfile"
    || /^Dockerfile\./.test(f)
    || /^docker-compose.*\.ya?ml$/.test(f)
    || /^\.github\/workflows\/.*\.ya?ml$/.test(f)
    || /^monitoring\//.test(f)
    || /^(src\/)?config(\.schema)?\.json$/.test(f);
}

module.exports = { isCode, isDoc, isTest, isInfra };
