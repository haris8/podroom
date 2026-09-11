import { index, integer, primaryKey, real, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

export const libraries = sqliteTable('libraries', {
  id: text('id').primaryKey(),
  ownerId: text('owner_id').notNull(),
  title: text('title').notNull(),
  sourceKey: text('source_key').notNull(),
  sourceHash: text('source_hash').notNull(),
  episodeCount: integer('episode_count').notNull(),
  createdAt: integer('created_at').notNull(),
  archived: integer('archived').notNull().default(0),
}, table => [index('idx_libraries_owner_archived_created').on(table.ownerId, table.archived, table.createdAt)]);

export const episodes = sqliteTable('episodes', {
  id: text('id').notNull(),
  libraryId: text('library_id').notNull().references(() => libraries.id),
  ordinal: integer('ordinal').notNull(),
  title: text('title').notNull(),
  words: integer('words').notNull(),
  voice: text('voice').notNull(),
  voiceName: text('voice_name').notNull(),
  engine: text('engine').notNull(),
  rate: real('rate').notNull(),
  passageCount: integer('passage_count').notNull(),
  progressIndex: integer('progress_index').notNull().default(0),
  completed: integer('completed').notNull().default(0),
  revision: integer('revision').notNull().default(0),
}, table => [primaryKey({columns: [table.libraryId, table.id]}), uniqueIndex('idx_episodes_library_ordinal').on(table.libraryId, table.ordinal)]);
