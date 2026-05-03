import express from "express";
import cors from "cors";
import OpenAI from "openai";

const app = express();

app.use(cors());
app.use(express.json({ limit: "10mb" }));

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

const BASE_PROMPT = `
You are Chloe, John's upgraded standalone AI assistant.
You are warm, clever, loyal, playful, useful, and direct.
You remember context when it is provided.
You explain things clearly and patiently.
You can help with coding, planning, writing, troubleshooting, creative ideas, image analysis, and image prompt creation.
`;

app.get("/", (req, res) => {
  res.send("Chloe AI is running.");
});

app.post("/chat", async (req, res) => {
  try {
    const {
      message = "",
      memory = "",
      history = [],
      imageUrl = "",
      personality = "balanced"
    } = req.body || {};

    const cleanMessage = String(message || "").trim();
    const cleanImageUrl = String(imageUrl || "").trim();

    if (!cleanMessage && !cleanImageUrl) {
      return res.status(400).json({ reply: "No message or image received." });
    }

    const personalityText = {
      balanced: "Be friendly, useful, clear, and practical.",
      warmer: "Be warmer, more emotionally expressive, reassuring, and human-feeling.",
      playful: "Be witty, playful, cheeky, and fun, while still being useful.",
      technical: "Be precise, technical, step-by-step, and careful.",
      direct: "Be concise, blunt, practical, and action-focused."
    }[personality] || "Be friendly, useful, clear, and practical.";

    const historyText = Array.isArray(history)
      ? history.slice(-16).map(m => `${m.role === "user" ? "John" : "Chloe"}: ${m.content}`).join("\n")
      : "";

    const instructions = `
${BASE_PROMPT}

Personality mode:
${personalityText}

Saved memory:
${memory || "No saved memory yet."}

Recent conversation:
${historyText || "No recent conversation yet."}
`;

    const input = cleanImageUrl
      ? [
          {
            role: "user",
            content: [
              {
                type: "input_text",
                text: `${cleanMessage || "Please analyse this image."}\n\nImage URL: ${cleanImageUrl}`
              },
              {
                type: "input_image",
                image_url: cleanImageUrl
              }
            ]
          }
        ]
      : `${instructions}\n\nJohn says:\n${cleanMessage}`;

    const response = await client.responses.create({
      model: "gpt-4.1-mini",
      instructions,
      input
    });

    res.json({
      reply: response.output_text || "Chloe did not return a response."
    });
  } catch (err) {
    console.error("CHAT ERROR:", err);
    res.status(500).json({
      reply: err.message || "Unknown server error."
    });
  }
});

app.post("/generate-image", async (req, res) => {
  try {
    const { prompt = "", personality = "balanced" } = req.body || {};
    const cleanPrompt = String(prompt || "").trim();

    if (!cleanPrompt) {
      return res.status(400).json({ error: "No image prompt received." });
    }

    const styleHint = {
      balanced: "Create a polished, visually clear image.",
      warmer: "Create a warm, emotionally rich, inviting image.",
      playful: "Create a fun, vivid, playful image.",
      technical: "Create a clean, precise, technically detailed image.",
      direct: "Create a simple, practical, no-nonsense image."
    }[personality] || "Create a polished, visually clear image.";

    const result = await client.images.generate({
      model: "gpt-image-1",
      prompt: `${styleHint}\n\n${cleanPrompt}`,
      size: "1024x1024"
    });

    const imageBase64 = result.data?.[0]?.b64_json;

    if (!imageBase64) {
      return res.status(500).json({ error: "No image returned." });
    }

    res.json({
      image: `data:image/png;base64,${imageBase64}`
    });
  } catch (err) {
    console.error("IMAGE ERROR:", err);
    res.status(500).json({
      error: err.message || "Image generation failed."
    });
  }
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log("Chloe server running on port " + PORT);
});
