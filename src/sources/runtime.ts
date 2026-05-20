"use strict";

const axios = require("axios");
const cheerio = require("cheerio");
const Parser = require("rss-parser");
const crypto = require("crypto");
const data = require("../infra/mongo/mongoContext");

module.exports = {
  axios,
  cheerio,
  Parser,
  crypto,
  rssParser: new Parser(),
  ...data
};

export {};
