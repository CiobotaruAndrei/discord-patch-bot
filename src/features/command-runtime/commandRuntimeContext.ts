import crypto = require("crypto");
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
  EmbedBuilder,
  MessageFlags,
  PermissionsBitField,
  REST,
  Routes,
  SlashCommandBuilder
} from "discord.js";

const data = require("../../infra/mongo/mongoContext");
const scrapers = require("../../sources/sourceRegistry");

const runtime = {
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

export = runtime;
