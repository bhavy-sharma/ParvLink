// Drops the throw-away database a test run used. Refuses anything that is not
// one of the test databases, whatever MONGODB_URI says.
import mongoose from "mongoose";

const uri = process.env.MONGODB_URI ?? "";
const name = new URL(uri.replace(/^mongodb(\+srv)?:/, "http:")).pathname.slice(1);
if (!/^cpf_(e2e|test)_[a-z0-9_]+$/i.test(name)) {
  console.error(`Not dropping "${name}": it does not look like a test database.`);
  process.exit(1);
}
await mongoose.connect(uri, { serverSelectionTimeoutMS: 5000 });
await mongoose.connection.dropDatabase();
await mongoose.disconnect();
