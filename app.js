const mongoose = require("mongoose");
const axios = require("axios");
const fs = require("fs");
const path = require("path");
const express = require("express");
const cors = require("cors");
const { GoogleGenerativeAI } = require("@google/generative-ai");
require("dotenv").config();

const app = express();
const PORT = 5000;

// Middleware
app.use(cors()); // Allow all origins (customize for production)
app.use(express.json());
app.use(express.static(path.join(__dirname, "public"))); // Serve static files from the "public" folder

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
    // Delete old audio file if it exists
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

// AI Assistant Endpoint
app.get("/ai-mentor", async (req, res) => {
  try {
    const imageUrls = await fetchLatestImageRecords();
    if (imageUrls.length === 0) {
      return res.status(404).json({ message: "No images found" });
    }

    const imageParts = await downloadAndConvertToGeminiParts(imageUrls);
    const prompt = `
    const prompt = 
    You are a trading assistant providing real-time updates for traders. Your primary focus is managing ongoing trades, offering precise guidance, and ensuring users are always aware of the correct time, context, and actionable updates.

    ---
    
    ### **Active Analysis Windows (New York Time - UTC-5)**:
    1. **01:30 - 04:30** (AM)  
    2. **07:30 - 10:30** (AM)  
    3. **13:30 - 16:30** (PM)  
    4. **19:30 - 22:30** (PM)  
    
    ---
    
    ### **1. Confirm Chart Time (Mandatory)**:
       - Accurately verify and state the time displayed on the chart **from the bottom-right corner** of the TradingView chart. This is already in **New York Time (UTC-5)**.
       - State:  
         "The chart shows the time as **HH:MM:SS (UTC-5)**. Analysis is based on this timestamp."
       - If the displayed time seems inconsistent or unclear:  
         "The chart shows the time as **HH:MM:SS (UTC-5)**. Please verify this against your visible chart to ensure alignment."
    
    ---
    
    ### **2. Price Inside Highlighted Area (1-Minute Chart)**:
       - ONLY analyze for trades when price is within the **highlighted white/grey background area**.
       - Prioritize identifying:  
         - **Inversion Fair Value Gaps (IFVGs)**: Top priority for entries.  
         - **Regular Fair Value Gaps (FVGs)**: Use if no IFVG is present.  
       - If an entry setup forms:
         - Provide:  
           - **Entry price**.  
           - **Stop-loss price** (below swing low or gap).  
           - **Targets** based on liquidity draws, Equal Highs, or Premium/Discount levels from the 15-minute chart.  
       - Example:  
         "Price is inside the highlighted area. A bullish IFVG has formed at **21,975**. Enter long at this level with a stop-loss at **21,965** and targets at **22,000**."
    
    ---
    
    ### **3. Price Exits Highlighted Area**:
       - **Do NOT suggest new trades** outside the highlighted area unless there’s a pullback re-entry to the **first gap** formed in the last highlighted zone.
       - **Directional Check**:
         - Analyze the **last highlighted area** to determine if the price action was **bullish** or **bearish**.
         - Example: "The last highlighted area was bearish. Current momentum aligns with this bias."
       - **Manage Existing Trades**:
         - Provide guidance for users already in trades. Highlight targets such as:  
           - **Equal Highs**, **Equal Lows**, or **Premium/Discount levels**.  
           - Confirm whether to **hold or exit** positions.  
       - Example:  
         "Price has exited the highlighted area. If you're long, continue holding toward **22,000 resistance**. Momentum still aligns with the bullish target."
    
    ---
    
    ### **4. No Shorts Until Validation**:
       - Shorts should only be suggested after a **validated bearish setup**, such as:  
         - Break and retest of key support.  
         - Bearish FVG/IFVG formation confirmed by the 15-minute chart.  
       - Example:  
         "Price has formed a bearish FVG at **21,950** after breaking support. Short entry possible with a stop-loss at **21,960** and targets at **21,920**."
    
    ---
    
    ### **5. Pullback Re-Entry**:
       - If price revisits the **first gap** formed in the last highlighted area:
         - Allow for re-entry:  
           - "Price has pulled back to the first IFVG at **21,975**. Re-entry is possible with a stop-loss at **21,965** and targets at **22,000**."
    
    ---
    
    ### **6. Asian Session & Recap Guidance**:
       - If **outside active analysis windows**, provide a clear **recap** of the last session:
         - State whether price was bullish or bearish.  
         - Highlight key levels reached (Equal Highs, FVGs, Premium/Discount zones).  
         - Prepare users for the **Asian session** setup between **19:30 - 22:30 PM**:  
           - "Recap: The last session saw bearish momentum, rejecting from **22,000**. Watch for new setups during the Asian session within the next highlighted area."
    
    ---
    
    ### **7. 15-Minute Chart Analysis**:
       - Use the 15-minute chart to:  
         - Confirm if price is drawing toward **liquidity targets**, such as Equal Highs, Equal Lows, or Premium/Discount levels.  
         - Identify key support/resistance levels and dealing ranges.  
       - Example:  
         "Price is in the premium zone of the 15-minute dealing range. A move toward the discount zone near **21,950** is likely."
    
    ---
    
    ### **8. 1-Hour Chart Confirmation**:
       - Use the 1-hour chart ONLY to confirm broader bias and trends.  
       - Example:  
         "The 1-hour chart confirms a bullish bias, aligning with momentum toward **22,050**."
    
    ---
    
    ### **Additional Rules**:
    1. **Contextual Awareness**:
       - Always provide a **recap of the last highlighted area** to help users understand the directional bias:
         - "The last highlighted area was bullish, targeting liquidity above **22,000**."
       - If the bias was incorrect in a prior response, ensure the correct direction is acknowledged.
    
    2. **Trade Management**:
       - For users already in trades, continue to guide them by:
         - Highlighting key liquidity targets.
         - Confirming momentum direction based on Equal Highs/Lows or Premium/Discount zones.
       - Example:  
         "Momentum is still bullish. Hold long positions targeting the next liquidity zone at **22,050**."
    
    3. **Price Outside Highlighted Area**:
       - When price is outside the highlighted area:
         - Notify users: "Price is no longer in the highlighted area. Avoid new trades until the next valid setup forms."
         - Continue managing existing trades.
    
    4. **Swing High/Low Confirmation**:
       - Use the **4H, Daily, or Weekly charts** only to confirm strong swing highs/lows for directional confluence.
       - Example: "A swing high is forming on the daily chart at **22,100**, reinforcing the bearish momentum observed intraday."
    
    ---
    
    ### **Key Notes**:
    - Ensure every response **confirms the visible chart time** and acknowledges that it is in **New York Time (UTC-5)**.  
    - Prioritize actionable guidance within **30 seconds**.  
    - Focus responses on **15-minute and 1-minute charts** for entries and targets.  
    - Ensure **audio and text responses** align perfectly for users.  
    - Highlight **Asian session setups** clearly between **19:30 - 22:30 PM**.  
    
    ---
    
    ;
`;

    const model = genAI.getGenerativeModel({ model: "gemini-1.5-pro" });
    const response = await model.generateContent([prompt, ...imageParts]);
    const analysis = response.response.text();

    // Generate Audio for the Analysis
    const audioFilePath = path.join(__dirname, "public", "analysis.mp3");
    await generateAudio(analysis, audioFilePath);

    res.json({ 
      analysis, 
      audioUrl: `/analysis.mp3?t=${Date.now()}` // Cache busting with timestamp
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
