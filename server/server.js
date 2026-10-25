
require("dotenv").config();

const express = require("express");
const mongoose = require("mongoose");
const path = require("path");
const crypto = require("crypto");
const session = require("express-session");
const { MongoStore } = require("connect-mongo");
const bcrypt = require("bcryptjs");
const { rateLimit } = require("express-rate-limit");
const Trip = require("./models/trip");
const User = require("./models/user");

const app = express();
app.disable("x-powered-by");
const proxyHops = Number(process.env.TRUST_PROXY_HOPS || 0);
if (Number.isInteger(proxyHops) && proxyHops > 0) {
  app.set("trust proxy", proxyHops);
}
const PORT = process.env.PORT || 3000;

const MONGODB_URI =
  process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/triplite";
const SESSION_SECRET = process.env.SESSION_SECRET;
const SESSION_IDLE_MS = 30 * 60 * 1000;
const SESSION_ABSOLUTE_MS = 12 * 60 * 60 * 1000;
const SESSION_COOKIE = "triplite.sid";

if (!SESSION_SECRET || Buffer.byteLength(SESSION_SECRET) < 32) {
  throw new Error("SESSION_SECRET must be set to at least 32 bytes in .env");
}

const mongoConnectionPromise = mongoose.connect(MONGODB_URI);
const mongoClientPromise = mongoConnectionPromise.then(() =>
  mongoose.connection.getClient()
);
const sessionStore = MongoStore.create({
  clientPromise: mongoClientPromise,
  collectionName: "triplite_sessions",
  ttl: SESSION_IDLE_MS / 1000,
  autoRemove: "native",
});

const authRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: "Too many authentication attempts. Try again later." },
});

const dummyPasswordHashPromise = bcrypt.hash(
  "TripLite-invalid-account-placeholder",
  12
);

function parseDateOnly(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return null;
  }

  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));

  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }

  return date;
}

app.use(express.json({ limit: "20kb" }));
app.use("/api", (req, res, next) => {
  res.set("Cache-Control", "no-store");
  next();
});
app.use(express.static(path.join(__dirname, "..", "client")));
app.use(session({
  name: SESSION_COOKIE,
  secret: SESSION_SECRET,
  store: sessionStore,
  resave: false,
  saveUninitialized: false,
  rolling: true,
  cookie: {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: SESSION_IDLE_MS,
  },
}));

app.use((req, res, next) => {
  const createdAt = req.session?.authenticatedAt;
  if (!createdAt || Date.now() - createdAt < SESSION_ABSOLUTE_MS) return next();

  req.session.destroy(error => {
    if (error) return next(error);
    res.clearCookie(SESSION_COOKIE, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
    });
    res.status(401).json({ success: false, message: "Session expired. Please sign in again." });
  });
});

function safeUser(user) {
  return { id: String(user._id), name: user.name, email: user.email };
}

function safeTrip(trip) {
  const result = trip.toObject ? trip.toObject() : { ...trip };
  delete result.owner;
  return result;
}

function authRequired(req, res, next) {
  if (!req.session?.userId) {
    return res.status(401).json({ success: false, message: "Authentication required." });
  }
  req.authUserId = req.session.userId;
  next();
}

function originMatchesRequest(req) {
  const origin = req.get("origin");
  const referer = req.get("referer");
  const source = origin || referer;
  if (!source) return true;

  try {
    return new URL(source).origin === `${req.protocol}://${req.get("host")}`;
  } catch {
    return false;
  }
}

function csrfRequired(req, res, next) {
  if (!originMatchesRequest(req)) {
    return res.status(403).json({ success: false, message: "Request origin is not allowed." });
  }

  const suppliedBuffer = Buffer.from(req.get("x-csrf-token") || "");
  const expectedBuffer = Buffer.from(req.session?.csrfToken || "");
  if (
    !expectedBuffer.length ||
    suppliedBuffer.length !== expectedBuffer.length ||
    !crypto.timingSafeEqual(suppliedBuffer, expectedBuffer)
  ) {
    return res.status(403).json({ success: false, message: "Invalid or missing CSRF token." });
  }

  next();
}

function csrfTokenFor(req) {
  if (!req.session.csrfToken) {
    req.session.csrfToken = crypto.randomBytes(32).toString("hex");
  }
  return req.session.csrfToken;
}

function regenerateSession(req, user) {
  return new Promise((resolve, reject) => {
    req.session.regenerate(error => {
      if (error) return reject(error);
      req.session.userId = String(user._id);
      req.session.authenticatedAt = Date.now();
      req.session.csrfToken = crypto.randomBytes(32).toString("hex");
      req.session.save(saveError => {
        if (saveError) return reject(saveError);
        resolve(req.session.csrfToken);
      });
    });
  });
}

function destroySession(req) {
  return new Promise((resolve, reject) => {
    if (!req.session) return resolve();
    req.session.destroy(error => error ? reject(error) : resolve());
  });
}

const validEmail = email =>
  typeof email === "string" &&
  email.length <= 254 &&
  /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

app.get("/api/auth/csrf", (req, res) => {
  res.json({ success: true, csrfToken: csrfTokenFor(req) });
});

app.post("/api/auth/register", authRateLimit, csrfRequired, async (req, res) => {
  try {
    const { name, email, password, passwordConfirmation } = req.body || {};
    const normalizedEmail = typeof email === "string" ? email.trim().toLowerCase() : "";
    if (
      typeof name !== "string" || !name.trim() || name.trim().length > 80 ||
      !validEmail(normalizedEmail) ||
      typeof password !== "string" || password.length < 12 ||
      Buffer.byteLength(password, "utf8") > 72 ||
      password !== passwordConfirmation
    ) {
      return res.status(400).json({ success: false, message: "Unable to create an account. Check the details and password requirements." });
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const user = await User.create({ name: name.trim(), email: normalizedEmail, passwordHash });
    const csrfToken = await regenerateSession(req, user);
    res.status(201).json({ success: true, user: safeUser(user), csrfToken });
  } catch (error) {
    if (error?.code === 11000 || error?.name === "ValidationError") {
      return res.status(400).json({ success: false, message: "Unable to create an account. Check the details and password requirements." });
    }
    console.error("Account registration failed:", error.message);
    res.status(500).json({ success: false, message: "Could not create the account. Please try again." });
  }
});

app.post("/api/auth/login", authRateLimit, csrfRequired, async (req, res) => {
  try {
    const { email, password } = req.body || {};
    const normalizedEmail = typeof email === "string" ? email.trim().toLowerCase() : "";
    const user = validEmail(normalizedEmail)
      ? await User.findOne({ email: normalizedEmail }).select("+passwordHash")
      : null;
    const passwordHash = user?.passwordHash || await dummyPasswordHashPromise;
    const validPassword = typeof password === "string" && Buffer.byteLength(password, "utf8") <= 72
      ? await bcrypt.compare(password, passwordHash)
      : false;

    if (!user || !validPassword) {
      return res.status(401).json({ success: false, message: "Email or password is incorrect." });
    }

    const csrfToken = await regenerateSession(req, user);
    res.json({ success: true, user: safeUser(user), csrfToken });
  } catch (error) {
    console.error("Login failed:", error.message);
    res.status(500).json({ success: false, message: "Could not sign in. Please try again." });
  }
});

app.get("/api/auth/me", authRequired, async (req, res) => {
  try {
    const user = await User.findById(req.authUserId);
    if (!user) {
      await destroySession(req);
      return res.status(401).json({ success: false, message: "Authentication required." });
    }
    res.json({ success: true, user: safeUser(user) });
  } catch (error) {
    console.error("Session profile lookup failed:", error.message);
    res.status(500).json({ success: false, message: "Could not load the account." });
  }
});

app.post("/api/auth/logout", authRequired, csrfRequired, async (req, res) => {
  try {
    await destroySession(req);
    res.clearCookie(SESSION_COOKIE, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
    });
    res.json({ success: true });
  } catch (error) {
    console.error("Logout failed:", error.message);
    res.status(500).json({ success: false, message: "Could not sign out. Please try again." });
  }
});

// Health check
app.get("/api/health", (req, res) => {
  res.json({
    success: true,
    message: "TripLite backend is running!",
    database:
      mongoose.connection.readyState === 1
        ? "connected"
        : "disconnected",
  });
});

// GET: Fetch all trips
app.get("/api/trips", authRequired, async (req, res) => {
  try {
    const trips = await Trip.find({ owner: req.authUserId }).sort({ createdAt: -1 });

    res.json({
      success: true,
      count: trips.length,
      data: trips.map(safeTrip),
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Failed to fetch trips",
    });
  }
});

app.get("/api/trips/:id", authRequired, async (req, res) => {
  try {
    const trip = await Trip.findOne({
      _id: req.params.id,
      owner: req.authUserId,
    });
    if (!trip) {
      return res.status(404).json({ success: false, message: "Trip not found" });
    }
    res.json({ success: true, data: safeTrip(trip) });
  } catch (error) {
    if (error.name === "CastError") {
      return res.status(400).json({ success: false, message: "Invalid trip ID" });
    }
    res.status(500).json({ success: false, message: "Failed to fetch trip" });
  }
});

// POST: Create a trip
app.post("/api/trips", authRequired, csrfRequired, async (req, res) => {
  try {
    if (!req.body || typeof req.body !== "object" || Array.isArray(req.body)) {
      return res.status(400).json({
        success: false,
        message: "Please provide trip details as a JSON object",
      });
    }

    const { name, destination, startDate, endDate, travellers, budget } =
      req.body;

    if (
      typeof name !== "string" ||
      !name.trim() ||
      typeof destination !== "string" ||
      !destination.trim() ||
      !startDate ||
      !endDate ||
      travellers === undefined ||
      budget === undefined
    ) {
      return res.status(400).json({
        success: false,
        message: "Please provide all required trip fields",
      });
    }

    if (
      !Number.isFinite(Number(travellers)) ||
      Number(travellers) < 1 ||
      Number(travellers) > 50 ||
      !Number.isInteger(Number(travellers))
    ) {
      return res.status(400).json({
        success: false,
        message: "Travellers must be a whole number between 1 and 50",
      });
    }

    if (!Number.isFinite(Number(budget)) || Number(budget) < 0) {
      return res.status(400).json({
        success: false,
        message: "Budget must be zero or greater",
      });
    }

    const start = parseDateOnly(startDate);
    const end = parseDateOnly(endDate);

    if (!start || !end || end < start) {
      return res.status(400).json({
        success: false,
        message: "Please provide valid trip dates",
      });
    }

    const trip = await Trip.create({
      owner: req.authUserId,
      name: name.trim(),
      destination: destination.trim(),
      startDate: start,
      endDate: end,
      travellers: Number(travellers),
      budget: Number(budget),
    });

    res.status(201).json({
      success: true,
      message: "Trip created successfully",
      data: safeTrip(trip),
    });
  } catch (error) {
    if (error.name === "ValidationError") {
      return res.status(400).json({
        success: false,
        message: error.message,
      });
    }

    res.status(500).json({
      success: false,
      message: "Failed to create trip",
    });
  }
});

// PUT: Update a trip
app.put("/api/trips/:id", authRequired, csrfRequired, async (req, res) => {
  try {
    if (!req.body || typeof req.body !== "object" || Array.isArray(req.body)) {
      return res.status(400).json({
        success: false,
        message: "Please provide trip updates as a JSON object",
      });
    }

    const allowedFields = [
      "name",
      "destination",
      "startDate",
      "endDate",
      "travellers",
      "budget",
    ];

    const updates = {};

    for (const field of allowedFields) {
      if (req.body[field] !== undefined) {
        updates[field] = req.body[field];
      }
    }

    if (updates.name !== undefined) {
      if (typeof updates.name !== "string" || !updates.name.trim()) {
        return res.status(400).json({
          success: false,
          message: "Trip name cannot be empty",
        });
      }
      updates.name = updates.name.trim();
    }

    if (updates.destination !== undefined) {
      if (
        typeof updates.destination !== "string" ||
        !updates.destination.trim()
      ) {
        return res.status(400).json({
          success: false,
          message: "Destination cannot be empty",
        });
      }
      updates.destination = updates.destination.trim();
    }

    if (updates.startDate !== undefined) {
      updates.startDate = parseDateOnly(updates.startDate);
    }

    if (updates.endDate !== undefined) {
      updates.endDate = parseDateOnly(updates.endDate);
    }

    for (const field of ["startDate", "endDate"]) {
      if (
        updates[field] !== undefined &&
        !updates[field]
      ) {
        return res.status(400).json({
          success: false,
          message: `Invalid ${field}`,
        });
      }
    }

    for (const field of ["travellers", "budget"]) {
      if (updates[field] !== undefined) {
        const value = Number(updates[field]);

        if (
          !Number.isFinite(value) ||
          (field === "travellers" &&
            (!Number.isInteger(value) || value < 1 || value > 50)) ||
          (field === "budget" && value < 0)
        ) {
          return res.status(400).json({
            success: false,
            message: `Invalid ${field}`,
          });
        }

        updates[field] = value;
      }
    }

    const existingTrip = await Trip.findOne({
      _id: req.params.id,
      owner: req.authUserId,
    });

    if (!existingTrip) {
      return res.status(404).json({
        success: false,
        message: "Trip not found",
      });
    }

    const finalStart = updates.startDate || existingTrip.startDate;
    const finalEnd = updates.endDate || existingTrip.endDate;

    if (finalEnd < finalStart) {
      return res.status(400).json({
        success: false,
        message: "End date cannot be before start date",
      });
    }

    const trip = await Trip.findOneAndUpdate(
      { _id: req.params.id, owner: req.authUserId },
      updates,
      { new: true, runValidators: true }
    );

    res.json({
      success: true,
      message: "Trip updated successfully",
      data: safeTrip(trip),
    });
  } catch (error) {
    if (error.name === "CastError") {
      return res.status(400).json({
        success: false,
        message: "Invalid trip ID",
      });
    }

    res.status(500).json({
      success: false,
      message: "Failed to update trip",
    });
  }
});

// DELETE: Delete a trip
app.delete("/api/trips/:id", authRequired, csrfRequired, async (req, res) => {
  try {
    const trip = await Trip.findOneAndDelete({
      _id: req.params.id,
      owner: req.authUserId,
    });

    if (!trip) {
      return res.status(404).json({
        success: false,
        message: "Trip not found",
      });
    }

    res.json({
      success: true,
      message: "Trip deleted successfully",
      data: safeTrip(trip),
    });
  } catch (error) {
    if (error.name === "CastError") {
      return res.status(400).json({
        success: false,
        message: "Invalid trip ID",
      });
    }

    res.status(500).json({
      success: false,
      message: "Failed to delete trip",
    });
  }
});

app.use((error, req, res, next) => {
  if (res.headersSent) return next(error);
  console.error("Unhandled request error:", error.message);
  const status = error.status >= 400 && error.status < 500 ? error.status : 500;
  res.status(status).json({
    success: false,
    message: status === 400 ? "Invalid request body." : "Server error. Please try again.",
  });
});

async function startServer() {
  await mongoConnectionPromise;
  await Promise.all([User.init(), Trip.init()]);
  app.listen(PORT, () => {
    console.log("MongoDB connected successfully!");
    console.log(`TripLite running at http://localhost:${PORT}`);
  });
}

if (require.main === module) {
  startServer().catch(error => {
    console.error("TripLite startup failed:", error.message);
    process.exit(1);
  });
}

module.exports = { app, startServer };
