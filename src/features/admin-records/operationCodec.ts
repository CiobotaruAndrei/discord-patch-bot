"use strict";

export type OperationCodec<Payload> = {
  schemaVersion: number;
  decode: (value: unknown) => Payload | null;
  execute: (payload: Payload, operationId: string) => Promise<void>;
  resourceKey: (payload: Payload) => string;
};

export type OperationCodecTable<KindMap> = {
  [K in keyof KindMap & string]: OperationCodec<KindMap[K]>;
};

export function decodeOrThrow<Payload>(kind: string, codec: OperationCodec<Payload>, value: unknown): Payload {
  const payload = codec.decode(value);
  if (payload === null) {
    throw new Error(`operationJournal: payload invalid pentru operatia '${kind}' (schemaVersion ${codec.schemaVersion})`);
  }
  return payload;
}

export function executorsFrom<KindMap>(
  table: OperationCodecTable<KindMap>
): { [K in keyof KindMap & string]: (value: unknown, operationId: string) => Promise<void> } {
  const executors = {} as { [K in keyof KindMap & string]: (value: unknown, operationId: string) => Promise<void> };
  for (const kind of Object.keys(table) as Array<keyof KindMap & string>) {
    const codec = table[kind];
    executors[kind] = async (value: unknown, operationId: string) => {
      await codec.execute(decodeOrThrow(kind, codec, value), operationId);
    };
  }
  return executors;
}

export function schemaVersionsFrom<KindMap>(
  table: OperationCodecTable<KindMap>
): { [K in keyof KindMap & string]: number } {
  const versions = {} as { [K in keyof KindMap & string]: number };
  for (const kind of Object.keys(table) as Array<keyof KindMap & string>) {
    versions[kind] = table[kind].schemaVersion;
  }
  return versions;
}

export function resourceKeysFrom<KindMap>(
  table: OperationCodecTable<KindMap>
): { [K in keyof KindMap & string]: (value: unknown) => string | null } {
  const keys = {} as { [K in keyof KindMap & string]: (value: unknown) => string | null };
  for (const kind of Object.keys(table) as Array<keyof KindMap & string>) {
    const codec = table[kind];
    keys[kind] = (value: unknown) => {
      const payload = codec.decode(value);
      return payload === null ? null : codec.resourceKey(payload);
    };
  }
  return keys;
}
