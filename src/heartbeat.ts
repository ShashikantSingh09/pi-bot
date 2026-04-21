import { readFileSync } from "fs";
import { join } from "path";
import { notify } from "./notify";

const CLAUDE_PATH = process.env.CLAUDE_PATH ?? "/home/pi/.local/bin/claude";
const PERSONALITY_DIR = join(import.meta.dir, "..", "personality");
const HEARTBEAT_INTERVAL = 30 * 60 * 1000; // 30 minutes

function getTimeContext(): string {
  const now = new Date();
  const options: Intl.DateTimeFormatOptions = {
    timeZone: "Asia/Kolkata",
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  };
  return `[Current time: ${now.toLocaleString("en-IN", options)}]`;
}

function loadHeartbeatPrompt(): string {
  const parts: string[] = [getTimeContext()];

  // Load identity + soul for personality consistency
  for (const file of ["identity.md", "soul.md"]) {
    try {
      parts.push(readFileSync(join(PERSONALITY_DIR, file), "utf8").trim());
    } catch {}
  }

  // Load heartbeat checklist
  try {
    parts.push(readFileSync(join(PERSONALITY_DIR, "heartbeat.md"), "utf8").trim());
  } catch {
    return "";
  }

  return parts.join("\n\n---\n\n");
}

async function runHeartbeat(): Promise<void> {
  const systemPrompt = loadHeartbeatPrompt();
  if (!systemPrompt) {
    console.log("Heartbeat: no heartbeat.md found, skipping");
    return;
  }

  console.log("Heartbeat: running checks...");

  const args = [
    "--print",
    "--model", "claude-haiku-4-5-20251001",
    "--system-prompt", systemPrompt,
    "--dangerously-skip-permissions",
    "--no-session-persistence",
    "--output-format", "text",
    "Run the heartbeat checklist now. Check each item and report only if something needs attention.",
  ];

  try {
    const proc = Bun.spawn([CLAUDE_PATH, ...args], {
      cwd: "/home/pi/AI/workspace",
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env, NO_COLOR: "1" },
    });

    const [stdout, stderr] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ]);

    const exitCode = await proc.exited;

    if (exitCode !== 0) {
      console.error("Heartbeat: claude failed:", stderr.slice(0, 200));
      return;
    }

    const result = stdout.trim();

    if (!result || result === "HEARTBEAT_OK" || result.includes("HEARTBEAT_OK")) {
      console.log("Heartbeat: all clear");
      return;
    }

    // Something needs attention — notify the boss
    console.log("Heartbeat: alert ->", result.slice(0, 100));
    await notify(result);
  } catch (err) {
    console.error("Heartbeat: error:", err);
  }
}

export function startHeartbeat(): void {
  console.log(`Heartbeat: scheduled every ${HEARTBEAT_INTERVAL / 60000} minutes`);

  // Run first heartbeat after 60 seconds (let bot finish starting)
  setTimeout(() => {
    runHeartbeat();
    // Then run on interval
    setInterval(runHeartbeat, HEARTBEAT_INTERVAL);
  }, 60_000);
}
