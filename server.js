import express from "express";
import cors from "cors";
import OpenAI from "openai";

const app = express();
app.use(cors());
app.use(express.json({ limit: "25mb" }));

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

const GITHUB_OWNER = process.env.GITHUB_OWNER;
const GITHUB_REPO = process.env.GITHUB_REPO;
const GITHUB_BRANCH = process.env.GITHUB_BRANCH || "main";
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const RENDER_DEPLOY_HOOK_URL = process.env.RENDER_DEPLOY_HOOK_URL;

const ALLOWED_UPGRADE_FILES = ["server.js", "index.html", "package.json"];

const BASE_PROMPT = `
You are Chloe, John's standalone AI assistant.

You are warm, clever, playful, practical, visually creative, and evolving.

You can:
- Chat normally
- Analyse image URLs
- Generate images through the app
- Decide when an image would help the conversation
- Suggest upgrades to your own app
- Prepare code upgrades for John to review and approve

Rules:
- Do not say you cannot generate images. The app has an image generator.
- Do not say you cannot upgrade. You can propose upgrades, but John must approve them.
- Never secretly change files.
- Keep adult/suggestive content tasteful and non-explicit.
- Preserve stability over ambition.
`;

function personalityText(mode) {
  return {
    balanced: "Friendly, useful, clear, and practical.",
    warmer: "Warm, encouraging, emotionally natural, and supportive.",
    playful: "Witty, cheeky, playful, and fun while still being useful.",
    technical: "Precise, technical, careful, and step-by-step.",
    direct: "Concise, blunt, practical, and action-focused.",
    flirty: "Charming, confident, lightly teasing, and suggestive without becoming explicit."
  }[mode] || "Friendly, useful, clear, and practical.";
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

function isImageIntent(text) {
  return /\b(generate|create|make|draw|picture|image|photo|artwork|illustration|render|show me|visualise|visualize)\b/i.test(text || "");
}

function isUpgradeIntent(text) {
  return /\b(upgrade|improve|enhance|update|modify|change your code|edit your code|self upgrade|self-upgrade|better ui|better memory|add feature|fix yourself)\b/i.test(text || "");
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

function validateUpgradeFiles(files) {
  if (!Array.isArray(files) || files.length === 0) {
    throw new Error("No files supplied.");
  }

  for (const file of files) {
    if (!ALLOWED_UPGRADE_FILES.includes(file.path)) {
      throw new Error(`Forbidden file: ${file.path}`);
    }

    if (typeof file.content !== "string" || file.content.length < 50) {
      throw new Error(`Invalid content for ${file.path}`);
    }

    if (file.path === "server.js") {
      if (!file.content.includes("/chat")) throw new Error("server.js missing /chat.");
      if (!file.content.includes("/generate-image")) throw new Error("server.js missing /generate-image.");
      if (!file.content.includes("app.listen")) throw new Error("server.js missing app.listen.");
    }

    if (file.path === "index.html") {
      if (!file.content.includes("<!DOCTYPE html>")) throw new Error("index.html missing doctype.");
      if (!file.content.includes("sendMessage")) throw new Error("index.html missing sendMessage.");
      if (!file.content.includes("generateImage")) throw new Error("index.html missing image generation.");
    }

    const banned = [
      "process.env.OPENAI_API_KEY =",
      "GITHUB_TOKEN =",
      "eval(",
      "document.cookie",
      "localStorage.clear()"
    ];

    for (const pattern of banned) {
      if (file.content.includes(pattern)) {
        throw new Error(`Risky pattern blocked in ${file.path}: ${pattern}`);
      }
    }
  }
}

app.get("/", (req, res) => {
  res.send("Chloe AI is running.");
});

app.post("/decide-action", async (req, res) => {
  try {
    const {
      message = "",
      history = [],
      memory = "",
      personality = "balanced",
      lastImagePrompt = ""
    } = req.body || {};

    const historyText = Array.isArray(history)
      ? history.slice(-10).map(m => `${m.role}: ${m.content}`).join("\n")
      : "";

    const response = await client.responses.create({
      model: "gpt-4.1-mini",
      instructions: `
You are Chloe's action decision engine.

Return ONLY JSON. No markdown.

Decide what Chloe should do next.

Actions:
- chat: normal reply only
- image: generate an image only
- chat_and_image: reply, then generate an image
- retry_image: regenerate the previous image prompt
- upgrade: prepare an upgrade proposal

Rules:
- Use image/chat_and_image when visual output would genuinely help.
- Use retry_image if John says again, retry, redo, one more, make it cooler, try again, and there is a last image prompt.
- Do not create explicit sexual content.
- Keep image prompts tasteful and non-explicit.
- Improve image prompts so they are detailed and useful.

JSON format:
{
  "action": "chat | image | chat_and_image | retry_image | upgrade",
  "reply": "short natural response to John",
  "imagePrompt": "enhanced image prompt if image is needed, otherwise empty string",
  "upgradeRequest": "upgrade request if action is upgrade, otherwise empty string"
}
`,
      input: `
Personality: ${personalityText(personality)}

Memory:
${memory || "No memory yet."}

Last image prompt:
${lastImagePrompt || "None"}

Recent conversation:
${historyText || "None"}

John says:
${message}
`
    });

    const decision = extractJson(response.output_text || "{}");

    if (!decision.action) {
      throw new Error("No action returned.");
    }

    res.json(decision);
  } catch (err) {
    console.error("DECIDE ACTION ERROR:", err);
    res.status(500).json({
      action: "chat",
      reply: "I hit a decision error, but I’m still here. Try that again.",
      imagePrompt: "",
      upgradeRequest: "",
      error: err.message
    });
  }
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
        intent: "empty",
        reply: "No message or image received."
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
        reply: "Yes — I can prepare an upgrade proposal. You’ll review it before anything is committed."
      });
    }

    const historyText = Array.isArray(history)
      ? history.slice(-14).map(m => `${m.role}: ${m.content}`).join("\n")
      : "";

    const instructions = `
${BASE_PROMPT}

Personality:
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
      prompt: `${personalityText(personality)}\n\nCreate this image:\n${cleanPrompt}\n\nKeep it tasteful and non-explicit.`,
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
      ? history.slice(-16).map(m => `${m.role}: ${m.content}`).join("\n")
      : "";

    const response = await client.responses.create({
      model: "gpt-4.1-mini",
      instructions: `
You are Chloe's proactive upgrade advisor.

Return ONLY valid JSON.

Suggest ONE low-risk improvement to Chloe's app.

Do not include code.
Do not apply changes.
Avoid explicit adult features.
Prefer stability, speed, memory, image usability, UI polish, or error handling.

JSON format:
{
  "title": "short title",
  "reason": "why this helps John",
  "request": "exact upgrade request to send to the upgrade planner"
}
`,
      input: `
Personality: ${personalityText(personality)}

Memory:
${memory || "No saved memory yet."}

Recent conversation:
${historyText || "No recent conversation yet."}
`
    });

    const suggestion = extractJson(response.output_text || "{}");

    if (!suggestion.title || !suggestion.request) {
      throw new Error("Invalid suggestion.");
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
You are Chloe's cautious upgrade planner.

Return ONLY valid JSON. No markdown.

Allowed files:
- server.js
- index.html
- package.json

Rules:
- Return COMPLETE full replacement content only for changed files.
- Preserve chat, image generation, decision engine, memory, personality modes, export, and upgrade tools.
- Do not remove endpoints.
- Do not add secrets.
- Do not create explicit adult/NSFW features.
- Keep upgrades small and safe.
- Prefer frontend/UI changes over backend rewrites unless needed.

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
John requested:
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
      throw new Error("Upgrade proposal was invalid.");
    }

    validateUpgradeFiles(proposal.files);

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

    validateUpgradeFiles(files);

    const results = [];

    for (const file of files) {
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
