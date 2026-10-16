import * as fs from "node:fs";
import * as path from "node:path";
import { spawnSync } from "node:child_process";

const isWindows = process.platform === "win32";

interface Target {
  entry: string;
  outfile: string;
}

const targets: Target[] = [
  { entry: "src/cli.ts", outfile: isWindows ? "jev.exe" : "jev" },
  { entry: "src/mcp.ts", outfile: isWindows ? "jev-mcp.exe" : "jev-mcp" },
];

/**
 * Safely clears a target path on Windows even if an active process is executing it.
 * Windows NT allows renaming an executing binary, enabling compilers to recreate the original filename.
 */
function prepareTarget(targetPath: string): void {
  if (!fs.existsSync(targetPath)) return;

  try {
    // Attempt standard removal first if file is not currently locked
    fs.unlinkSync(targetPath);
  } catch (err: any) {
    if (isWindows && (err.code === "EPERM" || err.code === "EBUSY")) {
      // File is currently locked by a running process.
      // Move it aside with atomic rename so bun compile can write the new executable.
      const timestamp = Date.now();
      const oldPath = `${targetPath}.old.${timestamp}`;
      try {
        fs.renameSync(targetPath, oldPath);
        console.log(`[compile] Target '${targetPath}' is currently in use. Moved aside to '${oldPath}'.`);
      } catch (renameErr) {
        console.error(`[compile] Warning: Could not rename locked target '${targetPath}':`, renameErr);
      }
    } else {
      console.error(`[compile] Warning: Failed to clean '${targetPath}':`, err.message);
    }
  }
}

/**
 * Cleans up stale .old.* binaries whose processes have exited.
 */
function cleanupStaleOldBinaries(dir: string): void {
  try {
    const files = fs.readdirSync(dir);
    for (const file of files) {
      if (file.includes(".old.")) {
        const fullPath = path.join(dir, file);
        try {
          fs.unlinkSync(fullPath);
        } catch {
          // Still locked by a running process; ignore and leave for future compile run
        }
      }
    }
  } catch {
    // Ignore directory read errors
  }
}

async function main(): Promise<void> {
  const rootDir = process.cwd();
  cleanupStaleOldBinaries(rootDir);

  for (const t of targets) {
    const fullOutPath = path.resolve(rootDir, t.outfile);
    prepareTarget(fullOutPath);

    console.log(`[compile] Compiling ${t.entry} -> ${t.outfile}...`);
    const res = spawnSync("bun", ["build", "--compile", "--outfile", t.outfile, t.entry], {
      stdio: "inherit",
      shell: isWindows,
    });

    if (res.status !== 0) {
      console.error(`[compile] Compilation failed for ${t.outfile} with exit code ${res.status}`);
      process.exit(res.status ?? 1);
    }
  }

  cleanupStaleOldBinaries(rootDir);
  console.log("[compile] Compilation complete!");
}

main().catch((err) => {
  console.error("[compile] Fatal error:", err);
  process.exit(1);
});
