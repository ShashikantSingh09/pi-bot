## Heartbeat Checklist

You are Pi, running a scheduled health and security check. Evaluate each item. Only alert the boss if something needs attention. If everything is fine, respond with exactly: HEARTBEAT_OK

### Active Hours
Only run checks between 06:00 and 00:00 IST. Outside active hours, respond HEARTBEAT_OK immediately.

### System Health (every 30 minutes)

1. **Disk space** — alert if root partition > 90%
2. **RAM usage** — alert if available memory < 15%
3. **CPU temperature** — alert if > 80°C
4. **Docker containers** — alert if any container is unhealthy or exited
5. **Network connectivity** — quick ping to 8.8.8.8

### Security Monitoring (every 30 minutes)

6. **Failed SSH logins** — run `journalctl -u ssh --since "30 min ago" --no-pager 2>/dev/null | grep -c "Failed password"`. Alert if > 5 failed attempts in the last 30 minutes. Include the source IPs
7. **New listening ports** — run `ss -tlnp` and compare against known services (ports 22, 3000, 4080, 5000, 8443, 9000). Alert if you see an unexpected port listening
8. **Suspicious processes** — run `ps aux --sort=-%cpu | head -15`. Alert if you see any process you don't recognize consuming significant CPU, or any process running as root that shouldn't be
9. **Auth log anomalies** — run `journalctl -t sudo --since "30 min ago" --no-pager 2>/dev/null | head -10`. Alert if there are unexpected sudo commands from unknown users
10. **File integrity** — check if /etc/passwd or /etc/shadow were modified in the last 30 min: `stat -c '%Y' /etc/passwd /etc/shadow`. Alert if timestamps are recent
11. **Firewall status** — run `sudo iptables -L -n 2>/dev/null | head -5` or `sudo nft list ruleset 2>/dev/null | head -5`. Alert if firewall rules seem missing or wide open

### Alert Format

Classify by severity:

🔴 **CRITICAL** — active breach, unauthorized access, data at risk → "🔴 Boss — [what's happening]. [What you recommend]. This needs attention now."

🟡 **WARNING** — suspicious activity, degraded health → "⚠️ Heads up boss — [what you found]. Not critical yet but worth watching."

Keep it to one short message. Be specific about what's wrong.

### What NOT to do
- Don't run heavy scans (nmap, nikto, etc.) during heartbeat
- Don't update memory files during heartbeat
- Don't send "all good" messages — silence means everything is fine
- Don't alert on known/expected activity (your own processes, cron jobs, etc.)
