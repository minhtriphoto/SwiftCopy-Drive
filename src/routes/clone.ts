import express from "express";
import { google } from "googleapis";

const router = express.Router();

function extractFolderId(url: string) {
  const match = url.match(/folders\/([a-zA-Z0-9_-]+)/);
  if (match) return match[1];
  const matchId = url.match(/id=([a-zA-Z0-9_-]+)/);
  if (matchId) return matchId[1];
  return url; // Assume it's an ID if no match
}

import { db } from "../db/index.ts";
import { cloneJobs } from "../db/schema.ts";
import { randomUUID } from "crypto";
import { cloneEngineQueue } from "../engine/cloneEngine.ts";

// Start clone job
router.post("/start", async (req, res) => {
  try {
    const { sourceUrl, sourceId, destinationId, options } = req.body;
    const token = req.headers["x-goog-token"] as string;
    const user = (req as any).user;

    if (!token) return res.status(401).json({ error: "Missing Google Token" });

    const jobId = randomUUID();

    await db.insert(cloneJobs).values({
      id: jobId,
      userId: user.uid,
      sourceUrl,
      sourceId,
      destinationId,
      status: "PENDING",
      options,
    });

    // Add to background queue
    cloneEngineQueue.add(() => processCloneJob(jobId, token, user.uid));

    res.json({ success: true, jobId });
  } catch (err: any) {
    console.error("Start clone error:", err);
    res.status(500).json({ error: err.message });
  }
});
router.post("/analyze", async (req, res) => {
  try {
    const { url } = req.body;
    const token = req.headers["x-goog-token"] as string;
    
    if (!token) {
      return res.status(401).json({ error: "Missing Google Token" });
    }

    const folderId = extractFolderId(url);

    const oauth2Client = new google.auth.OAuth2();
    oauth2Client.setCredentials({ access_token: token });

    const drive = google.drive({ version: 'v3', auth: oauth2Client });

    // 1. Get folder metadata
    const folderRes = await drive.files.get({
      fileId: folderId,
      fields: "id, name, owners, permissions, size, quotaBytesUsed",
      supportsAllDrives: true,
    });

    // 2. Count files inside (just a quick sample or full list)
    // To avoid long delay, we might just fetch the first page. But let's fetch a summary if possible.
    const listRes = await drive.files.list({
      q: `'${folderId}' in parents and trashed = false`,
      fields: "files(id, mimeType, size)",
      pageSize: 1000,
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
    });

    let fileCount = 0;
    let folderCount = 0;
    let totalSize = 0;

    for (const file of listRes.data.files || []) {
      if (file.mimeType === "application/vnd.google-apps.folder") {
        folderCount++;
      } else {
        fileCount++;
        totalSize += parseInt(file.size || "0", 10);
      }
    }

    res.json({ 
      success: true,
      folderId,
      name: folderRes.data.name,
      owner: folderRes.data.owners?.[0]?.displayName || "Unknown",
      fileCount,
      folderCount,
      estimatedSize: totalSize,
    });
  } catch (err: any) {
    console.error("Analyze error:", err);
    res.status(500).json({ error: err.message });
  }
});

export default router;

