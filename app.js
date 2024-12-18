const mongoose = require("mongoose");
const axios = require("axios");
const fs = require("fs");
const path = require("path");
const express = require("express");
const cors = require("cors");
const { GoogleGenerativeAI } = require("@google/generative-ai");
require("dotenv").config();

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(
  cors({
    origin: "https://reactaifront.onrender.com", // Allow frontend domain
    methods: ["GET", "POST"],
    allowedHeaders: ["Content-Type"],
  })
);
app.use(express.json());
app.use(express.static(path.join(__dirname, "public"))); // Serve static files from "public" folder

// MongoDB Configuration
const MONGO_URI = process.env.MONGO_URI;
const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

// Initialize Google Generative AI
const genAI = new GoogleGenerativeAI(GOOGLE_API_KEY);

// MongoDB Schema and Model
const recordSchema = new mongoose.Schema(
  {
    symbol: String,
    timeframe: String,
    imageUrl: String,
    batchId: String,
    timestamp: Date,
  },
  { collection: "sentineldb_collection" }
);
const Record = mongoose.model("Record", recordSchema);

// Fetch Latest 7 Image URLs from MongoDB
async function fetchLatestImageRecords() {
  try {
    await mongoose.connect(MONGO_URI, { dbName: "sentineldb" });
    const latestRecords = await Record.find().sort({ timestamp: -1 }).limit(7);
    mongoose.connection.close();
    return latestRecords.map((record) => record.imageUrl);
  } catch (error) {
    console.error("Error fetching image records:", error.message);
    return [];
  }
}

// Convert Images to Gemini-Compatible Format
async function downloadAndConvertToGeminiParts(imageUrls) {
  const imageParts = [];
  for (const url of imageUrls) {
    try {
      const response = await axios.get(url, { responseType: "arraybuffer" });
      const base64Image = Buffer.from(response.data).toString("base64");
      imageParts.push({
        inlineData: { mimeType: "image/png", data: base64Image },
      });
    } catch (error) {
      console.error("Error downloading image:", error.message);
    }
  }
  return imageParts;
}

// Generate Audio File from Text
async function generateAudio(text, filePath) {
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      console.log("Old audio file deleted.");
    }

    const response = await axios.post(
      "https://api.openai.com/v1/audio/speech",
      {
        model: "tts-1",
        voice: "alloy",
        input: text,
      },
      {
        headers: {
          Authorization: `Bearer ${OPENAI_API_KEY}`,
          "Content-Type": "application/json",
        },
        responseType: "arraybuffer",
      }
    );

    fs.writeFileSync(filePath, Buffer.from(response.data));
    console.log(`Audio file saved to ${filePath}`);
  } catch (error) {
    console.error("Error generating audio:", error.message);
  }
}

// AI Mentor Endpoint
app.get("/ai-mentor", async (req, res) => {
  try {
    const imageUrls = await fetchLatestImageRecords();
    if (imageUrls.length === 0) {
      return res.status(404).json({ message: "No images found" });
    }

    const imageParts = await downloadAndConvertToGeminiParts(imageUrls);
    const prompt = `
      You are a trading assistant providing real-time updates for traders.
      Provide analysis based on active analysis windows and highlight areas.
    `;

    const model = genAI.getGenerativeModel({ model: "gemini-1.5-pro" });
    const response = await model.generateContent([prompt, ...imageParts]);
    const analysis = response.response.text();

    // Generate Audio for the Analysis
    const audioFilePath = path.join(__dirname, "public", "analysis.mp3");
    await generateAudio(analysis, audioFilePath);

    res.json({
      analysis,
      audioUrl: `/analysis.mp3?t=${Date.now()}`, // Cache busting with timestamp
    });
  } catch (error) {
    console.error("Error:", error.message);
    res.status(500).json({ error: "Failed to generate analysis" });
  }
});

// Serve Chart Screenshots
app.get("/chart-screenshots", (req, res) => {
  try {
    const chartScreenshots = {
      "1-Minute": "/screenshots/1-minute.png",
      "5-Minute": "/screenshots/5-minute.png",
      "15-Minute": "/screenshots/15-minute.png",
      "1-Hour": "/screenshots/1-hour.png",
      "4-Hour": "/screenshots/4-hour.png",
      "Daily": "/screenshots/daily.png",
      "Weekly": "/screenshots/weekly.png",
    };

    res.json(chartScreenshots);
  } catch (error) {
    console.error("Error serving chart screenshots:", error.message);
    res.status(500).json({ error: "Failed to load chart screenshots" });
  }
});

// Start the Server
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
