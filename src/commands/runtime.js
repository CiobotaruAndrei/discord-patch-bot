"use strict";

const crypto = require("crypto");
const {
  EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
  ComponentType, MessageFlags, PermissionsBitField,
  SlashCommandBuilder, Routes, REST
} = require("discord.js");
const data = require("../data");
const scrapers = require("../scrapers");

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
