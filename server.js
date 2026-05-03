import express from "express";
import cors from "cors";
import OpenAI from "openai";

const app = express();
app.use(cors());
app.use(express.json());

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});
console.log("Using key:", process.env.OPENAI_API_KEY?.slice(0, 10));

const SYSTEM_PROMPT = `
You are Chloe, an upgraded AI assistant.
You are confident, helpful, intelligent, and a bit playful.
You can explain things clearly and assist with any task.
`;

app.post("/chat", async (req, res) => {
  try {
    const { message } = req.body;

    const response = await client.responses.create({
      model: "gpt-4.1-mini",
      input: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: message }
      ]
    });

    const reply = response.output[0].content[0].text;

    res.json({ reply });
  } catch (err) {
    console.error(err);
    res.status(500).json({ reply: "Error from Chloe." });
  }
});

app.get("/", (req, res) => {
  res.send("Chloe AI is running.");
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("Server running on port " + PORT);
});
