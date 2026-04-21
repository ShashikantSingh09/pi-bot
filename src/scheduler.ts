import { readFileSync } from "fs";
import { join } from "path";
import { notify } from "./notify";

const CLAUDE_PATH = process.env.CLAUDE_PATH ?? "/home/pi/.local/bin/claude";
const PERSONALITY_DIR = join(import.meta.dir, "..", "personality");

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

function loadBriefingPrompt(): string {
  const parts: string[] = [getTimeContext()];

  for (const file of ["identity.md", "soul.md", "user.md", "tools.md"]) {
    try {
      parts.push(readFileSync(join(PERSONALITY_DIR, file), "utf8").trim());
    } catch {}
  }

  return parts.join("\n\n---\n\n");
}

/**
 * Run the morning briefing — uses Sonnet for quality, sends result to Telegram
 */
async function runMorningBriefing(): Promise<void> {
  console.log("Scheduler: running morning briefing...");

  const systemPrompt = loadBriefingPrompt();

  const briefingTask = `Good morning boss. Time for your daily briefing. Gather and report the following:

1. **Lucknow weather** — fetch current conditions from: https://api.open-meteo.com/v1/forecast?latitude=26.8467&longitude=80.9462&current=temperature_2m,relative_humidity_2m,wind_speed_10m,weather_code&wind_speed_unit=kmh&timezone=Asia%2FKolkata

2. **System status** — check disk, RAM, CPU temp, Docker containers. Quick summary only

3. **Security intel** — check the data files at /home/pi/briefing-dashboard/data/ for any security news (security-news.json). Summarize top 3 items if present

4. **AI news** — check /home/pi/briefing-dashboard/data/ for AI news (ai-news.json). Top 3 items if present

5. **Market intel** — check /home/pi/briefing-dashboard/data/market-intel.json. Any critical items

6. **Competitor watch** — check /home/pi/briefing-dashboard/data/competitor-news.json. Top items if present

Format this as a natural morning briefing. You're talking to the boss on Telegram — keep it conversational, not a bullet-point report. Lead with weather and system health, then the intel. End with the dashboard link: https://pi-bot.starkz.duckdns.org

Keep it under 2000 characters. This is a morning briefing, not a novel.`;

  const args = [
    "--print",
    "--model", "claude-sonnet-4-6",
    "--system-prompt", systemPrompt,
    "--dangerously-skip-permissions",
    "--no-session-persistence",
    "--output-format", "text",
    briefingTask,
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
      console.error("Scheduler: briefing failed:", stderr.slice(0, 200));
      await notify("⚠️ Morning briefing failed to generate. Check the logs.");
      return;
    }

    const result = stdout.trim();
    if (result) {
      await notify(result);
      console.log("Scheduler: morning briefing sent");
    } else {
      console.error("Scheduler: empty briefing response");
    }
  } catch (err) {
    console.error("Scheduler: briefing error:", err);
  }
}

/**
 * Calculate ms until next occurrence of a given hour:minute in IST
 */
function msUntilIST(hour: number, minute: number): number {
  const now = new Date();
  // Get current time in IST
  const istNow = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Kolkata" }));
  const target = new Date(istNow);
  target.setHours(hour, minute, 0, 0);

  // If we've already passed this time today, schedule for tomorrow
  if (istNow >= target) {
    target.setDate(target.getDate() + 1);
  }

  // Convert back to absolute time
  const diff = target.getTime() - istNow.getTime();
  return diff;
}

export function startScheduler(): void {
  // Schedule morning briefing at 7:00 AM IST
  const msUntil7AM = msUntilIST(7, 0);
  const hoursUntil = (msUntil7AM / 3600000).toFixed(1);
  console.log(`Scheduler: morning briefing in ${hoursUntil}h (7:00 AM IST)`);

  setTimeout(() => {
    runMorningBriefing();
    // Then repeat every 24 hours
    setInterval(runMorningBriefing, 24 * 60 * 60 * 1000);
  }, msUntil7AM);
}
