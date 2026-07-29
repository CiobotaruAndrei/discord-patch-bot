"use strict";

export interface PaginationButtonInteraction {
  user: { id: string };
  customId: string;
  reply(payload: unknown): Promise<unknown>;
  deferUpdate(): Promise<unknown>;
}

export interface ComponentCollector {
  on(event: "collect", listener: (button: PaginationButtonInteraction) => unknown): this;
  on(event: "end", listener: () => unknown): this;
  stop(reason?: string): void;
}

export interface InteractionMessage {
  editable?: boolean;
  edit(payload: unknown): Promise<unknown>;
  createMessageComponentCollector(options: unknown): ComponentCollector;
}
