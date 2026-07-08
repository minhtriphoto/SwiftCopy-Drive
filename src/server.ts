import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { createServer } from "http";
import { Server } from "socket.io";
import { db } from "./db/index.ts";
import { users, oauthTokens, cloneJobs, cloneLogs } from "./db/schema.ts";
import { eq, desc } from "drizzle-orm";
import PQueue from "p-queue";
import { adminAuth } from "./lib/firebase-admin.ts";

const app = express();
const httpServer = createServer(app);
export const io = new Server(httpServer, {
  cors: { origin: "*" },
});

const PORT = 3000;

app.use(express.json());

// Middleware to check auth
const requireAuth = async (req: any, res: any, next: any) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Unauthorized: Missing token" });
  }

  const token = authHeader.split("Bearer ")[1];
  try {
    const decodedToken = await adminAuth.verifyIdToken(token);
    req.user = decodedToken;
    next();
  } catch (error) {
    console.error("Error verifying Firebase ID token:", error);
    return res.status(401).json({ error: "Unauthorized: Invalid token" });
  }
};

// API: Health check
app.get("/api/health", (req, res) => {
  res.json({ status: "ok" });
});

// Import API routes
import cloneRoutes from "./routes/clone.ts";
app.use("/api/clone", requireAuth, cloneRoutes);

async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  httpServer.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();

