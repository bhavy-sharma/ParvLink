#!/usr/bin/env node
// Creates the MongoDB indexes the application relies on (the unique ones are
// part of its rules). The app also does this on its first connection; run this
// by hand after deploying a version that adds an index, or when the app runs
// with MONGODB_SKIP_INDEX_SYNC=1.
//
//   npm run db:indexes

import { withDb } from "./lib/env.mjs";

await withDb(async () => {
  const { MODELS } = await import("../src/lib/db/models.js");
  for (const [name, model] of Object.entries(MODELS)) {
    const indexes = await model.collection.indexes();
    console.log(`${model.collection.collectionName.padEnd(28)} ${String(indexes.length).padStart(2)} indexes  (${name})`);
  }
  console.log("\nIndexes are in place.");
});
