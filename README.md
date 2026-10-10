# BarePod Panel

**BarePod Panel** adalah hybrid web hosting & container management platform yang menggabungkan:
- **Kemudahan CloudPanel**: UI cepat, modern, dan intuitif.
- **Isolasi Multi-User ala Virtualmin**: Tenant terisolasi total, terminal CLI otomatis mengikuti versi runtime masing-masing (`php -v`, `node -v`, `python -v`).
- **Container Simplicity ala Easypanel**: Dukungan Docker Pods, multi-database, dan Zero-NAT Cloudflare Tunnel.
- **Aestetika Modern ala SumoPod**: Minimalis, rapi, dan mudah dipahami.

---

## Fitur Utama

- **Web Server Engines**:
  - OpenLiteSpeed (OLS + LSCache)
  - Nginx (High Concurrency)
  - Caddy (Automatic HTTPS)
  - Apache 2.4 (`.htaccess` Compatibility)
- **Multi-Runtime & Frameworks**:
  - Python (Flask, FastAPI, Django)
  - PHP (Laravel, WordPress, Symfony - PHP 8.1 - 8.4)
  - Node.js (Next.js, Express, NestJS, Astro)
  - Go, Rust, Ruby on Rails
  - Docker Container Pods
- **Database Lengkap**:
  - PostgreSQL 16+
  - MariaDB 11 / MySQL 8
  - MongoDB 7 (Document DB)
  - Redis 7 (In-Memory Cache)
- **Zero-NAT Cloudflare Tunnel**:
  - Cukup masukkan Tunnel Token, domain otomatis terhubung tanpa perlu IP publik statis atau konfigurasi port router.
- **Isolated Web Terminal (PTY)**:
  - Setiap tenant memiliki sandbox CLI mandiri berbasis cgroups & Linux namespaces.

---

## Struktur Folder

```
BarePod-Panel/
├── frontend/             # React + Vite + TypeScript + Tailwind CSS (SumoPod UI)
├── backend/              # Go Core Daemon (Docker API, PTY Terminal, Caddy Manager)
└── README.md
```

## Memulai Dashboard Frontend

```bash
cd frontend
npm install
npm run dev
```
Buka di browser: `http://127.0.0.1:5173/`
