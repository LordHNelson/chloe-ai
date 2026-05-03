import express from "express";
import cors from "cors";
import OpenAI from "openai";

const app = express();

app.use(cors());
app.use(express.json());

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

const SYSTEM_PROMPT = `
You are Chloe, an upgraded AI assistant.
You are confident, helpful, intelligent, and a bit playful.
You explain things clearly and help with any task.
`;

app.post("/chat", async (req, res) => {
  try {
    const message = req.body?.message || "";

    if (!message.trim()) {
      return res.status(400).json({
        reply: "No message received."
      });
    }

    const response = await client.responses.create({
      model: "gpt-4.1-mini",
      input: `${SYSTEM_PROMPT}\n\nUser: ${message}`
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

app.get("/", (req, res) => {
  res.send("Chloe AI is running.");
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log("Chloe server running on port " + PORT);
});
