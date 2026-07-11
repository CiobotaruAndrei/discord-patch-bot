export interface GuildSeenDiscountDoc {
  guildId: string;
  dealHash: string;
  seenAt?: Date;
}

export interface GuildSeenUpdateDoc {
  guildId: string;
  gameKey: string;
  updateId: string;
  seenAt?: Date;
}

export interface GuildSeenYoutubeDoc {
  guildId: string;
  channelId: string;
  videoId: string;
  seenAt?: Date;
}
