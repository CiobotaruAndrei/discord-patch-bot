"use strict";

function errorMessage(err) {
  return err instanceof Error ? err.message : String(err);
}

function errorDetail(err) {
  return err instanceof Error ? (err.stack || err.message) : String(err);
}

module.exports = { errorMessage, errorDetail };
