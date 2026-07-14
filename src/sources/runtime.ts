"use strict";

import axios from "axios";
import * as cheerio from "cheerio";
import Parser from "rss-parser";
import crypto from "crypto";
import mongoContext from "../infra/mongo/mongoContext.js";
import { createCircuitBreakerStore } from "./updates/circuitBreakerStore.js";

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

export default {
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
  circuitBreakerStore: createCircuitBreakerStore(CircuitBreakerModel)
};
