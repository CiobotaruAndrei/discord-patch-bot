"use strict";

const { startBot } = require("./bootstrap") as typeof import("./bootstrap");

startBot("worker");

export {};
