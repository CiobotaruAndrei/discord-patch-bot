export interface GuildYoutubeErrorDoc {
  guildId: string;
  channelId?: string;
  channelName?: string;
  message?: string;
  at?: Date;
}

export interface GuildDeadLetterDoc {
  guildId: string;
  kind: "update" | "discount" | "youtube";
  itemId?: string;
  title?: string;
  channelId?: string;
  dedupeKey?: string;
  reason?: string;
  attempts?: number;
  failedAt?: Date;
}
