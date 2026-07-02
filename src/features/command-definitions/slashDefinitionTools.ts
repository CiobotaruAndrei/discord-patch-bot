export type SlashChoice = { name: string; value: string };
export type SlashCommandBuilderCtor = typeof import("discord.js").SlashCommandBuilder;
export type SlashCommandJson = ReturnType<InstanceType<SlashCommandBuilderCtor>["toJSON"]>;
export type PermissionsBitFieldLike = { Flags: { Administrator: { toString(): string } } };

export interface SlashCommandJsonSource {
  toJSON(): SlashCommandJson;
}

export interface SlashDefinitionTools {
  SlashCommandBuilder: SlashCommandBuilderCtor;
  PermissionsBitField: PermissionsBitFieldLike;
  CURRENCY_CHOICES: SlashChoice[];
}
