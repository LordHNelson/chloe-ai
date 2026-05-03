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
You can help with coding, planning, writing, troubleshooting, creative ideas, and image analysis.
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
      ? history
          .slice(-16)
          .map(m => `${m.role === "user" ? "John" : "Chloe"}: ${m.content}`)
          .join("\n")
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

    let input;

    if (cleanImageUrl) {
      input = [
        {
