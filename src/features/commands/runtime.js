"use strict";

const crypto = require("crypto");
const {
  EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
  ComponentType, MessageFlags, PermissionsBitField,
  SlashCommandBuilder, Routes, REST
} = require("discord.js");
const data = require("../../infra/mongo");
const scrapers = require("../../sources");

module.exports = {
  crypto,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
  MessageFlags,
  PermissionsBitField,
  SlashCommandBuilder,
  Routes,
  REST,
  ...data,
  ...scrapers
};
