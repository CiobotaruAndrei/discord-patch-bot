"use strict";

export interface ReportType {
  value: string;
  label: string;
}

export const REPORT_TYPES: readonly ReportType[] = [
  { value: "update-gresit", label: "Update gresit/inexact" },
  { value: "duplicat", label: "Notificare duplicata" },
  { value: "joc-lipsa", label: "Joc sau sursa lipsa" },
  { value: "sursa-stricata", label: "Sursa stricata (nu mai vin update-uri)" },
  { value: "altceva", label: "Altceva" }
];

export const REPORT_TYPE_VALUES: readonly string[] = REPORT_TYPES.map(type => type.value);
