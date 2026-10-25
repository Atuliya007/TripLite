"use strict";

const { after, before, test } = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("crypto");

const configuredTestUri = process.env.MONGODB_TEST_URI;

if (!configuredTestUri) {
  test("authentication integration tests require MONGODB_TEST_URI", {
    skip: "Set MONGODB_TEST_URI to a dedicated disposable test database URI.",
  }, () => {});
} else {
  const databaseUrl = new URL(configuredTestUri);
  const baseDatabaseName = decodeURIComponent(databaseUrl.pathname.slice(1));
  if (!/test/i.test(baseDatabaseName)) {
    throw new Error("MONGODB_TEST_URI database name must contain 'test'. Refusing to run tests.");
  }
  databaseUrl.pathname = `/${baseDatabaseName}_case_${crypto.randomBytes(6).toString("hex")}`;

  process.env.NODE_ENV = "test";
  process.env.MONGODB_URI = databaseUrl.toString();
  process.env.SESSION_SECRET = crypto.randomBytes(48).toString("hex");

  const mongoose = require("mongoose");
  const signature = require("cookie-signature");
  const Trip = require("../models/trip");
  const User = require("../models/user");
  const { app } = require("../server");

  let server;
  let baseUrl;

  before(async () => {
    await mongoose.connection.asPromise();
    await User.init();
    server = app.listen(0, "127.0.0.1");
    await new Promise(resolve => server.once("listening", resolve));
    baseUrl = `http://127.0.0.1:${server.address().port}`;
  });

  after(async () => {
    if (server) await new Promise(resolve => server.close(resolve));
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  });

  class TestClient {
    cookie = "";
    csrfToken = "";

    async request(path, { method = "GET", body, csrf = true, origin = baseUrl } = {}) {
      const headers = { Origin: origin };
      if (this.cookie) headers.Cookie = this.cookie;
      if (body !== undefined) headers["Content-Type"] = "application/json";
      if (csrf && method !== "GET" && this.csrfToken) {
        headers["X-CSRF-Token"] = this.csrfToken;
      }
      const response = await fetch(`${baseUrl}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const setCookie = response.headers.get("set-cookie");
      if (setCookie) this.cookie = setCookie.split(";")[0];
      const result = await response.json();
      if (typeof result.csrfToken === "string") {
        this.csrfToken = result.csrfToken;
      }
      return { response, result };
    }

    async getCsrf() {
      const { response, result } = await this.request("/api/auth/csrf");
      assert.equal(response.status, 200);
      this.csrfToken = result.csrfToken;
      return result.csrfToken;
    }

    async register(name, email, password = "TripLite test password 2026") {
      await this.getCsrf();
      const result = await this.request("/api/auth/register", {
        method: "POST",
        body: { name, email, password, passwordConfirmation: password },
      });
      if (result.result.csrfToken) this.csrfToken = result.result.csrfToken;
      return result;
    }

    async login(email, password) {
      await this.getCsrf();
      const result = await this.request("/api/auth/login", {
        method: "POST",
        body: { email, password },
      });
      if (result.result.csrfToken) this.csrfToken = result.result.csrfToken;
      return result;
    }
  }

  const password = "TripLite test password 2026";
  let userA;
  let userB;
  let clientA;
  let clientB;
  let tripAId;

  test("private trips return 401 before login", async () => {
    const client = new TestClient();
    const { response } = await client.request("/api/trips");
    assert.equal(response.status, 401);
    const write = await client.request("/api/trips", {
      method: "POST",
      body: { name: "Unauthorized", destination: "Nowhere" },
    });
    assert.equal(write.response.status, 401);
  });

  test("signup hashes passwords and returns only a safe profile", async () => {
    clientA = new TestClient();
    const { response, result } = await clientA.register("User A", "USERA@example.test", password);
    assert.equal(response.status, 201);
    assert.equal(result.user.email, "usera@example.test");
    assert.equal(Object.hasOwn(result.user, "passwordHash"), false);
    userA = await User.findById(result.user.id).select("+passwordHash");
    assert.notEqual(userA.passwordHash, password);
    assert.equal(await require("bcryptjs").compare(password, userA.passwordHash), true);
    const cookieAttributes = response.headers.get("set-cookie");
    assert.match(cookieAttributes, /HttpOnly/i);
    assert.match(cookieAttributes, /SameSite=Lax/i);
  });

  test("duplicate normalized email is rejected", async () => {
    const duplicate = new TestClient();
    const { response } = await duplicate.register("Duplicate", "  usera@EXAMPLE.test  ", password);
    assert.equal(response.status, 400);
  });

  test("incorrect password receives a generic login error", async () => {
    const client = new TestClient();
    const { response, result } = await client.login("usera@example.test", "incorrect password");
    assert.equal(response.status, 401);
    assert.equal(result.message, "Email or password is incorrect.");
  });

  test("registration enforces the password length policy", async () => {
    const client = new TestClient();
    const { response } = await client.register("Weak Password", "weak@example.test", "short");
    assert.equal(response.status, 400);
  });

  test("signup and login rotate the server-side session ID", async () => {
    const client = new TestClient();
    await client.getCsrf();
    const oldCookie = client.cookie;
    const oldCsrfToken = client.csrfToken;
    const { response } = await client.request("/api/auth/login", {
      method: "POST",
      body: { email: "usera@example.test", password },
    });
    assert.equal(response.status, 200);
    assert.notEqual(client.cookie, oldCookie);
    assert.notEqual(client.csrfToken, oldCsrfToken);
    clientA = client;
    userA = await User.findOne({ email: "usera@example.test" });
  });

  test("CSRF token is required for authenticated state changes", async () => {
    const { response } = await clientA.request("/api/trips", {
      method: "POST",
      csrf: false,
      body: { name: "No token", destination: "Nowhere" },
    });
    assert.equal(response.status, 403);
  });

  test("state-changing requests reject a foreign Origin", async () => {
    const { response } = await clientA.request("/api/trips", {
      method: "POST",
      origin: "https://attacker.example",
      body: { name: "Blocked", destination: "Nowhere" },
    });
    assert.equal(response.status, 403);
  });

  test("trip creation assigns the session owner and reads only that user's trips", async () => {
    const { response, result } = await clientA.request("/api/trips", {
      method: "POST",
      body: {
        name: "User A trip",
        destination: "Agra",
        startDate: "2027-01-10",
        endDate: "2027-01-12",
        travellers: 1,
        budget: 10000,
        owner: "000000000000000000000001",
      },
    });
    assert.equal(response.status, 201);
    tripAId = result.data._id;
    const storedTrip = await Trip.findById(tripAId).select("+owner");
    assert.equal(String(storedTrip.owner), String(userA._id));
    assert.notEqual(String(storedTrip.owner), "000000000000000000000001");
    const ownTrips = await clientA.request("/api/trips");
    assert.equal(ownTrips.result.count, 1);
  });

  test("second account cannot read another user's trip", async () => {
    clientB = new TestClient();
    const { response, result } = await clientB.register("User B", "userb@example.test", password);
    assert.equal(response.status, 201);
    userB = await User.findById(result.user.id);
    const { response: readResponse } = await clientB.request(`/api/trips/${tripAId}`);
    assert.equal(readResponse.status, 404);
    const ownTrips = await clientB.request("/api/trips");
    assert.equal(ownTrips.result.count, 0);
  });

  test("second account cannot edit another user's trip", async () => {
    const { response } = await clientB.request(`/api/trips/${tripAId}`, {
      method: "PUT",
      body: { name: "Stolen edit" },
    });
    assert.equal(response.status, 404);
    assert.equal((await Trip.findById(tripAId)).name, "User A trip");
  });

  test("second account cannot delete another user's trip", async () => {
    const { response } = await clientB.request(`/api/trips/${tripAId}`, { method: "DELETE", body: {} });
    assert.equal(response.status, 404);
    assert.ok(await Trip.findById(tripAId));
  });

  test("ownerless legacy trips remain intact and hidden", async () => {
    const legacy = await Trip.collection.insertOne({
      name: "Legacy ownerless trip",
      destination: "Legacy destination",
      startDate: new Date("2027-02-01T00:00:00.000Z"),
      endDate: new Date("2027-02-02T00:00:00.000Z"),
      travellers: 1,
      budget: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const { result } = await clientA.request("/api/trips");
    assert.equal(result.data.some(trip => trip._id === String(legacy.insertedId)), false);
    assert.ok(await Trip.collection.findOne({ _id: legacy.insertedId }));
  });

  test("server-side absolute expiry rejects an aged session", async () => {
    const cookieValue = decodeURIComponent(clientA.cookie.split("=")[1]);
    const sessionId = signature.unsign(cookieValue.slice(2), process.env.SESSION_SECRET);
    assert.ok(sessionId);
    const sessions = mongoose.connection.collection("triplite_sessions");
    const record = await sessions.findOne({ _id: sessionId });
    assert.ok(record);
    const storedSession = JSON.parse(record.session);
    storedSession.authenticatedAt = Date.now() - 13 * 60 * 60 * 1000;
    await sessions.updateOne({ _id: sessionId }, { $set: { session: JSON.stringify(storedSession) } });
    const pageResponse = await fetch(baseUrl, { headers: { Cookie: clientA.cookie } });
    assert.equal(pageResponse.status, 200);
    assert.match(pageResponse.headers.get("content-type"), /text\/html/i);
    const { response } = await clientA.request("/api/auth/me");
    assert.equal(response.status, 401);
  });

  test("logout destroys the session", async () => {
    const client = new TestClient();
    const { response } = await client.login("userb@example.test", password);
    assert.equal(response.status, 200);
    const logout = await client.request("/api/auth/logout", { method: "POST", body: {} });
    assert.equal(logout.response.status, 200);
    const profile = await client.request("/api/auth/me");
    assert.equal(profile.response.status, 401);
  });
}
