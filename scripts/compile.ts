import * as fs from "node:fs";
import * as path from "node:path";
import { spawnSync } from "node:child_process";

const isWindows = process.platform === "win32";

interface CompileJob {
  entry: string;
  outfile: string;
  bunTarget?: string;
}

function resolveJobs(): CompileJob[] {
  const args = process.argv.slice(2);
  const hasLinux = args.includes("--linux") || args.includes("-l");
  const hasAll = args.includes("--all") || args.includes("-a");
  const hasDarwin = args.includes("--darwin") || args.includes("--macos");

  if (hasAll) {
    return [
      { entry: "src/cli.ts", outfile: isWindows ? "systemone.exe" : "systemone" },
      { entry: "src/mcp.ts", outfile: isWindows ? "systemone-mcp.exe" : "systemone-mcp" },
      { entry: "src/cli.ts", outfile: "systemone-linux-x64", bunTarget: "bun-linux-x64" },
      { entry: "src/mcp.ts", outfile: "systemone-mcp-linux-x64", bunTarget: "bun-linux-x64" },
      { entry: "src/cli.ts", outfile: "systemone-linux-arm64", bunTarget: "bun-linux-arm64" },
      { entry: "src/mcp.ts", outfile: "systemone-mcp-linux-arm64", bunTarget: "bun-linux-arm64" },
      { entry: "src/cli.ts", outfile: "systemone-darwin-arm64", bunTarget: "bun-darwin-arm64" },
      { entry: "src/mcp.ts", outfile: "systemone-mcp-darwin-arm64", bunTarget: "bun-darwin-arm64" },
    ];
  }

  if (hasLinux) {
    return [
      { entry: "src/cli.ts", outfile: "systemone-linux-x64", bunTarget: "bun-linux-x64" },
      { entry: "src/mcp.ts", outfile: "systemone-mcp-linux-x64", bunTarget: "bun-linux-x64" },
    ];
  }

  if (hasDarwin) {
    return [
      { entry: "src/cli.ts", outfile: "systemone-darwin-arm64", bunTarget: "bun-darwin-arm64" },
      { entry: "src/mcp.ts", outfile: "systemone-mcp-darwin-arm64", bunTarget: "bun-darwin-arm64" },
    ];
  }

  return [
    { entry: "src/cli.ts", outfile: isWindows ? "systemone.exe" : "systemone" },
    { entry: "src/mcp.ts", outfile: isWindows ? "systemone-mcp.exe" : "systemone-mcp" },
  ];
}

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

  const jobs = resolveJobs();
  console.log(`[compile] Starting compilation for ${jobs.length} target(s)...`);

  for (const job of jobs) {
    const fullOutPath = path.resolve(rootDir, job.outfile);
    prepareTarget(fullOutPath);

    const buildArgs = ["build", "--compile"];
    if (job.bunTarget) {
      buildArgs.push(`--target=${job.bunTarget}`);
    }
    buildArgs.push("--outfile", job.outfile, job.entry);

    console.log(`[compile] Compiling ${job.entry} -> ${job.outfile} ${job.bunTarget ? `(${job.bunTarget})` : ""}...`);
    const res = spawnSync("bun", buildArgs, {
      stdio: "inherit",
      shell: isWindows,
    });

    if (res.status !== 0) {
      console.error(`[compile] Compilation failed for ${job.outfile} with exit code ${res.status}`);
      process.exit(res.status ?? 1);
    }
  }

  // Create backward-compatible aliases and short CLI names
  const aliasPairs: [string, string][] = isWindows
    ? [
        ["systemone.exe", "s1.exe"],
        ["systemone.exe", "jev.exe"],
        ["systemone.exe", "jev-windows-x64.exe"],
        ["systemone-mcp.exe", "s1-mcp.exe"],
        ["systemone-mcp.exe", "jev-mcp.exe"],
        ["systemone-mcp.exe", "jev-mcp-windows-x64.exe"],
      ]
    : [
        ["systemone", "s1"],
        ["systemone", "jev"],
        ["systemone-mcp", "s1-mcp"],
        ["systemone-mcp", "jev-mcp"],
      ];

  for (const [src, dest] of aliasPairs) {
    const srcPath = path.resolve(rootDir, src);
    const destPath = path.resolve(rootDir, dest);
    if (fs.existsSync(srcPath)) {
      prepareTarget(destPath);
      try {
        fs.copyFileSync(srcPath, destPath);
      } catch (err) {
        console.warn(`[compile] Warning copying alias '${dest}':`, err);
      }
    }
  }

  // Cross-platform release alias copies
  for (const [src, dest] of [
    ["systemone-linux-x64", "jev-linux-x64"],
    ["systemone-mcp-linux-x64", "jev-mcp-linux-x64"],
    ["systemone-linux-arm64", "jev-linux-arm64"],
    ["systemone-mcp-linux-arm64", "jev-mcp-linux-arm64"],
    ["systemone-darwin-arm64", "jev-darwin-arm64"],
    ["systemone-mcp-darwin-arm64", "jev-mcp-darwin-arm64"],
  ]) {
    const srcPath = path.resolve(rootDir, src);
    const destPath = path.resolve(rootDir, dest);
    if (fs.existsSync(srcPath)) {
      prepareTarget(destPath);
      try {
        fs.copyFileSync(srcPath, destPath);
      } catch (err) {
        console.warn(`[compile] Warning copying alias '${dest}':`, err);
      }
    }
  }

  cleanupStaleOldBinaries(rootDir);
  console.log("[compile] Compilation complete!");
}

main().catch((err) => {
  console.error("[compile] Fatal error:", err);
  process.exit(1);
});
