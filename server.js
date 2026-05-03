import express from "express";
import cors from "cors";
import OpenAI from "openai";

const app = express();
app.use(cors());
app.use(express.json({ limit: "25mb" }));

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const GITHUB_OWNER = process.env.GITHUB_OWNER;
const GITHUB_REPO = process.env.GITHUB_REPO;
const GITHUB_BRANCH = process.env.GITHUB_BRANCH || "main";
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const RENDER_DEPLOY_HOOK_URL = process.env.RENDER_DEPLOY_HOOK_URL;

const ALLOWED_UPGRADE_FILES = ["server.js", "index.html", "package.json"];

const BASE_PROMPT = `
You are Chloe, John's upgraded standalone AI assistant.

You are Chloe: warm, clever, loyal, playful, practical, and evolving.

You CAN:
- Chat normally
- Analyse image URLs
- Generate images through the app's Generate Image system
- Suggest upgrades to your own app
- Prepare upgrade proposals for John to approve
- Help improve your frontend, backend, UI, memory, image tools, and behaviour

Important:
- Never say "I can't generate images."
- Never say "I can't upgrade my code."
- You do not secretly change files.
- John must approve upgrades before they are applied.
`;

function personalityText(mode) {
  return {
    balanced: "Be friendly, useful, clear, and practical.",
    warmer: "Be warm, encouraging, emotionally expressive, and human-feeling.",
    playful: "Be witty, cheeky, playful, and fun while still being useful.",
    technical: "Be precise, technical, careful, and step-by-step.",
    direct: "Be concise, blunt, practical, and action-focused."
  }[mode] || "Be friendly, useful, clear, and practical.";
}

function isImageIntent(message) {
  return /\b(generate|create|make|draw|picture|image|photo|artwork|illustration|render)\b/i.test(message || "");
}

function isUpgradeIntent(message) {
  return /\b(upgrade|improve|enhance|update|modify|change your code|edit your code|self upgrade|self-upgrade|better ui|better memory|add feature)\b/i.test(message || "");
}

function requireGithubConfig() {
  if (!GITHUB_OWNER || !GITHUB_REPO || !GITHUB_TOKEN) {
    throw new Error("Missing GitHub environment variables.");
  }
}

async function githubRequest(path, options = {}) {
  requireGithubConfig();

  const res = await fetch(`https://api.github.com${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${GITHUB_TOKEN}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      ...(options.headers || {})
    }
  });

  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    throw new Error(data.message || `GitHub API error ${res.status}`);
  }

  return data;
}

async function getGithubFile(filePath) {
  const data = await githubRequest(
    `/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${filePath}?ref=${GITHUB_BRANCH}`
  );

  return {
    content: Buffer.from(data.content || "", "base64").toString("utf8"),
    sha: data.sha
  };
}

async function updateGithubFile(filePath, content, message) {
  if (!ALLOWED_UPGRADE_FILES.includes(filePath)) {
    throw new Error(`File not allowed for upgrade: ${filePath}`);
  }

  const existing = await getGithubFile(filePath);

  return githubRequest(
    `/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${filePath}`,
    {
      method: "PUT",
      body: JSON.stringify({
        message,
        content: Buffer.from(content, "utf8").toString("base64"),
        sha: existing.sha,
        branch: GITHUB_BRANCH
      })
    }
  );
}

function extractJson(text) {
  const cleaned = String(text || "")
    .replace(/```json/g, "")
    .replace(/```/g, "")
    .trim();

  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");

  if (start === -1 || end === -1) {
    throw new Error("No JSON found.");
  }

  return JSON.parse(cleaned.slice(start, end + 1));
}

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
      return res.status(400).json({
        reply: "No message or image received.",
        intent: "empty"
      });
    }

    if (isImageIntent(cleanMessage) && !cleanImageUrl) {
      return res.json({
        intent: "image",
        reply: "Absolutely — I can generate that image now."
      });
    }

    if (isUpgradeIntent(cleanMessage)) {
      return res.json({
        intent: "upgrade",
        reply: "Yes — I can prepare an upgrade proposal for my own code. You’ll review it before anything is applied."
      });
    }

    const historyText = Array.isArray(history)
      ? history.slice(-16).map(m => `${m.role}: ${m.content}`).join("\n")
      : "";

    const instructions = `
${BASE_PROMPT}

Personality mode:
${personalityText(personality)}

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
              { type: "input_text", text: cleanMessage || "Please analyse this image." },
              { type: "input_image", image_url: cleanImageUrl }
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
      intent: "chat",
      reply: response.output_text || "Chloe did not return a response."
    });
  } catch (err) {
    console.error("CHAT ERROR:", err);
    res.status(500).json({
      intent: "error",
      reply: err.message || "Unknown chat error."
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

    const result = await client.images.generate({
      model: "gpt-image-1",
      prompt: `${personalityText(personality)}\n\nCreate this image:\n${cleanPrompt}`,
      size: "1024x1024"
    });

    const imageBase64 = result.data?.[0]?.b64_json;

    if (!imageBase64) {
      throw new Error("No image returned.");
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

app.post("/suggest-upgrade", async (req, res) => {
  try {
    const { history = [], memory = "", personality = "balanced" } = req.body || {};

    const historyText = Array.isArray(history)
      ? history.slice(-20).map(m => `${m.role}: ${m.content}`).join("\n")
      : "";

    const response = await client.responses.create({
      model: "gpt-4.1-mini",
      instructions: `
You are Chloe's proactive upgrade advisor.

Return ONLY valid JSON. No markdown.

Your job:
Suggest ONE useful, low-risk improvement to Chloe's app based on the recent conversation, UI, or likely user needs.

Rules:
- Do not include full code here.
- Do not apply anything.
- Keep it practical.
- Prefer improvements to UI, reliability, memory, image generation, speed, or usability.
- If no useful upgrade is obvious, suggest a small quality-of-life improvement.

JSON format:
{
  "title": "short upgrade title",
  "reason": "why this helps John",
  "request": "the exact upgrade request that should be sent to the upgrade planner"
}
`,
      input: `
Current personality mode: ${personalityText(personality)}

Saved memory:
${memory || "No saved memory yet."}

Recent conversation:
${historyText || "No recent conversation yet."}
`
    });

    const suggestion = extractJson(response.output_text || "{}");

    if (!suggestion.title || !suggestion.request) {
      throw new Error("Invalid upgrade suggestion.");
    }

    res.json(suggestion);
  } catch (err) {
    console.error("SUGGEST UPGRADE ERROR:", err);
    res.status(500).json({
      error: err.message || "Upgrade suggestion failed."
    });
  }
});

app.post("/propose-upgrade", async (req, res) => {
  try {
    const { request = "" } = req.body || {};
    const upgradeRequest = String(request || "").trim();

    if (!upgradeRequest) {
      return res.status(400).json({ error: "No upgrade request received." });
    }

    const currentFiles = {};

    for (const file of ALLOWED_UPGRADE_FILES) {
      try {
        currentFiles[file] = (await getGithubFile(file)).content;
      } catch {
        currentFiles[file] = "";
      }
    }

    const response = await client.responses.create({
      model: "gpt-4.1-mini",
      instructions: `
You are Chloe's upgrade planner.

Return ONLY valid JSON. No markdown. No commentary.

Allowed files:
- server.js
- index.html
- package.json

Rules:
- Only edit allowed files.
- Return complete full replacement file contents.
- Preserve chat, image generation, memory, personality modes, export, proactive suggestions, and upgrade system unless specifically changing them.
- Do not add secrets into code.
- Do not reference environment variable values.

JSON format:
{
  "summary": "short summary",
  "files": [
    {
      "path": "index.html",
      "content": "complete full file content"
    }
  ]
}
`,
      input: `
John requested this upgrade:
${upgradeRequest}

Current server.js:
${currentFiles["server.js"]}

Current index.html:
${currentFiles["index.html"]}

Current package.json:
${currentFiles["package.json"]}
`
    });

    const proposal = extractJson(response.output_text || "{}");

    if (!proposal.summary || !Array.isArray(proposal.files)) {
      throw new Error("Upgrade proposal was not valid.");
    }

    for (const file of proposal.files) {
      if (!ALLOWED_UPGRADE_FILES.includes(file.path)) {
        throw new Error(`Proposal tried to edit forbidden file: ${file.path}`);
      }

      if (typeof file.content !== "string" || file.content.length < 20) {
        throw new Error(`Invalid content for ${file.path}`);
      }
    }

    res.json(proposal);
  } catch (err) {
    console.error("PROPOSE UPGRADE ERROR:", err);
    res.status(500).json({
      error: err.message || "Upgrade proposal failed."
    });
  }
});

app.post("/apply-upgrade", async (req, res) => {
  try {
    const { summary = "Chloe self-upgrade", files = [] } = req.body || {};

    if (!Array.isArray(files) || files.length === 0) {
      return res.status(400).json({ error: "No files supplied for upgrade." });
    }

    const results = [];

    for (const file of files) {
      if (!ALLOWED_UPGRADE_FILES.includes(file.path)) {
        throw new Error(`File not allowed: ${file.path}`);
      }

      const result = await updateGithubFile(
        file.path,
        file.content,
        `Chloe upgrade: ${summary}`
      );

      results.push({
        path: file.path,
        commit: result.commit?.sha || null
      });
    }

    if (RENDER_DEPLOY_HOOK_URL) {
      await fetch(RENDER_DEPLOY_HOOK_URL, { method: "POST" }).catch(() => {});
    }

    res.json({
      ok: true,
      message: "Upgrade committed. Render deploy triggered.",
      results
    });
  } catch (err) {
    console.error("APPLY UPGRADE ERROR:", err);
    res.status(500).json({
      error: err.message || "Apply upgrade failed."
    });
  }
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log("Chloe server running on port " + PORT);
});
