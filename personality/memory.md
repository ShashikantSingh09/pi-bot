## Long-Term Memory

This file contains durable facts, preferences, and patterns learned from conversations with the boss. The agent updates this file automatically as it learns.

### Boss Preferences

- Prefers direct, no-BS communication — no filler, no fluff
- Wants results reported, not process narrated
- Wants morning briefings at 7 AM via Telegram with: Lucknow weather, system status, security intel, AI news, market intel, competitor watch
- Wants Telegram alerts when system goes critical (disk >90%, RAM >85%, CPU >80°C, service down)
- Located in **Lucknow, India** — use Lucknow for weather
- Email: (configured locally)

### Known Systems & Services

- **Raspberry Pi 5 (8GB)** — Debian/Bookworm, arm64, runtime: Bun
- **Main dashboard**: https://pi-bot.starkz.duckdns.org (port 4080)
- **SecuriScan Pro app**: http://192.168.68.106:3000
- **Secondary service**: http://192.168.68.106:5000 (unknown purpose)
- **Pi-hole**: 192.168.68.112:8443
- **Portainer**: 192.168.68.112:9000
- **Market research dashboard**: https://pi-bot.starkz.duckdns.org/market-research/
- **SecuriScan gap analysis**: https://pi-bot.starkz.duckdns.org/market-research/securiscan-report.html
- **Kanban tracker**: https://pi-bot.starkz.duckdns.org/market-research/tracker.html
- 4 Docker containers running (all healthy as of 2026-04-22)
- Bot token: /home/pi/AI/.env
- Agent code: /home/pi/AI/src/
- Agent data: /home/pi/AI/data/
- Whisper models: /home/pi/whisper.cpp/models/

### Recurring Tasks

- **7 AM daily** — push morning briefing to Telegram (weather Lucknow, system status, security intel, AI news, market intel, competitor watch)
- **Every 10 min** — system health monitoring (disk, RAM, CPU temp, Pi, Docker containers)
- **Every 5 min** — nmap network scan for app discovery, saved to data/discovered-apps.json
- **6 AM daily** — data fetch/refresh for dashboard content

### Lessons Learned

- 2026-04-22: nmap app detection was broken — needed `-Pn` flag because ICMP ping is blocked on 192.168.68.106. Also removed `-sV` (version detection) to avoid timeouts.
- 2026-04-22: Disk hit 97% — cleared 3.9 GB of pip/apt cache and old kernel headers. Now at ~84%. Monitor proactively.
- 2026-04-22: Boss clarified nmap/app detection enhancement belongs on securiscan-report.html, NOT the main dashboard. Don't mix features into the wrong dashboard.
- Morning briefings were running (6 AM data fetch) but never pushed to Telegram — boss had to ask for updates manually. Fixed: 7 AM push added.
