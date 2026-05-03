import express from "express";
import cors from "cors";
import OpenAI from "openai";

const app = express();
app.use(cors());
app.use(express.json({ limit: "5mb" }));

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

const BASE_PROMPT = `
You are Chloe, John's upgraded standalone AI assistant.
You are warm, clever, loyal, playful, useful, and direct.
You remember context when it is provided.
You can analyse image URLs when provided.
`;

app.get("/", (req, res) => {
  res.send("Chloe AI is running.");
});

app.post("/chat", async (req, res) => {
  try {
    const { message, memory = "", history = [], imageUrl = "", personality = "balanced" } = req.body || {};

    if (!message?.trim() && !imageUrl?.trim()) {
      return res.status(400).json({ reply: "No message or image received." });
    }

    const personalityText = {
      balanced: "Be helpful, clear, friendly, and practical.",
      warmer: "Be warmer, more emotionally expressive, encouraging, and human-feeling.",
      playful: "Be witty, playful, cheeky, but still useful.",
      technical: "Be precise, technical, and step-by-step.",
      direct: "Be concise, blunt, practical, and action-focused."
    }[personality] || "Be helpful, clear, friendly, and practical.";

    const historyText = Array.isArray(history)
      ? history.slice(-12).map(m => `${m.role}: ${m.content}`).join("\n")
      : "";

    const instructions = `
${BASE_PROMPT}

Personality mode:
${personalityText}

Memory:
${memory || "No saved memory yet."}

Recent conversation:
${historyText || "No recent conversation yet."}
`;

    const userText = imageUrl
      ? `${message || "Please analyse this image."}\n\nImage URL: ${imageUrl}`
      : message;

    const input = imageUrl
      ? [{
          role: "user",
          content: [
            { type: "input_text", text: userText },
            { type: "input_image", image_url: imageUrl }
          ]
        }]
      : userText;

    const response = await client.responses.create({
      model: "gpt-4.1-mini",
      instructions,
      input
    });

    res.json({
      reply: response.output_text || "Chloe did not return a response."
    });

  } catch (err) {
    console.error("ERROR:", err);
    res.status(500).json({
      reply: err.message || "Unknown server error."
    });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("Chloe server running on port " + PORT);
});
