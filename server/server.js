
require("dotenv").config();

const express = require("express");
const mongoose = require("mongoose");
const path = require("path");
const Trip = require("./models/trip");

const app = express();
const PORT = process.env.PORT || 3000;

const MONGODB_URI =
  process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/triplite";

app.use(express.json());
app.use(express.static(path.join(__dirname, "..", "client")));

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
app.get("/api/trips", async (req, res) => {
  try {
    const trips = await Trip.find().sort({ createdAt: -1 });

    res.json({
      success: true,
      count: trips.length,
      data: trips,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Failed to fetch trips",
    });
  }
});

// POST: Create a trip
app.post("/api/trips", async (req, res) => {
  try {
    const { name, destination, startDate, endDate, travellers, budget } =
      req.body;

    if (
      !name?.trim() ||
      !destination?.trim() ||
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
      !Number.isInteger(Number(travellers))
    ) {
      return res.status(400).json({
        success: false,
        message: "Travellers must be a positive whole number",
      });
    }

    if (!Number.isFinite(Number(budget)) || Number(budget) < 0) {
      return res.status(400).json({
        success: false,
        message: "Budget must be zero or greater",
      });
    }

    const start = new Date(startDate);
    const end = new Date(endDate);

    if (
      Number.isNaN(start.getTime()) ||
      Number.isNaN(end.getTime()) ||
      end < start
    ) {
      return res.status(400).json({
        success: false,
        message: "Please provide valid trip dates",
      });
    }

    const trip = await Trip.create({
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
      data: trip,
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
app.put("/api/trips/:id", async (req, res) => {
  try {
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
      updates.startDate = new Date(updates.startDate);
    }

    if (updates.endDate !== undefined) {
      updates.endDate = new Date(updates.endDate);
    }

    for (const field of ["startDate", "endDate"]) {
      if (
        updates[field] !== undefined &&
        Number.isNaN(updates[field].getTime())
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
            (!Number.isInteger(value) || value < 1)) ||
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

    const existingTrip = await Trip.findById(req.params.id);

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

    const trip = await Trip.findByIdAndUpdate(
      req.params.id,
      updates,
      { new: true, runValidators: true }
    );

    res.json({
      success: true,
      message: "Trip updated successfully",
      data: trip,
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
app.delete("/api/trips/:id", async (req, res) => {
  try {
    const trip = await Trip.findByIdAndDelete(req.params.id);

    if (!trip) {
      return res.status(404).json({
        success: false,
        message: "Trip not found",
      });
    }

    res.json({
      success: true,
      message: "Trip deleted successfully",
      data: trip,
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

// Connect to MongoDB, then start server
mongoose
  .connect(MONGODB_URI)
  .then(() => {
    console.log("MongoDB connected successfully!");

    app.listen(PORT, () => {
      console.log(`TripLite running at http://localhost:${PORT}`);
    });
  })
  .catch((error) => {
    console.error("MongoDB connection failed:", error.message);
    process.exit(1);
  });
