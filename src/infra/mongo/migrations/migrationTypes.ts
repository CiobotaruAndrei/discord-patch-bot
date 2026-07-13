interface MigrationCollectionLike {
  updateMany(filter: object, update: object): Promise<unknown>;
  updateOne(filter: object, update: object, options?: object): Promise<unknown>;
  findOne(filter: object): Promise<Record<string, unknown> | null>;
  bulkWrite(ops: object[], options?: object): Promise<unknown>;
  find(filter?: object, options?: object): AsyncIterable<Record<string, unknown>>;
}

interface MigrationConnectionLike {
  db?: unknown;
  collection(name: string): MigrationCollectionLike;
}

interface MigrationMongooseLike {
  connection: MigrationConnectionLike;
}

interface Migration {
  id: number;
  name: string;
  up: (db: MigrationConnectionLike) => Promise<void>;
}

export type { MigrationCollectionLike, MigrationConnectionLike, MigrationMongooseLike, Migration };
