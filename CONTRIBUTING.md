# Contributing to PDF Quiz Generator

Thank you for considering contributing! We welcome all forms of contribution — bug reports, feature requests, documentation improvements, and code changes.

## Table of Contents

- [Code of Conduct](#code-of-conduct)
- [Getting Started](#getting-started)
- [Development Setup](#development-setup)
- [Project Structure](#project-structure)
- [Coding Guidelines](#coding-guidelines)
- [Testing](#testing)
- [Pull Request Process](#pull-request-process)
- [Issue Reporting](#issue-reporting)

## Code of Conduct

This project adheres to the [Contributor Covenant](CODE_OF_CONDUCT.md). By participating, you agree to uphold this code.

## Getting Started

1. Fork the repository.
2. Clone your fork:
   ```bash
   git clone https://github.com/your-username/jee-test.git
   ```
3. Add the upstream remote:
   ```bash
   git remote add upstream https://github.com/ujjawalranjan09/jee-test.git
   ```

## Development Setup

### Prerequisites

- Node.js 18+
- Python 3.11+
- Tesseract OCR (optional, for scanned PDFs)

### Backend Setup

```bash
cd backend
python -m venv .venv
.venv\Scripts\activate   # Windows
source .venv/bin/activate  # Linux/macOS
pip install -r requirements.txt
cp .env.example .env
# Edit .env to add your API key
uvicorn app.main:app --reload --port 8000
```

### Frontend Setup

```bash
cd frontend
npm install
npm run dev
```

Open [http://localhost:5173](http://localhost:5173) — the frontend proxies `/api` to the backend.

## Project Structure

```
├── backend/
│   ├── app/
│   │   ├── main.py              # FastAPI app entry point
│   │   ├── config.py            # Settings + environment config
│   │   ├── routers/             # API endpoints (health, upload, quiz)
│   │   ├── services/            # PDF processing, LLM client, quiz gen
│   │   └── models/schemas.py    # Pydantic models
│   ├── tests/                   # pytest suite (64 tests)
│   └── requirements.txt
├── frontend/
│   ├── src/
│   │   ├── components/          # Upload, Quiz, Score, Review, Chat
│   │   ├── hooks/               # useQuizSession, useTimer, useApiKeys
│   │   ├── api/client.ts        # Typed HTTP client
│   │   └── types/index.ts       # TypeScript interfaces
│   └── package.json
└── render.yaml                  # Render Blueprint deployment
```

## Coding Guidelines

### Python (Backend)

- **Style**: Follow [PEP 8](https://peps.python.org/pep-0008/).
- **Types**: Use type annotations everywhere.
- **Imports**: Group as standard lib → third-party → local, alphabetically.
- **Async**: Use `async def` for I/O-bound endpoints; keep CPU-bound work in thread pools.

### TypeScript / React (Frontend)

- **Style**: ESLint + Prettier defaults (single quotes, trailing commas).
- **Types**: Avoid `any` — prefer `unknown` and proper type guards.
- **Components**: Functional components with hooks. Keep components small and focused.
- **CSS**: Use inline styles or CSS modules (no CSS-in-JS library).

### Commit Messages

Use [Conventional Commits](https://www.conventionalcommits.org/):

- `feat:` — new feature
- `fix:` — bug fix
- `docs:` — documentation only
- `refactor:` — code change that neither fixes a bug nor adds a feature
- `test:` — adding or fixing tests
- `chore:` — build/config changes

## Testing

### Backend

```bash
cd backend
python -m pytest tests/ -v
```

The test suite includes 64 tests covering PDF processing, quiz generation, and API endpoints.

### Frontend

Run tests individually due to jsdom overhead:

```bash
cd frontend
npx vitest run src/test/scoring.test.ts
npx vitest run src/test/QuizPlayer.test.tsx
# ... etc
```

> **Note**: If you add new features, include corresponding tests. Test fixtures go in `backend/fixtures/`.

## Pull Request Process

1. **Create an issue** first discussing the change you want to make (unless it's a trivial fix).
2. **Create a feature branch** from `main`:
   ```bash
   git checkout -b feat/my-feature
   ```
3. **Write code and tests** following the guidelines above.
4. **Run the tests** locally and ensure they pass.
5. **Update documentation** if your change introduces new behavior or configuration.
6. **Open a pull request** against `main` with a clear title and description.
   - Reference the related issue: `Closes #123`
   - Describe what the change does and why.
   - Include screenshots for UI changes.
7. **Address review feedback** — maintainers may request changes.

## Issue Reporting

Use the provided issue templates:

- [🐛 Bug Report](https://github.com/ujjawalranjan09/jee-test/issues/new?template=bug_report.md)
- [✨ Feature Request](https://github.com/ujjawalranjan09/jee-test/issues/new?template=feature_request.md)

A good bug report includes:
- Clear steps to reproduce
- Expected vs. actual behavior
- Screenshots if applicable
- Browser / environment details