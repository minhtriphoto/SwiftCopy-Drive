import React, { useEffect, useState } from "react";
import { initAuth, googleSignIn, logout, getAccessToken } from "./lib/firebase.ts";
import { User } from "firebase/auth";
import { Files, LogOut, Settings, Play, Database, HardDrive, History, File as FileIcon, Search, CheckSquare, Settings2, RotateCcw } from "lucide-react";
import { cn } from "./lib/utils.ts";
import { io } from "socket.io-client";

const socket = io();

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [idToken, setIdToken] = useState<string | null>(null);
  const [isLoggingIn, setIsLoggingIn] = useState(true);

  useEffect(() => {
    const unsubscribe = initAuth(
      async (u, t) => {
        setUser(u);
        setToken(t);
        const idT = await u.getIdToken();
        setIdToken(idT);
        setIsLoggingIn(false);
      },
      () => {
        setUser(null);
        setToken(null);
        setIdToken(null);
        setIsLoggingIn(false);
      }
    );
    return () => unsubscribe();
  }, []);

  const handleLogin = async () => {
    try {
      setIsLoggingIn(true);
      const res = await googleSignIn();
      if (res) {
        setUser(res.user);
        setToken(res.accessToken);
        const idT = await res.user.getIdToken();
        setIdToken(idT);
      }
    } catch (err) {
      console.error(err);
      setIsLoggingIn(false);
    }
  };

  const handleLogout = async () => {
    await logout();
    setUser(null);
    setToken(null);
    setIdToken(null);
  };

  return (
    <div className="min-h-screen bg-neutral-50 dark:bg-neutral-900 text-neutral-900 dark:text-neutral-100 flex flex-col font-sans">
      <header className="h-16 border-b border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-950 flex items-center justify-between px-6 shrink-0">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center text-white">
            <Files size={18} />
          </div>
          <h1 className="font-semibold text-lg tracking-tight">SwiftCopy Drive</h1>
        </div>
        
        <div className="flex items-center gap-4">
          {user ? (
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2">
                <img src={user.photoURL || ""} alt={user.displayName || ""} className="w-8 h-8 rounded-full bg-neutral-200" />
                <span className="text-sm font-medium">{user.displayName}</span>
              </div>
              <button onClick={handleLogout} className="p-2 text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800 rounded-md transition-colors">
                <LogOut size={18} />
              </button>
            </div>
          ) : (
            <button 
              onClick={handleLogin}
              disabled={isLoggingIn}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-md transition-colors disabled:opacity-50 flex items-center gap-2"
            >
              {isLoggingIn ? "Loading..." : "Sign in with Google"}
            </button>
          )}
        </div>
      </header>

      <main className="flex-1 overflow-y-auto lg:overflow-hidden">
        {user && token && idToken ? (
          <Dashboard token={token} idToken={idToken} user={user} />
        ) : (
          <div className="h-full flex flex-col items-center justify-center p-8 text-center max-w-md mx-auto">
            <div className="w-16 h-16 rounded-2xl bg-blue-100 dark:bg-blue-900/30 text-blue-600 flex items-center justify-center mb-6">
              <Files size={32} />
            </div>
            <h2 className="text-2xl font-semibold mb-2">Welcome to SwiftCopy</h2>
            <p className="text-neutral-500 dark:text-neutral-400 mb-8">
              Clone entire Google Drive folders from public or shared links directly to your personal Drive securely and efficiently.
            </p>
            <button 
              onClick={handleLogin}
              disabled={isLoggingIn}
              className="px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg shadow-sm transition-all hover:shadow-md disabled:opacity-50 w-full"
            >
              Get Started
            </button>
          </div>
        )}
      </main>
    </div>
  );
}

function Dashboard({ token, idToken, user }: { token: string; idToken: string; user: User }) {
  const [sourceUrl, setSourceUrl] = useState("");
  const [destUrl, setDestUrl] = useState("");
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isCloning, setIsCloning] = useState(false);
  const [analysisResult, setAnalysisResult] = useState<any>(null);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);

  const [jobProgress, setJobProgress] = useState<any>(null);
  const [logs, setLogs] = useState<any[]>([]);

  useEffect(() => {
    if (!activeJobId) return;

    const onProgress = (data: any) => {
      setJobProgress((prev: any) => ({ ...prev, ...data }));
    };

    const onLog = (log: any) => {
      setLogs((prev) => [log, ...prev].slice(0, 100)); // keep last 100
    };

    socket.on(`job_${activeJobId}`, onProgress);
    socket.on(`job_${activeJobId}_log`, onLog);

    return () => {
      socket.off(`job_${activeJobId}`, onProgress);
      socket.off(`job_${activeJobId}_log`, onLog);
    };
  }, [activeJobId]);

  const handleStartClone = async () => {
    if (!analysisResult || !destUrl) return;
    setIsCloning(true);
    try {
      const destId = destUrl.match(/folders\/([a-zA-Z0-9_-]+)/)?.[1] || destUrl.match(/id=([a-zA-Z0-9_-]+)/)?.[1] || destUrl;
      const res = await fetch("/api/clone/start", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${idToken}`,
          "X-Goog-Token": token
        },
        body: JSON.stringify({
          sourceUrl,
          sourceId: analysisResult.folderId,
          destinationId: destId,
          options: {
            concurrentThreads: 3
          }
        })
      });
      const data = await res.json();
      if (res.ok) {
        setActiveJobId(data.jobId);
      } else {
        alert("Error: " + data.error);
      }
    } catch (err) {
      console.error(err);
      alert("Failed to start clone job");
    } finally {
      setIsCloning(false);
    }
  };

  const handleAnalyze = async () => {
    if (!sourceUrl) return;
    setIsAnalyzing(true);
    try {
      const res = await fetch("/api/clone/analyze", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${idToken}`,
          "X-Goog-Token": token
        },
        body: JSON.stringify({ url: sourceUrl })
      });
      const data = await res.json();
      if (res.ok) {
        setAnalysisResult(data);
      } else {
        alert("Error: " + data.error);
      }
    } catch (err) {
      console.error(err);
      alert("Failed to analyze URL");
    } finally {
      setIsAnalyzing(false);
    }
  };

  return (
    <div className="min-h-full flex flex-col lg:flex-row">
      {/* LEFT COLUMN: SOURCE & SETTINGS */}
      <div className="w-full lg:w-1/2 border-b lg:border-b-0 lg:border-r border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-950 flex flex-col lg:h-full">
        <div className="p-4 lg:p-6 border-b border-neutral-200 dark:border-neutral-800">
          <h2 className="text-lg font-medium mb-4 flex items-center gap-2">
            <Database size={18} className="text-blue-500" />
            Source Configuration
          </h2>
          
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-1">
                Public/Shared Google Drive Link
              </label>
              <div className="flex gap-2">
                <input 
                  type="text" 
                  value={sourceUrl}
                  onChange={(e) => setSourceUrl(e.target.value)}
                  placeholder="https://drive.google.com/drive/folders/..." 
                  className="flex-1 min-w-0 px-3 py-2 bg-neutral-50 dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
                <button 
                  onClick={handleAnalyze}
                  disabled={isAnalyzing || !sourceUrl}
                  className="px-4 py-2 bg-neutral-900 dark:bg-white text-white dark:text-neutral-900 text-sm font-medium rounded-md hover:bg-neutral-800 dark:hover:bg-neutral-100 transition-colors shrink-0 disabled:opacity-50"
                >
                  {isAnalyzing ? "Analyzing..." : "Analyze"}
                </button>
              </div>
            </div>

            {analysisResult && (
              <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-md p-4 mt-4">
                <h3 className="font-medium text-sm text-blue-900 dark:text-blue-100 mb-2">Analysis Result</h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm">
                  <div className="text-neutral-500">Folder Name:</div>
                  <div className="font-medium truncate">{analysisResult.name}</div>
                  <div className="text-neutral-500">Owner:</div>
                  <div className="font-medium truncate">{analysisResult.owner}</div>
                  <div className="text-neutral-500">Files / Folders:</div>
                  <div className="font-medium">{analysisResult.fileCount} / {analysisResult.folderCount}</div>
                  <div className="text-neutral-500">Estimated Size:</div>
                  <div className="font-medium">{(analysisResult.estimatedSize / 1024 / 1024).toFixed(2)} MB</div>
                </div>
              </div>
            )}

            <div>
              <label className="block text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-1">
                Destination Folder ID or URL
              </label>
              <div className="flex gap-2">
                <input 
                  type="text" 
                  value={destUrl}
                  onChange={(e) => setDestUrl(e.target.value)}
                  placeholder="https://drive.google.com/drive/folders/..." 
                  className="flex-1 min-w-0 px-3 py-2 bg-neutral-50 dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>
            </div>
          </div>
        </div>

        <div className="flex-1 lg:overflow-y-auto p-4 lg:p-6">
          <div className="space-y-8">
            <section>
              <h3 className="text-sm font-medium text-neutral-900 dark:text-neutral-100 uppercase tracking-wider mb-4 flex items-center gap-2">
                <Settings2 size={16} className="text-neutral-400" />
                Smart Filters
              </h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {['All Files', 'Only PDF', 'Only Images', 'Only Videos', 'Only Docs', 'Only PPT', 'Only XLSX', 'Only ZIP'].map(filter => (
                  <label key={filter} className="flex items-center gap-2 p-2 border border-neutral-200 dark:border-neutral-800 rounded-md cursor-pointer hover:bg-neutral-50 dark:hover:bg-neutral-900 transition-colors">
                    <input type="radio" name="filter" className="text-blue-600 focus:ring-blue-500" defaultChecked={filter === 'All Files'} />
                    <span className="text-sm font-medium">{filter}</span>
                  </label>
                ))}
              </div>
            </section>

            <section>
              <h3 className="text-sm font-medium text-neutral-900 dark:text-neutral-100 uppercase tracking-wider mb-4">Skip Filters</h3>
              <div className="space-y-3">
                <label className="flex items-center gap-2">
                  <input type="checkbox" className="rounded text-blue-600 focus:ring-blue-500" />
                  <span className="text-sm">Skip files larger than 100MB</span>
                </label>
                <label className="flex items-center gap-2">
                  <input type="checkbox" className="rounded text-blue-600 focus:ring-blue-500" />
                  <span className="text-sm">Skip duplicate files (Skip)</span>
                </label>
              </div>
            </section>

            <section>
              <h3 className="text-sm font-medium text-neutral-900 dark:text-neutral-100 uppercase tracking-wider mb-4">Duplicate Handler</h3>
              <select className="w-full px-3 py-2 bg-neutral-50 dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                <option>Skip existing</option>
                <option>Rename new (file (1).ext)</option>
                <option>Replace existing</option>
                <option>Keep both</option>
              </select>
            </section>
          </div>
        </div>

        <div className="p-4 border-t border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-900">
          <button 
            onClick={handleStartClone}
            disabled={!analysisResult || !destUrl || isCloning}
            className="w-full py-3 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg shadow-sm flex items-center justify-center gap-2 transition-colors disabled:opacity-50"
          >
            <Play size={18} fill="currentColor" />
            {isCloning ? "Starting..." : "Start Clone"}
          </button>
        </div>
      </div>

      {/* RIGHT COLUMN: PROGRESS & HISTORY */}
      <div className="w-full lg:w-1/2 bg-neutral-50 dark:bg-neutral-900 flex flex-col lg:h-full">
        <div className="p-4 lg:p-6 border-b border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-950">
          <h2 className="text-lg font-medium mb-4 flex items-center gap-2">
            <RotateCcw size={18} className="text-green-500" />
            Active Job Progress
          </h2>
          
          <div className="bg-neutral-100 dark:bg-neutral-800/50 rounded-lg p-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium">
                {jobProgress?.status || (activeJobId ? "Initializing..." : "Waiting...")}
              </span>
              <span className="text-sm text-neutral-500">
                {analysisResult && jobProgress?.copied !== undefined
                  ? Math.round((jobProgress.copied / analysisResult.fileCount) * 100)
                  : 0}%
              </span>
            </div>
            <div className="w-full h-2 bg-neutral-200 dark:bg-neutral-700 rounded-full overflow-hidden">
              <div 
                className="h-full bg-blue-500 rounded-full transition-all duration-300" 
                style={{ width: `${analysisResult && jobProgress?.copied !== undefined ? Math.round((jobProgress.copied / analysisResult.fileCount) * 100) : 0}%` }}
              ></div>
            </div>
            {jobProgress?.currentFile && (
              <div className="text-xs text-neutral-500 mt-2 truncate">
                Copying: {jobProgress.currentFile}
              </div>
            )}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mt-4 pt-4 border-t border-neutral-200 dark:border-neutral-700">
              <div>
                <div className="text-xs text-neutral-500 mb-1">Copied</div>
                <div className="font-mono font-medium">{jobProgress?.copied || 0}</div>
              </div>
              <div>
                <div className="text-xs text-neutral-500 mb-1">Failed</div>
                <div className="font-mono font-medium text-red-500">{jobProgress?.failed || 0}</div>
              </div>
              <div>
                <div className="text-xs text-neutral-500 mb-1">Total Size</div>
                <div className="font-mono font-medium">
                  {analysisResult ? (analysisResult.estimatedSize / 1024 / 1024).toFixed(2) : 0} MB
                </div>
              </div>
              <div>
                <div className="text-xs text-neutral-500 mb-1">ETA</div>
                <div className="font-mono font-medium">--:--</div>
              </div>
            </div>
          </div>
        </div>

        <div className="flex-1 lg:overflow-y-auto p-4 lg:p-6">
          <h3 className="text-sm font-medium text-neutral-900 dark:text-neutral-100 uppercase tracking-wider mb-4 flex items-center gap-2">
            <History size={16} className="text-neutral-400" />
            Activity Log
          </h3>
          <div className="space-y-2">
            {!activeJobId ? (
              <div className="text-sm text-neutral-500 italic text-center py-8">
                No active clone job. Enter a link and click Analyze to start.
              </div>
            ) : logs.length === 0 ? (
              <div className="text-sm text-neutral-500 italic text-center py-8">
                Waiting for logs...
              </div>
            ) : (
              logs.map((log, i) => (
                <div key={i} className="text-sm border-l-2 pl-3 py-1 border-blue-500">
                  <span className={`font-semibold mr-2 ${
                    log.type === "SUCCESS" ? "text-green-600" :
                    log.type === "ERROR" ? "text-red-600" : "text-blue-600"
                  }`}>{log.type}</span>
                  <span className="text-neutral-700 dark:text-neutral-300">{log.message}</span>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
