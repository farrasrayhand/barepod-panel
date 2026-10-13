#!/bin/bash
# BarePod Panel Custom MOTD / Interactive Terminal Banner

# Clear scrollback if supported
[ -z "${SSH_CONNECTION:-}${SSH_TTY:-}" ] && [ -t 1 ] && printf '\033[3J\033[H\033[2J'

CYAN='\033[36m'
BOLD='\033[1m'
DIM='\033[2m'
BLUE='\033[34m'
GREEN='\033[32m'
PURPLE='\033[35m'
NC='\033[0m'

IP_ADDR=$(ip -4 route get 1 2>/dev/null | sed -n 's/.* src \([0-9.]\+\).*/\1/p' | head -1)
[ -z "$IP_ADDR" ] && IP_ADDR="172.19.1.26"
KERNEL=$(uname -r)
UPTIME=$(uptime -p 2>/dev/null | sed 's/^up //')
USER_NAME=$(whoami)

echo ""
echo -e "  ${CYAN}╭─${NC} ${BOLD}BAREPOD CLOUD PLATFORM${NC} ${DIM}───────────────────────────────────────────${NC}"
echo -e "  ${CYAN}│${NC}"
echo -e "  ${CYAN}│${NC}  ${DIM}•${NC} ${BOLD}Host Node${NC}       : $(hostname) (Ubuntu 24.04 LTS)"
echo -e "  ${CYAN}│${NC}  ${DIM}•${NC} ${BOLD}IPv4 Address${NC}    : ${GREEN}${IP_ADDR}${NC}"
echo -e "  ${CYAN}│${NC}  ${DIM}•${NC} ${BOLD}Panel Web UI${NC}    : ${CYAN}https://${IP_ADDR}:8443/${NC}"
echo -e "  ${CYAN}│${NC}  ${DIM}•${NC} ${BOLD}Linux Kernel${NC}    : ${KERNEL}"
echo -e "  ${CYAN}│${NC}  ${DIM}•${NC} ${BOLD}Shell Session${NC}   : ${PURPLE}${USER_NAME}${NC}"
echo -e "  ${CYAN}│${NC}  ${DIM}•${NC} ${BOLD}System Uptime${NC}   : ${UPTIME}"
echo -e "  ${CYAN}│${NC}"
echo -e "  ${CYAN}╰───────────────────────────────────────────────────────────────────────${NC}"
echo ""
