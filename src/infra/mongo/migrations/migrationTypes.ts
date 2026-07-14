import type { mongo } from "mongoose";

interface MigrationDocument extends mongo.Document {
  _id: string;
  [key: string]: unknown;
}

interface MigrationCursorLike extends AsyncIterable<MigrationDocument> {}

interface MigrationCollectionLike {
  findOne(filter: mongo.Filter<MigrationDocument>): Promise<MigrationDocument | null>;
  find(filter: mongo.Filter<MigrationDocument>, options?: mongo.FindOptions): MigrationCursorLike;
  updateOne(filter: mongo.Filter<MigrationDocument>, update: mongo.UpdateFilter<MigrationDocument> | mongo.Document[], options?: mongo.UpdateOptions): Promise<unknown>;
  updateMany(filter: mongo.Filter<MigrationDocument>, update: mongo.UpdateFilter<MigrationDocument> | mongo.Document[], options?: mongo.UpdateOptions): Promise<unknown>;
  bulkWrite(operations: readonly mongo.AnyBulkWriteOperation<MigrationDocument>[], options?: mongo.BulkWriteOptions): Promise<unknown>;
}

interface MigrationConnectionLike {
  db?: object | null;
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

export type { MigrationDocument, MigrationCursorLike, MigrationCollectionLike, MigrationConnectionLike, MigrationMongooseLike, Migration };
