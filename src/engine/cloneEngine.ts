import { TaskQueue } from "./queue.ts";
import { google } from "googleapis";
import { db } from "../db/index.ts";
import { cloneJobs, cloneLogs } from "../db/schema.ts";
import { eq } from "drizzle-orm";
import { randomUUID } from "crypto";
import { io } from "../server.ts";

export const cloneEngineQueue = new TaskQueue({ concurrency: 1 });

export async function processCloneJob(jobId: string, accessToken: string, userId: string) {
  try {
    await updateJobStatus(jobId, "SCANNING");
    
    const jobRecord = await db.select().from(cloneJobs).where(eq(cloneJobs.id, jobId));
    if (!jobRecord.length) return;
    const job = jobRecord[0];

    const oauth2Client = new google.auth.OAuth2();
    oauth2Client.setCredentials({ access_token: accessToken });
    const drive = google.drive({ version: 'v3', auth: oauth2Client });

    await logActivity(jobId, "INFO", "Started scanning source folder", job.sourceId || undefined);

    // Get all files
    const allFiles = await scanFolder(drive, job.sourceId!, (job.options as any)?.selectedSubfolders);
    
    await db.update(cloneJobs)
      .set({ totalFiles: allFiles.length, status: "COPYING" })
      .where(eq(cloneJobs.id, jobId));
    
    await logActivity(jobId, "INFO", `Found ${allFiles.length} files to copy`);

    // We will use a dedicated queue for copying files
    const copyQueue = new TaskQueue({ concurrency: (job.options as any)?.concurrentThreads || 3 });
    
    let copied = 0;
    let failed = 0;
    let skipped = 0;

    // A mapping from source folder ID to destination folder ID
    const folderMapping = new Map<string, string>();
    
    const options = job.options as any;
    if (options?.wrapInFolder && options?.sourceName) {
      try {
        const createdRoot = await drive.files.create({
          requestBody: {
            name: options.sourceName,
            mimeType: "application/vnd.google-apps.folder",
            parents: [job.destinationId!],
          },
          supportsAllDrives: true,
        });
        folderMapping.set(job.sourceId!, createdRoot.data.id!);
        await logActivity(jobId, "SUCCESS", `Created root folder wrapper: ${options.sourceName}`, createdRoot.data.id!);
      } catch (err: any) {
        await logActivity(jobId, "ERROR", `Failed to create root folder wrapper: ${err.message}`);
        folderMapping.set(job.sourceId!, job.destinationId!);
      }
    } else {
      folderMapping.set(job.sourceId!, job.destinationId!);
    }

    // Separate folders and files
    const folders = allFiles.filter(f => f.mimeType === "application/vnd.google-apps.folder");
    const files = allFiles.filter(f => f.mimeType !== "application/vnd.google-apps.folder");

    // Process folders sequentially to ensure parent folders are created before child folders
    for (const folder of folders) {
      try {
        const parentId = folder.resolvedParentId || job.sourceId!;
        let destParentId = folderMapping.get(parentId) || job.destinationId!;
        const created = await drive.files.create({
          requestBody: {
            name: folder.name,
            mimeType: "application/vnd.google-apps.folder",
            parents: [destParentId],
          },
          supportsAllDrives: true,
        });
        folderMapping.set(folder.id!, created.data.id!);
        await logActivity(jobId, "SUCCESS", `Created folder: ${folder.name}`, created.data.id!);
      } catch (e: any) {
        failed++;
        await logActivity(jobId, "ERROR", `Failed to create folder ${folder.name}: ${e.message}`, folder.id!);
      }
    }

    for (const file of files) {
      copyQueue.add(async () => {
        try {
          // Resolve parent
          const parentId = file.resolvedParentId || job.sourceId!;
          
          // Copy file
          let destParentId = folderMapping.get(parentId) || job.destinationId!;
          const copiedFile = await drive.files.copy({
            fileId: file.id!,
            requestBody: {
              parents: [destParentId],
            },
            supportsAllDrives: true,
          });
          copied++;
          
          // Emit realtime event
          io.emit(`job_${jobId}`, {
            type: "progress",
            copied,
            failed,
            skipped,
            currentFile: file.name
          });

          await logActivity(jobId, "SUCCESS", `Copied file: ${file.name}`, copiedFile.data.id!);
        } catch (e: any) {
          failed++;
          await logActivity(jobId, "ERROR", `Failed to copy ${file.name}: ${e.message}`, file.id!);
        }
      });
    }

    await copyQueue.onIdle();

    await db.update(cloneJobs)
      .set({ status: "COMPLETED", copiedFiles: copied, failedFiles: failed, skippedFiles: skipped })
      .where(eq(cloneJobs.id, jobId));

    await logActivity(jobId, "SUCCESS", "Clone job completed successfully");
    io.emit(`job_${jobId}`, { type: "completed", copied, failed, skipped });

  } catch (err: any) {
    console.error("Job Error:", err);
    await updateJobStatus(jobId, "FAILED");
    await logActivity(jobId, "ERROR", `Job failed: ${err.message}`);
  }
}

async function updateJobStatus(jobId: string, status: string) {
  await db.update(cloneJobs).set({ status }).where(eq(cloneJobs.id, jobId));
  io.emit(`job_${jobId}`, { type: "status", status });
}

async function logActivity(jobId: string, type: string, message: string, fileId?: string) {
  const log = { id: randomUUID(), jobId, type, message, fileId };
  await db.insert(cloneLogs).values(log);
  io.emit(`job_${jobId}_log`, log);
}

// Recursively scan folder
async function scanFolder(drive: any, folderId: string, allowedSubfolders?: string[], isRoot = true) {
  let allFiles: any[] = [];
  let pageToken = undefined;

  do {
    const res = await drive.files.list({
      q: `'${folderId}' in parents and trashed = false`,
      fields: "nextPageToken, files(id, name, mimeType, parents, size)",
      pageToken: pageToken,
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
    });
    
    for (const file of res.data.files || []) {
      const fileWithParent = { ...file, resolvedParentId: folderId };
      if (isRoot && allowedSubfolders) {
        if (file.mimeType === "application/vnd.google-apps.folder" && !allowedSubfolders.includes(file.id!)) {
          continue; // Skip unselected subfolders
        }
      }
      
      allFiles.push(fileWithParent);
      if (file.mimeType === "application/vnd.google-apps.folder") {
        const subFiles = await scanFolder(drive, file.id!, undefined, false);
        allFiles.push(...subFiles);
      }
    }
    pageToken = res.data.nextPageToken;
  } while (pageToken);

  return allFiles;
}
