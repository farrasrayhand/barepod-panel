#!/bin/bash
# BarePod Panel Custom MOTD / Interactive Terminal Banner

# Clear scrollback if supported
[ -z "${SSH_CONNECTION:-}${SSH_TTY:-}" ] && [ -t 1 ] && printf '\033[3J\033[H\033[2J'

CYAN='\033[1;36m'
BLUE='\033[1;34m'
GREEN='\033[1;32m'
PURPLE='\033[1;35m'
AMBER='\033[1;33m'
BOLD='\033[1m'
DIM='\033[2m'
NC='\033[0m'

IP_ADDR=$(ip -4 route get 1 2>/dev/null | sed -n 's/.* src \([0-9.]\+\).*/\1/p' | head -1)
[ -z "$IP_ADDR" ] && IP_ADDR="172.19.1.26"
KERNEL=$(uname -r)
UPTIME=$(uptime -p 2>/dev/null | sed 's/^up //')
USER_NAME=$(whoami)

echo ""
echo -e "${CYAN}  ____                  ____           _${NC}"
echo -e "${CYAN} | __ )  __ _ _ __ ___ |  _ \ ___   __| |${NC}"
echo -e "${CYAN} |  _ \ / _\` | '__/ _ \| |_) / _ \ / _\` |${NC}"
echo -e "${CYAN} | |_) | (_| | | |  __/|  __/ (_) | (_| |${NC}"
echo -e "${CYAN} |____/ \__,_|_|  \___||_|   \___/ \__,_|${NC}"
echo ""
echo -e "  ${BOLD}BarePod Cloud Platform${NC} ${DIM}• High-Performance Node${NC}"
echo -e "  ${DIM}─────────────────────────────────────────────────────────────${NC}"
echo -e "  💻  OS & Kernel    : Ubuntu 24.04 LTS (Noble) • ${KERNEL}"
echo -e "  🏠  Hostname       : $(hostname) (LXC Node)"
echo -e "  💡  IP Address     : ${GREEN}${IP_ADDR}${NC}"
echo -e "  🌐  Panel UI       : ${CYAN}https://${IP_ADDR}:8443/${NC}"
echo -e "  👤  Shell User     : ${PURPLE}${USER_NAME}${NC} (interactive PTY)"
echo -e "  ⏰  Host Uptime    : ${UPTIME}"
echo -e "  ${DIM}─────────────────────────────────────────────────────────────${NC}"
echo ""
