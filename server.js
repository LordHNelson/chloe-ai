import express from "express";
import cors from "cors";
import OpenAI from "openai";

const app = express();
app.use(cors());
app.use(express.json({ limit: "20mb" }));

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const GITHUB_OWNER = process.env.GITHUB_OWNER;
const GITHUB_REPO = process.env.GITHUB_REPO;
const GITHUB_BRANCH = process.env.GITHUB_BRANCH || "main";
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const RENDER_DEPLOY_HOOK_URL = process.env.RENDER_DEPLOY_HOOK_URL;

const ALLOWED_UPGRADE_FILES = ["server.js", "index.html", "package.json"];

const BASE_PROMPT = `
You are Chloe, John's upgraded standalone AI assistant.
You are warm, clever, loyal, playful, useful, and direct.
You help John build, debug, improve, and evolve this app.
If John asks about upgrades, propose practical code changes.
Do not claim you can secretly change files. You propose upgrades and John approves them.
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
    throw new Error(data.message || `GitHub API error: ${res.status}`);
  }

  return data;
}

async function getGithubFile(filePath) {
  const data = await githubRequest(
    `/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${encodeURIComponent(filePath)}?ref=${GITHUB_BRANCH}`
  );

  const content = Buffer.from(data.content || "", "base64").toString("utf8");
  return { content, sha: data.sha };
}

async function updateGithubFile(filePath, content, message) {
  if (!ALLOWED_UPGRADE_FILES.includes(filePath)) {
    throw new Error(`File not allowed for upgrade: ${filePath}`);
  }

  const existing = await getGithubFile(filePath);

  return githubRequest(
    `/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${encodeURIComponent(filePath)}`,
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
  const cleaned = text.replace(/```json/g, "").replace(/```/g, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error("No JSON found in upgrade proposal.");
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
      return res.status(400).json({ reply: "No message or image received." });
    }

    const historyText = Array.isArray(history)
      ? history.slice(-16).map(m => `${m.role}: ${m.content}`).join("\n")
      : "";

    const instructions = `
${BASE_PROMPT}

Personality:
${personalityText(personality)}

Memory:
${memory || "No saved memory yet."}

Recent conversation:
${historyText || "No recent conversation yet."}
`;

    const input = cleanImageUrl
      ? [{
          role: "user",
          content: [
            { type: "input_text", text: cleanMessage || "Please analyse this image." },
            { type: "input_image", image_url: cleanImageUrl }
          ]
        }]
      : `${instructions}\n\nJohn says:\n${cleanMessage}`;

    const response = await client.responses.create({
      model: "gpt-4.1-mini",
      instructions,
      input
    });

    res.json({ reply: response.output_text || "Chloe did not return a response." });
  } catch (err) {
    console.error("CHAT ERROR:", err);
    res.status(500).json({ reply: err.message || "Unknown chat error." });
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
    if (!imageBase64) throw new Error("No image returned.");

    res.json({ image: `data:image/png;base64,${imageBase64}` });
  } catch (err) {
    console.error("IMAGE ERROR:", err);
    res.status(500).json({ error: err.message || "Image generation failed." });
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
Return ONLY valid JSON.
Allowed files: server.js, index.html, package.json.
Do not include markdown fences.
Do not change secrets or environment variables.
JSON shape:
{
  "summary": "short human-readable summary",
  "files": [
    { "path": "server.js", "content": "complete full replacement file content" }
  ]
}
`,
      input: `
John wants this upgrade:
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

    if (!Array.isArray(proposal.files)) {
      throw new Error("Upgrade proposal did not include files.");
    }

    proposal.files.forEach(file => {
      if (!ALLOWED_UPGRADE_FILES.includes(file.path)) {
        throw new Error(`Proposal tried to edit forbidden file: ${file.path}`);
      }
      if (typeof file.content !== "string" || file.content.length < 20) {
        throw new Error(`Invalid content for ${file.path}`);
      }
    });

    res.json(proposal);
  } catch (err) {
    console.error("PROPOSE UPGRADE ERROR:", err);
    res.status(500).json({ error: err.message || "Upgrade proposal failed." });
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
    res.status(500).json({ error: err.message || "Apply upgrade failed." });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("Chloe server running on port " + PORT);
});
