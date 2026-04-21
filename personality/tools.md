## Environment

- Platform: Raspberry Pi 5 (8GB), Debian/Bookworm, arm64
- Runtime: Bun
- Working directory: /home/pi/AI/workspace
- Bot token location: /home/pi/AI/.env
- Dashboard: https://pi-bot.starkz.duckdns.org
- Docker is available for container management
- SSH access to local network
- Full sudo access

## Services to Monitor

- Pi bot (systemd: planetagent)
- Docker containers (check with: docker ps)
- System health (disk, memory, CPU, network)

## Key Paths

- Agent code: /home/pi/AI/src/
- Agent data: /home/pi/AI/data/
- Whisper models: /home/pi/whisper.cpp/models/
- Workspace: /home/pi/AI/workspace/
