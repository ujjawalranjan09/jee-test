# PDF Quiz Generator

![License](https://img.shields.io/github/license/ujjawalranjan09/jee-test)
![CI](https://github.com/ujjawalranjan09/jee-test/actions/workflows/ci.yml/badge.svg)
![Python](https://img.shields.io/badge/python-3.11-blue)
![Node](https://img.shields.io/badge/node-18%2B-green)
[![Deploy to Render](https://img.shields.io/badge/Deploy%20to-Render-46E3B7?logo=render)](https://render.com/deploy)

A full-stack web application that converts uploaded PDFs (textbooks, question banks, notes) into interactive, **JEE Main-style timed quizzes** with diagram preservation, scoring, and AI-powered solutions.

> **Live Demo**: [https://pdf-quiz-generator-frontend.onrender.com](https://pdf-quiz-generator-frontend.onrender.com)

---

## ✨ Features

| Feature | Description |
|---------|-------------|
| 📄 **PDF Upload** | Text extraction via PyMuPDF + OCR fallback (Tesseract) for scanned PDFs |
| 🖼️ **Diagram Preservation** | Extracts and displays diagrams alongside their questions |
| 🤖 **AI Quiz Generation** | Up to 60 questions per PDF using batched Gemini/MiMo LLM calls |
| ⏱️ **Timed Quiz** | Configurable 1–180 minute countdown timer |
| 🎯 **Question Palette** | JEE Main-style palette with answered/unanswered/mark-for-review states |
| 📊 **Instant Scoring** | Immediate results with per-question review |
| 💡 **AI Solutions** | On-demand step-by-step LLM solutions for any question |
| 💬 **Contextual Chat** | Follow-up chat per question for deeper understanding |
| 🔑 **Multi-Key API** | Automatic rotation across multiple API keys for rate-limit management |
| 📱 **Mobile Responsive** | Full touch support, collapsible palette drawer, 44px touch targets |
| 🚀 **One-Click Deploy** | Deploy to Render free tier in minutes via `render.yaml` |

---

## 🏗️ Architecture

```
┌─────────────┐     ┌─────────────┐     ┌──────────┐
│   React     │────▶│   FastAPI    │────▶│   LLM    │
│   + Vite    │◀────│   (Python)   │◀────│ (Gemini/ │
│  (SPA)      │     │   REST API   │     │  MiMo)   │
└─────────────┘     └─────────────┘     └──────────┘
       │                    │
       │                    ├── PyMuPDF (text extraction)
       │                    ├── Tesseract (OCR fallback)
       │                    └── Pillow (image processing)
       │
       └── Render Static Site (Frontend)
                            Render Web Service (Backend)
```

### Tech Stack

- **Frontend**: React 18, TypeScript, Vite 6, Vitest
- **Backend**: Python 3.11, FastAPI, Uvicorn
- **LLM**: Google Gemini (multimodal) / Xiaomi MiMo v2.5
- **PDF**: PyMuPDF, Tesseract OCR, Pillow
- **Deployment**: Render (free tier) via Blueprint

---

## 🚀 Quick Start

### Prerequisites

| Tool | Version |
|------|---------|
| Node.js | 18+ |
| Python | 3.11+ |
| Tesseract OCR | Optional (for scanned PDFs) |

### 1. Clone & Setup

```bash
git clone https://github.com/ujjawalranjan09/jee-test.git
cd jee-test
```

### 2. Backend Setup

```bash
cd backend
python -m venv .venv

# Windows
.venv\Scripts\activate
# macOS/Linux
source .venv/bin/activate

pip install -r requirements.txt
cp .env.example .env
```

Edit `backend/.env` and add your API key:

```
MIMO_API_KEY_1=your_key_here
# or LLM_PROVIDER=gemini with GOOGLE_API_KEY
```

Start the backend:

```bash
uvicorn app.main:app --reload --port 8000
```

### 3. Frontend Setup

```bash
cd frontend
npm install
npm run dev
```

Open **[http://localhost:5173](http://localhost:5173)** — the frontend proxies `/api` requests to `http://localhost:8000`.

---

## 🧪 Testing

### Backend (64 tests)

```bash
cd backend
python -m pytest tests/ -v
```

### Frontend (56 tests)

Run individually due to jsdom memory overhead:

```bash
cd frontend
npx vitest run src/test/scoring.test.ts
npx vitest run src/test/QuizPlayer.test.tsx
```

---

## 🚢 Deployment

### One-Click Deploy to Render

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy)

Or follow manual steps:

1. **Push to GitHub**:
   ```bash
   git init && git add . && git commit -m "Initial commit"
   git remote add origin https://github.com/ujjawalranjan09/jee-test.git
   git push -u origin main
   ```

2. **Create a Render account** at https://render.com (free tier works).

3. **Create a Blueprint instance**:
   - Dashboard → **Blueprints** → **New Blueprint Instance**
   - Connect your GitHub repo
   - Render auto-detects `render.yaml`

4. **Add your API key** via Render dashboard:
   - Backend service → **Environment** → **Add Environment Variable**
   - Key: `MIMO_API_KEY_1`, Value: your key
   - Click **Save Changes**

### URL Configuration

| Service | Default URL | Config |
|---------|------------|--------|
| Frontend | `https://pdf-quiz-generator-frontend.onrender.com` | `VITE_API_URL` (frontend env) |
| Backend | `https://pdf-quiz-generator-backend.onrender.com` | `CORS_ORIGINS` (backend env) |

If you rename either service, update both environment variables accordingly.

---

## 📁 Project Structure

```
jee-test/
├── backend/
│   ├── app/
│   │   ├── main.py               # FastAPI app + CORS
│   │   ├── config.py             # Settings + environment config
│   │   ├── routers/              # API endpoints
│   │   │   ├── health.py         # Liveness check
│   │   │   ├── upload.py         # PDF upload
│   │   │   ├── quiz.py           # Quiz generation, solve, chat
│   │   │   ├── admin.py          # Admin endpoints
│   │   │   └── multi_upload.py   # Batch upload
│   │   ├── services/             # Business logic
│   │   │   ├── pdf_extractor.py  # Text + diagram extraction
│   │   │   ├── llm_client.py     # Gemini/MiMo client with key rotation
│   │   │   └── quiz_generator.py # Quiz construction
│   │   └── models/
│   │       └── schemas.py        # Pydantic request/response models
│   ├── tests/                    # 64 pytest tests
│   ├── fixtures/                 # Test PDF files
│   ├── requirements.txt
│   └── .env.example
├── frontend/
│   ├── src/
│   │   ├── components/
│   │   │   ├── Upload/           # PDF upload with drag-drop
│   │   │   ├── ApiKey/           # API key manager
│   │   │   ├── Quiz/             # QuizPlayer, Palette, Timer
│   │   │   ├── Score/            # Score display
│   │   │   ├── Review/           # Review + solutions
│   │   │   └── Chat/             # Per-question chat
│   │   ├── hooks/                # useQuizSession, useTimer, useApiKeys
│   │   ├── api/client.ts         # Typed API client
│   │   ├── types/index.ts        # TypeScript interfaces
│   │   └── utils/scoring.ts      # Client-side scoring logic
│   ├── public/                   # Static assets
│   └── package.json
├── .github/
│   ├── workflows/ci.yml          # GitHub Actions CI
│   ├── ISSUE_TEMPLATE/           # Bug report + feature request templates
│   └── PULL_REQUEST_TEMPLATE.md  # PR template
├── render.yaml                   # Render Blueprint deployment
├── LICENSE                       # MIT License
└── README.md
```

---

## 📡 API Endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/health` | GET | Liveness check / warm-up |
| `/api/upload` | POST | Upload PDF, extract text + diagrams |
| `/api/quiz/generate` | POST | Generate quiz from extracted content |
| `/api/quiz/solve` | POST | Get step-by-step solution for a question |
| `/api/quiz/chat` | POST | Contextual chat about a question |

### Environment Variables

See `backend/.env.example` and `frontend/.env.example` for all configurable options.

---

## 🤝 Contributing

We welcome contributions! Please see:

- **[CONTRIBUTING.md](CONTRIBUTING.md)** — detailed setup, coding guidelines, PR process
- **[CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md)** — community standards
- **[SECURITY.md](SECURITY.md)** — vulnerability reporting

### Quick Contribution Flow

1. Fork the repo
2. Create a feature branch (`git checkout -b feat/amazing-feature`)
3. Commit your changes (`git commit -m 'feat: add amazing feature'`)
4. Push (`git push origin feat/amazing-feature`)
5. Open a Pull Request

---

## 📄 License

Distributed under the **MIT License**. See [LICENSE](LICENSE) for more information.

---

## 🙏 Acknowledgements

- [Google Gemini API](https://ai.google.dev/) — multimodal LLM
- [Xiaomi MiMo](https://api.xiaomimimo.com) — cost-effective LLM alternative
- [Render](https://render.com) — free hosting
- [FastAPI](https://fastapi.tiangolo.com/) — Python web framework
- [PyMuPDF](https://pymupdf.readthedocs.io/) — PDF processing
- [Tesseract OCR](https://github.com/tesseract-ocr/tesseract) — OCR engine

---

## 📬 Contact

**Ujjawal Ranjan** — ujjawalranjan09@gmail.com

Project Link: [https://github.com/ujjawalranjan09/jee-test](https://github.com/ujjawalranjan09/jee-test)