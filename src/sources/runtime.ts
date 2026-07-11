"use strict";

const axios = require("axios");
const cheerio = require("cheerio");
const Parser = require("rss-parser");
const crypto = require("crypto");
const mongoContext = require("../infra/mongo/mongoContext") as typeof import("../infra/mongo/mongoContext");

const {
  env,
  logger,
  getAbortSignal,
  getCurrencyConfig,
  formatPrice,
  runConcurrent,
  adminAlert,
  SchemaDriftError,
  CircuitBreakerModel
} = mongoContext;

export = {
  axios,
  cheerio,
  Parser,
  crypto,
  rssParser: new Parser(),
  env,
  logger,
  getAbortSignal,
  getCurrencyConfig,
  formatPrice,
  runConcurrent,
  adminAlert,
  SchemaDriftError,
  CircuitBreakerModel
};
