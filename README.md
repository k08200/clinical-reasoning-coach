# Clinical Reasoning Coach

Socratic AI for medical diagnostic reasoning training.

## What It Does

- **Never gives answers** — AI coach uses Socratic questions only
- **Extended thinking** — Claude internally analyzes student reasoning before asking each question
- **Cognitive bias detection** — anchoring, premature closure, availability, framing
- **Reasoning map** — visual graph of diagnostic journey
- **Token counter** — real-time display of thinking + response tokens

## Quick Start

```bash
# 1. Clone and configure
cp .env.example .env
# Edit .env and add your ANTHROPIC_API_KEY

# 2. Run
docker compose up --build

# 3. Open
# App:  http://localhost:3000
# API:  http://localhost:8000/docs
```

## Demo

After signup, click **"Generate Demo Case"** to get the canonical case:

> _58-year-old male with acute chest pain and diaphoresis_

The AI will NEVER say "STEMI" or confirm any diagnosis. It guides through:
- Vital signs interpretation
- Differential diagnosis generation
- Risk stratification
- Evidence-based questioning

## Architecture

```
frontend (Next.js 15, React 19, TypeScript)
    ↓ SSE streaming
backend (FastAPI, Python 3.12)
    ↓ Extended thinking + streaming
Claude API (claude-opus-4-7, adaptive thinking)
    ↓ SQLAlchemy async
PostgreSQL 16
```

### Key Files

| File | Purpose |
|------|---------|
| `backend/app/services/claude_service.py` | Claude API with adaptive thinking + streaming |
| `backend/app/services/socratic_coach.py` | Socratic engine — never reveals diagnosis |
| `backend/app/services/reasoning_analyzer.py` | Extended thinking analysis of student responses |
| `backend/app/services/case_generator.py` | Dynamic case generation via Claude |
| `backend/app/routers/sessions.py` | SSE streaming endpoint |
| `frontend/src/app/sessions/[id]/page.tsx` | Main coaching interface |
| `frontend/src/components/ReasoningMap.tsx` | ReactFlow diagnostic journey visualization |
| `frontend/src/components/TokenCounter.tsx` | Real-time token display |

### API Endpoints

```
POST /api/auth/register
POST /api/auth/token
GET  /api/auth/me

POST /api/cases/generate        # Dynamic case via Claude
POST /api/cases/generate/demo   # 58yo male chest pain demo
GET  /api/cases

POST /api/sessions              # Start coaching session
POST /api/sessions/{id}/stream  # SSE: Socratic response stream
POST /api/sessions/{id}/complete
GET  /api/sessions

GET  /api/analytics/me
```

### Claude API Usage

Each coaching turn uses TWO Claude calls:
1. **Stream:** Socratic response to student (streamed via SSE)
2. **Analyze:** Extended thinking analysis of student reasoning (background)

Both use `thinking: { type: "adaptive" }` — the model decides when deep reasoning is needed.

## Development

### Backend tests
```bash
cd backend
pip install -r requirements.txt
pytest --cov=app
```

### Frontend tests
```bash
cd frontend
npm install
npm test
```

### Backend only (no Docker)
```bash
cd backend
export ANTHROPIC_API_KEY=...
export DATABASE_URL=postgresql+asyncpg://...
uvicorn app.main:app --reload
```

## Cognitive Biases Tracked

| Bias | Description |
|------|-------------|
| **Anchoring** | Fixed on first impression |
| **Premature closure** | Settled without sufficient evidence |
| **Availability** | Biased toward recently-seen cases |
| **Framing effect** | Influenced by problem presentation |
| **Search satisficing** | Stopped searching after one answer |
| **Commission** | Bias toward action over watchful waiting |
