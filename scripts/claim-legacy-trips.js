require("dotenv").config();

const mongoose = require("mongoose");
// Keep the default dry run read-only; model initialization must not create indexes.
mongoose.set("autoIndex", false);
const Trip = require("../server/models/trip");
const User = require("../server/models/user");

async function main() {
  const email = process.argv.find(argument => argument.startsWith("--email="))
    ?.slice("--email=".length)
    .trim()
    .toLowerCase();
  const apply = process.argv.includes("--apply");

  if (!email) {
    throw new Error("Provide the chosen account with --email=account@example.com");
  }
  if (!process.env.MONGODB_URI) {
    throw new Error("Set MONGODB_URI in .env to the database you backed up.");
  }

  await mongoose.connect(process.env.MONGODB_URI);
  const user = await User.findOne({ email });
  if (!user) throw new Error("No account with that email exists.");

  const ownerless = { $or: [{ owner: { $exists: false } }, { owner: null }] };
  const count = await Trip.countDocuments(ownerless);
  console.log(`${count} ownerless trip(s) would be assigned to ${user.email}.`);

  if (!apply) {
    console.log("Dry run only. Review a MongoDB backup, then add --apply to claim these records.");
    return;
  }

  const result = await Trip.updateMany(ownerless, { $set: { owner: user._id } });
  console.log(`Claimed ${result.modifiedCount} legacy trip(s). Already owned trips were not changed.`);
}

main()
  .catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });
