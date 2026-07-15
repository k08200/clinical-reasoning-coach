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

## Production 설정 체크리스트

운영 환경에서는 기본 개발 설정으로 시작하지 않도록 앱 시작 시 guard가 동작합니다.

```bash
APP_ENV=production
SECRET_KEY=<long-random-secret>
DATABASE_AUTO_CREATE_TABLES=false
CORS_ORIGINS=["https://your-frontend.example.com"]
ADMIN_BOOTSTRAP_TOKEN=<one-time-random-setup-token>
EDUCATIONAL_USE_CONSENT_VERSION=2026-07-15
REVIEWER_CREDENTIAL_VALID_DAYS=365
LLM_PROVIDER=ollama  # 또는 claude
```

- `APP_ENV=production`에서 기본 `SECRET_KEY=change-me-in-production`이면 백엔드가 시작되지 않습니다.
- `APP_ENV=production`에서는 `DATABASE_AUTO_CREATE_TABLES=false`를 설정하고 Alembic migration을 적용해야 합니다.
- `APP_ENV=production`에서는 데모용 `LLM_PROVIDER=mock`으로 시작할 수 없습니다. 검증된 로컬 `ollama` 또는 API 키가 설정된 `claude`를 명시적으로 선택해야 합니다.
- 첫 관리자 계정은 일반 회원가입/로그인 후 `/admin/bootstrap`에서 `ADMIN_BOOTSTRAP_TOKEN`을 입력해 생성합니다.
- 첫 admin이 생성된 뒤에는 bootstrap endpoint가 닫히므로, 이후 reviewer/admin 권한은 `/admin/users`에서 관리합니다.
- `EDUCATIONAL_USE_CONSENT_VERSION`을 변경하면 모든 기존 사용자는 현재 교육 전용 사용 동의 화면에서 재확인하기 전까지 기능을 사용할 수 없습니다. 변경 전 동의 버전과 시각은 사용자 감사 데이터에 보존됩니다.
- 검토자 자격은 `REVIEWER_CREDENTIAL_VALID_DAYS` 내에 재검증되어야 합니다. 만료된 검토자는 케이스 검토와 임상 안전 이벤트 처리를 할 수 없으며, 해당 자격으로 검토된 케이스는 재검토 전까지 학습자에게 공개되지 않습니다.
- `LLM_PROVIDER=claude`를 선택하면 `ANTHROPIC_API_KEY`가 반드시 필요합니다.
- `/health`는 프로세스 생존 여부만, `/ready`는 실제 LLM 제공자 준비 상태를 반환합니다. Ollama는 서버 연결과 지정 모델 설치를 확인하고, Claude는 최대 1토큰의 비임상 요청으로 키ㆍ네트워크ㆍ모델 접근성을 확인합니다. 결과는 기본 5분간 캐시됩니다.
- 운영 Docker healthcheck는 `/ready`를 사용하므로, 실제 모델 제공자가 준비되지 않으면 backend가 healthy로 판정되지 않습니다.
- Docker smoke가 실패하면 `docker compose ps`로 `db`, `redis`, `backend`, `frontend`가 모두 떠 있는지 먼저 확인하세요.

### DB migration

운영 DB 스키마는 Alembic으로 관리합니다.

```bash
(cd backend && alembic -c alembic.ini upgrade head)
```

모델 변경 후 새 migration을 만들 때:

```bash
(cd backend && alembic -c alembic.ini revision --autogenerate -m "describe change")
```

### Production Docker deployment

```bash
cp .env.production.example .env.production
# Replace every placeholder, then apply migrations before starting application containers.
(cd backend && set -a && source ../.env.production && set +a && alembic -c alembic.ini upgrade head)
docker compose --env-file .env.production -f docker-compose.production.yml up --build -d
```

`docker-compose.production.yml` removes development source mounts and reload mode, keeps PostgreSQL and Redis off the host network, and waits for backend/frontend health checks. Put the frontend behind an HTTPS reverse proxy; `NEXT_PUBLIC_API_URL` and `CORS_ORIGINS` must use the deployed public origins.

## 케이스 라이브러리 (5종)

| 케이스 | 전문과 | 난이도 | 핵심 인지 함정 |
|--------|--------|--------|----------------|
| STEMI / ACS | Internal Medicine | Medium | 경계치 트로포닌이 ACS를 배제한다고 착각 |
| Septic Shock (패혈성 쇼크) | Internal Medicine | Medium | AMS를 뇌졸중으로 앵커링 |
| Pulmonary Embolism (폐색전증) | Emergency Medicine | Hard | 수술 후 항응고제로 PE 안심 |
| DKA (당뇨병성 케톤산증) | Internal Medicine | Easy | 복통을 외과적 응급으로 오진 |
| Ischemic Stroke (허혈성 뇌졸중) | Neurology | Medium | Last Known Normal 시간 계산 오류 |

회원가입 후 **"Generate Demo Case"** 클릭 → 5가지 케이스 중 랜덤 선택

AI는 절대 진단명을 말하지 않습니다. 케이스별 전문 소크라틱 질문으로만 유도합니다:

**패혈증 케이스 예시:**
- "Lactate 수치가 조직 관류에 대해 무엇을 말해주나요?"
- "항생제 투여 전에 반드시 먼저 해야 할 것은 무엇인가요?"

**뇌졸중 케이스 예시:**
- "Last Known Normal 시간과 증상 발견 시간의 차이가 왜 중요한가요?"
- "이 환자의 tPA 투여 가능 시간은 언제까지인가요?"

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
| `frontend/src/app/analytics/page.tsx` | 개인별 추론 성과/편향 대시보드 |
| `frontend/src/components/ReasoningMap.tsx` | ReactFlow 추론 여정 시각화 |
| `frontend/src/components/TokenCounter.tsx` | 실시간 토큰 카운터 |
| `scripts/smoke-api.mjs` | 회원가입→로그인/토큰 갱신→세션→SSE→완료 API smoke test |

### 매 턴 처리 흐름

```
학생 메시지 입력
    → Claude/Ollama/Mock: 소크라틱 질문 스트리밍 (SSE)
    → 스트림 완료 전: 추론 품질 분석 + 인지 편향 감지
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
# 백엔드 테스트
(cd backend && pip install -r requirements.txt)
(cd backend && python -m pytest tests/ -v)

# 프론트엔드 테스트
(cd frontend && npm install && npm test)

# API smoke test (백엔드가 localhost:8000에서 실행 중이어야 함)
# 최초 관리자 설정 토큰이 .env의 ADMIN_BOOTSTRAP_TOKEN과 같아야 합니다.
SMOKE_ADMIN_BOOTSTRAP_TOKEN=<ADMIN_BOOTSTRAP_TOKEN> node scripts/smoke-api.mjs
```

스모크 테스트는 빈 개발 DB에서 관리자 생성/토큰 갱신 → 데모 케이스 생성 → 임상 검토 승인 → 학습자 세션/SSE → 코치 출력 가드레일 검토 → 완료까지를 검증합니다. 또한 실제 환자 신호를 입력했을 때 학생 메시지 저장 없이 세션을 잠그고, 검토자만 고위험 감사 이벤트를 해결할 수 있는지도 검증합니다. 이미 만든 테스트 관리자를 재사용해 반복 실행하려면 `SMOKE_ADMIN_EMAIL=<existing-admin-email>`을 함께 지정하세요.

## API

```
POST /api/auth/register
POST /api/auth/token
POST /api/auth/refresh
POST /api/auth/admin/bootstrap  ← 첫 admin setup token 검증
GET  /api/auth/users            ← admin 전용 사용자 목록
PATCH /api/auth/users/{id}/role ← admin 전용 역할 변경
POST /api/cases/generate/demo   ← 5종 케이스 중 랜덤 선택
POST /api/cases/generate        ← 전문과/난이도 지정 생성
POST /api/sessions               ← 세션 시작
POST /api/sessions/{id}/stream   ← SSE 소크라틱 스트림
POST /api/sessions/{id}/complete ← 세션 완료 + 최종 점수 계산
GET  /api/sessions/{id}          ← 세션 상태 + 추론 맵 조회
GET  /api/analytics/me           ← 편향 패턴 + 전문과별 성적 분석
```

API 문서: http://localhost:8000/docs
