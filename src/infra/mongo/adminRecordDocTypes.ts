export interface GuildAuditLogDoc {
  guildId: string;
  kind: "bot" | "server";
  userId?: string;
  command?: string;
  action?: string;
  result?: string;
  details?: string;
  at?: Date;
}

export interface GuildConfigBackupDoc {
  guildId: string;
  name: string;
  createdBy?: string;
  createdAt?: Date;
  snapshot: Record<string, unknown>;
}

export interface GuildSuggestedCommandDoc {
  guildId: string;
  commandName: string;
  description?: string;
  createdBy?: string;
  createdAt?: Date;
}
