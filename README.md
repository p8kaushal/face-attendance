# Face Attendance System 🎯

An AI-powered, real-time facial recognition and geofenced attendance management platform built with SvelteKit 5, MediaPipe, ONNX Runtime, and PostgreSQL.

---

## 📌 Overview

**Face Attendance** eliminates manual roll-calls and proxy check-ins by integrating biometric facial verification with location geofencing and dynamic QR code authentication. Designed with an offline-first architecture, attendees can register their presence seamlessly even in low-connectivity environments.

---

## ✨ Key Features

- **Biometric Face Verification**:
  - Client-side face landmark and planar face alignment using **Google MediaPipe Tasks Vision**.
  - Server-side 512-dimensional facial embedding extraction using **ArcFace (MobileFaceNet)** with **ONNX Runtime**.
  - Cosine similarity matching against registered employee face descriptors.
- **Geofenced Check-In**:
  - Event hosts can define target coordinates (latitude, longitude) and allowable radius (meters).
  - Enforces GPS verification to prevent remote or fraudulent check-ins.
- **Dynamic QR Code Check-In**:
  - Integrated QR scanner for fast event registration and validation.
- **Offline-First Resilience**:
  - Client-side attendance queueing with **Dexie.js (IndexedDB)**.
  - Automatic background synchronization when network connectivity is restored.
- **Role-Based Access Control (RBAC)**:
  - Role management for **Admin**, **Host**, and **Attendee**.
  - Secure credential-based authentication with JWT and optional OAuth (Google, GitHub).
- **Export & Analytics**:
  - Daily and event-specific attendance logs with CSV export functionality.

---

## 🛠️ Tech Stack Discovered

| Layer | Technologies |
|---|---|
| **Framework & UI** | [SvelteKit 2.x](https://kit.svelte.dev/) & [Svelte 5](https://svelte.dev/) (Runes), [Vite](https://vitejs.dev/) |
| **Computer Vision & AI** | [MediaPipe Tasks Vision](https://developers.google.com/mediapipe), [ONNX Runtime Node](https://onnxruntime.ai/) (ArcFace / MobileFaceNet), [QR Scanner](https://github.com/nimiq/qr-scanner) |
| **Database & Cache** | [PostgreSQL](https://www.postgresql.org/) (`pg`), [Dexie.js](https://dexie.org/) (Client-side IndexedDB) |
| **Backend & Security** | Node.js (ES Modules), JWT (`jsonwebtoken`), Node Crypto |
| **Deployment** | `@sveltejs/adapter-node`, Docker / Procfile compatible |

---

## 📂 Project Structure

```text
face-attendance/
├── src/
│   ├── routes/
│   │   ├── +page.svelte              # Main responsive dashboard & camera interface
│   │   ├── +layout.svelte            # Root layout
│   │   └── api/                      # SvelteKit REST API routes
│   │       ├── attendance/           # Check-in, check-out, record & export endpoints
│   │       ├── auth/                 # Login, register, session management
│   │       ├── events/               # Geofenced event creation & QR handling
│   │       └── users/                # User & profile management
│   ├── lib/
│   │   ├── face.js                   # Client-side MediaPipe face detection & cropping
│   │   ├── db.js                     # Client-side Dexie.js offline DB
│   │   ├── api.js                    # Fetch client API wrapper
│   │   └── server/
│   │       ├── db.js                 # PostgreSQL connection pool & schema migrations
│   │       └── face.js               # ONNX Runtime ArcFace embedding extractor
│   ├── app.html                      # HTML document template
│   └── hooks.server.js               # Server request hooks
├── models/                           # ArcFace ONNX model storage (auto-downloaded)
├── static/                           # Public assets, styles, icons
├── legacy-express/                   # Archive: Earlier Express.js backend implementation
├── frontend/                         # Archive: Earlier standalone HTML/JS client
├── .env.example                      # Environment variables template
├── package.json                      # Project dependencies & npm scripts
├── vite.config.js                    # Vite configuration
└── LICENSE                           # MIT License
```

---

## 🚀 Getting Started

### Prerequisites

Ensure you have the following installed:
- [Node.js](https://nodejs.org/) (v18.0.0 or higher recommended)
- [npm](https://www.npmjs.com/) (v9+)
- A [PostgreSQL](https://www.postgresql.org/) database (local or cloud instances such as Neon, Supabase, or Railway)

---

### 1. Installation

Clone the repository and install dependencies:

```bash
git clone https://github.com/p8kaushal/face-attendance.git
cd face-attendance
npm install
```

---

### 2. Environment Configuration

Copy the sample environment file and configure your credentials:

```bash
cp .env.example .env
```

Update `.env` with your values:

```env
PORT=3000
SESSION_SECRET=your-secure-session-secret

# PostgreSQL connection string
DATABASE_URL=postgresql://user:password@localhost:5432/face_attendance

# Admin credentials for initial setup
ADMIN_USERNAME=admin
ADMIN_PASSWORD=your-secure-password

# Optional OAuth credentials
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_CALLBACK_URL=http://localhost:3000/auth/google/callback

GITHUB_CLIENT_ID=
GITHUB_CLIENT_SECRET=
GITHUB_CALLBACK_URL=http://localhost:3000/auth/github/callback
ADMIN_USERS=admin@example.com
```

> **Note**: Database schema tables (`users`, `events`, `attendance`) are automatically verified and created on server startup via `src/lib/server/db.js`.
> 
> **Model Auto-Download**: The pre-trained ArcFace ONNX model (`arcface.onnx`, ~4MB) is automatically downloaded from Hugging Face on the first face embedding extraction if not already present in the `models/` directory.

---

### 3. Running in Development

Start the Vite development server:

```bash
npm run dev
```

Open your browser and navigate to `http://localhost:5173`. Ensure browser camera permissions and location services are enabled when prompted.

---

### 4. Production Build

To build and run the production server using the Node adapter:

```bash
# Build the production bundle
npm run build

# Start the Node.js production server
npm start
```

The application will run on the port specified by `PORT` (defaults to `3000`).

---

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
