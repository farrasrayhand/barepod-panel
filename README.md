# BarePod Panel

**BarePod Panel** adalah platform manajemen web hosting dan container hosting hybrid generasi baru yang aman, terisolasi, dan mudah digunakan.

---

## Fitur Unggulan

- **Fleksibilitas 4 Web Server Engine**:
  - OpenLiteSpeed (OLS + LSCache)
  - Nginx (High Concurrency & Reverse Proxy)
  - Caddy (Automatic HTTPS / Let's Encrypt & HTTP/3)
  - Apache 2.4 (`.htaccess` Compatibility)
- **Multi-Runtime & Framework**:
  - Python (Flask, FastAPI, Django — Python 3.10 s/d 3.12)
  - PHP (Laravel, WordPress, Symfony — PHP 8.1 s/d 8.4)
  - Node.js (Next.js, Express, NestJS, Astro — Node 18, 20, 22 LTS)
  - Go, Rust, Ruby on Rails, Static HTML
- **Otomatisasi CLI Terisolasi (Auto-Switch Runtime)**:
  - Setiap tenant memiliki terminal web mandiri di direktori `/home/<tenant>/apps/<app-name>`.
  - Menjalankan `php -v`, `node -v`, atau `python -v` langsung otomatis sesuai versi website tersebut tanpa konflik antarpengguna.
- **Database Suite Lengkap & Single Sign-On (SSO) Web GUI**:
  - PostgreSQL 16+, MariaDB 11 / MySQL 8, MongoDB 7.0, dan Redis 7.2.
  - Akses Web GUI (DbGate, phpMyAdmin, pgAdmin, Mongo Express) terlindungi di balik reverse proxy internal dan otomatis login tanpa perlu memasukkan password database lagi.
  - Password database di-masking; wajib memasukkan password akun panel terlebih dahulu sebelum dapat menampilkan password plain-text (dengan auto-lock timer 60 detik).
- **File Manager Tradisional pada Container Volume**:
  - Persistent volume mount host-to-container.
  - File manager visual: upload, download, unzip, dan in-browser code editor untuk mengedit `.env` atau script langsung di web browser.
- **GitHub Push-to-Deploy & 1-Click Redeploy**:
  - Webhook otomatis saat push commit ke GitHub (`git pull` + build + zero-downtime reload).
  - Tombol manual redeploy dengan live streaming build logs.
- **Zero-NAT Cloudflare Tunnel**:
  - Cukup masukkan Tunnel Token, domain langsung terhubung tanpa perlu IP publik statis atau konfigurasi port forwarding di router.

---

## Struktur Folder Repositori

```
BarePod-Panel/
├── frontend/             # Dashboard Web UI (React + Vite + TypeScript + Tailwind CSS)
├── backend/              # Core Daemon (Go / Golang)
├── scripts/              # Install scripts untuk VPS (Ubuntu/Debian)
└── README.md
```

## Menjalankan Dashboard (Frontend)

```bash
cd frontend
npm install
npm run dev
```
Buka di browser: **`http://127.0.0.1:5173/`**
