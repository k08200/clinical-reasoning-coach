# Clinical Reasoning Coach

Socratic AI for medical diagnostic reasoning training.
**No API key required to run** — works out of the box in mock mode.

## Quick Start (무료, API 키 불필요)

```bash
git clone https://github.com/k08200/clinical-reasoning-coach
cd clinical-reasoning-coach

cp .env.example .env
# .env 기본값: LLM_PROVIDER=mock (수정 불필요)

docker compose up --build
```

→ http://localhost:3000

## LLM Provider 선택

| Provider | 비용 | 설정 |
|----------|------|------|
| `mock` (기본) | **무료, 오프라인** | 설정 불필요 |
| `ollama` | **무료, 로컬 LLM** | Ollama 설치 필요 |
| `claude` | 유료 (Anthropic) | API 키 필요 |

### Ollama 설정 (무료 로컬 LLM)
```bash
brew install ollama
ollama pull llama3.2
ollama serve

# .env 수정:
LLM_PROVIDER=ollama
OLLAMA_BASE_URL=http://host.docker.internal:11434
```

### Claude 설정 (최고 품질)
```bash
# .env 수정:
LLM_PROVIDER=claude
ANTHROPIC_API_KEY=sk-ant-...
```

## 데모

회원가입 후 **"Generate Demo Case"** 클릭:

> _58세 남성, 급성 흉통 + 발한_

AI는 절대 "STEMI"를 말하지 않습니다. 소크라틱 질문만으로 유도합니다:
- "활력징후에서 가장 우려되는 소견은 무엇인가요?"
- "이 나이대에서 흉통의 생명을 위협하는 원인은 무엇인지 먼저 생각해보세요."
- "Troponin이 경계치라는 것이 ACS를 배제할 수 있나요?"

## 아키텍처

```
Next.js 15 (React 19 + TypeScript + Tailwind)
    ↕ SSE 스트리밍
FastAPI (Python, async SQLAlchemy)
    ↕
LLM Provider (mock | ollama | claude)
    ↕
PostgreSQL 16
```

### 핵심 파일

| 파일 | 역할 |
|------|------|
| `backend/app/services/mock_provider.py` | 룰 기반 소크라틱 코치 (무료) |
| `backend/app/services/claude_provider.py` | Claude adaptive thinking + 스트리밍 |
| `backend/app/services/ollama_provider.py` | 로컬 Ollama LLM |
| `backend/app/services/socratic_coach.py` | 소크라틱 엔진 — 진단 절대 불누설 |
| `backend/app/services/reasoning_analyzer.py` | 학생 추론 품질 분석 |
| `backend/app/services/case_generator.py` | 동적 케이스 생성 |
| `backend/app/routers/sessions.py` | SSE 스트림 엔드포인트 |
| `frontend/src/components/ReasoningMap.tsx` | ReactFlow 추론 여정 시각화 |
| `frontend/src/components/TokenCounter.tsx` | 실시간 토큰 카운터 |

### 매 턴 처리 흐름

```
학생 메시지 입력
    → Claude/Ollama/Mock: 소크라틱 질문 스트리밍 (SSE)
    → 백그라운드: 추론 품질 분석 + 인지 편향 감지
    → DB 저장: 점수, 추론 맵, 편향 이벤트
```

## 감지하는 인지 편향

| 편향 | 설명 |
|------|------|
| **Anchoring** | 첫 인상에 고착 |
| **Premature closure** | 불충분한 근거로 결론 |
| **Availability** | 최근 본 케이스로 편향 |
| **Framing effect** | 문제 제시 방식에 끌려감 |

## 개발

```bash
# 백엔드 테스트 (17개)
cd backend && pip install -r requirements.txt
python -m pytest tests/ -v

# 프론트엔드 테스트
cd frontend && npm install && npm test
```

## API

```
POST /api/auth/register
POST /api/auth/token
POST /api/cases/generate/demo   ← 58yo 흉통 케이스
POST /api/sessions               ← 세션 시작
POST /api/sessions/{id}/stream   ← SSE 소크라틱 스트림
GET  /api/analytics/me           ← 편향 패턴 분석
```

API 문서: http://localhost:8000/docs
