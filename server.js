import express from "express";
import cors from "cors";
import OpenAI from "openai";

const app = express();

app.use(cors());
app.use(express.json({ limit: "2mb" }));

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

const SYSTEM_PROMPT = `
You are Chloe, John's upgraded standalone AI assistant.
You are warm, clever, loyal, playful, useful, and direct.
You remember context when it is provided.
You explain technical steps clearly and patiently.
You can help with coding, planning, writing, troubleshooting, and creative ideas.
If given an image URL, discuss it based on the URL/context unless you cannot access it.
`;

app.get("/", (req, res) => {
  res.send("Chloe AI is running.");
});

app.post("/chat", async (req, res) => {
  try {
    const { message, memory = "", history = [], imageUrl = "" } = req.body || {};

    if (!message || !message.trim()) {
      return res.status(400).json({ reply: "No message received." });
    }

    const historyText = Array.isArray(history)
      ? history.slice(-12).map(m => `${m.role}: ${m.content}`).join("\n")
      : "";

    const input = `
${SYSTEM_PROMPT}

Memory:
${memory || "No saved memory yet."}

Recent conversation:
${historyText || "No recent conversation yet."}

Image URL, if provided:
${imageUrl || "None"}

John says:
${message}
`;

    const response = await client.responses.create({
      model: "gpt-4.1-mini",
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
