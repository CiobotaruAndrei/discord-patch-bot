"use strict";

export type TemplateField = "updateMessageTemplate" | "discountMessageTemplate" | "youtubeMessageTemplate";

export interface NotificationTemplateSpec {
  command: string;
  field: TemplateField;
  defaultTemplate: string;
  placeholders: readonly string[];
  maxLength: number;
}

export const NOTIFICATION_TEMPLATE_SPECS: readonly NotificationTemplateSpec[] = [
  { command: "/start updates", field: "updateMessageTemplate", defaultTemplate: "", placeholders: ["count"], maxLength: 500 },
  { command: "/start reduceri", field: "discountMessageTemplate", defaultTemplate: "", placeholders: ["count"], maxLength: 500 },
  { command: "/youtube notify on", field: "youtubeMessageTemplate", defaultTemplate: "Videoclip nou de la {channel}: {title}\n{url}", placeholders: ["channel", "title", "url"], maxLength: 1000 }
];

export function normalizeTemplateCommand(value: unknown): string {
  return `/${String(value ?? "").replace(/^\/+/, "").replace(/\s+/g, " ").trim().toLocaleLowerCase("ro-RO")}`;
}

export function templateSpecFor(value: unknown): NotificationTemplateSpec | null {
  const command = normalizeTemplateCommand(value);
  return NOTIFICATION_TEMPLATE_SPECS.find(spec => spec.command === command) ?? null;
}

export function invalidTemplatePlaceholders(text: string, allowed: readonly string[]): string[] {
  const found = Array.from(text.matchAll(/\{([^{}]+)\}/g), match => match[1]);
  return Array.from(new Set(found.filter(name => !allowed.includes(name))));
}
