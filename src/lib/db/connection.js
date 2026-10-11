// One MongoDB connection per server process, shared by every request.
//
// This file (and ./models.js) is also loaded by the command-line scripts in
// /scripts, so it uses relative imports only and nothing from Next.js.

import mongoose from "mongoose";
import { MODELS } from "./models.js";

// Survives hot reloads in development and is reused across invocations on
// serverless platforms.
const state = (globalThis.__cpfMongo ??= { promise: null, indexes: null });

/** Reads and sanity-checks MONGODB_URI. The value itself is never logged or returned to a page. */
export function readMongoUri(env = process.env) {
  const uri = env.MONGODB_URI;
  if (typeof uri !== "string" || uri.trim() === "") {
    throw new Error("MongoDB is not configured. Copy .env.example to .env.local and set MONGODB_URI.");
  }
  if (!/^mongodb(\+srv)?:\/\//.test(uri.trim())) {
    throw new Error("MONGODB_URI must start with mongodb:// or mongodb+srv://");
  }
  return uri.trim();
}

/** Connects (once) and makes sure the indexes the rules depend on exist. */
export async function connectDb() {
  if (!state.promise) {
    mongoose.set("strictQuery", "throw"); // a misspelt field in a filter is an error, never "match everything"
    state.promise = mongoose
      .connect(readMongoUri(), {
        // Fail fast with a clear error instead of queueing queries while disconnected.
        bufferCommands: false,
        serverSelectionTimeoutMS: 8000,
        maxPoolSize: Number(process.env.MONGODB_MAX_POOL_SIZE) || 10,
        autoIndex: false, // indexes are built deliberately, below
      })
      .catch((error) => {
        state.promise = null; // allow the next request to retry
        throw error;
      });
  }
  await state.promise;
  if (!state.indexes) {
    // Unique indexes are part of the rules (one match per pair, one interest
    // per sender and receiver, one message per client id…), so they are
    // created before anything is written. A no-op once they exist.
    state.indexes =
      process.env.MONGODB_SKIP_INDEX_SYNC === "1"
        ? Promise.resolve()
        : Promise.all(Object.values(MODELS).map((model) => model.createIndexes())).catch((error) => {
            state.indexes = null;
            throw error;
          });
  }
  await state.indexes;
  return mongoose.connection;
}

export async function disconnectDb() {
  state.promise = null;
  state.indexes = null;
  await mongoose.disconnect();
}

/** True for a unique-index violation. `field` narrows it to one index key. */
export function isDuplicateKey(error, field = null) {
  if (error?.code !== 11000) return false;
  if (!field) return true;
  return Object.keys(error.keyPattern ?? {}).includes(field) || String(error.message ?? "").includes(field);
}
