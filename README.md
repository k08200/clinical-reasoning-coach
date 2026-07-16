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
CLINICAL_REVIEW_MINIMUM_DISTINCT_REVIEWERS=2
RATE_LIMIT_ENABLED=true
LLM_PROVIDER=ollama  # 또는 claude
```

- `APP_ENV=production`에서 기본 `SECRET_KEY=change-me-in-production`이면 백엔드가 시작되지 않습니다.
- `APP_ENV=production`에서는 `DATABASE_AUTO_CREATE_TABLES=false`를 설정하고 Alembic migration을 적용해야 합니다.
- `APP_ENV=production`에서는 데모용 `LLM_PROVIDER=mock`으로 시작할 수 없습니다. 검증된 로컬 `ollama` 또는 API 키가 설정된 `claude`를 명시적으로 선택해야 합니다.
- 첫 관리자 계정은 일반 회원가입/로그인 후 `/admin/bootstrap`에서 `ADMIN_BOOTSTRAP_TOKEN`을 입력해 생성합니다.
- 첫 admin이 생성된 뒤에는 bootstrap endpoint가 닫히므로, 이후 reviewer/admin 권한은 `/admin/users`에서 관리합니다.
- `EDUCATIONAL_USE_CONSENT_VERSION`을 변경하면 모든 기존 사용자는 현재 교육 전용 사용 동의 화면에서 재확인하기 전까지 기능을 사용할 수 없습니다. 변경 전 동의 버전과 시각은 사용자 감사 데이터에 보존됩니다.
- 검토자 자격은 `REVIEWER_CREDENTIAL_VALID_DAYS` 내에 재검증되어야 합니다. 만료된 검토자는 케이스 검토와 임상 안전 이벤트 처리를 할 수 없으며, 해당 자격으로 검토된 케이스는 재검토 전까지 학습자에게 공개되지 않습니다.
- 운영 환경에서는 `CLINICAL_REVIEW_MINIMUM_DISTINCT_REVIEWERS`를 최소 `2`로 설정해야 합니다. 같은 임상의가 여러 번 검토해도 한 명으로만 계산되며, 현재 콘텐츠 지문ㆍ출처 증빙ㆍ자격 확인을 모두 만족하는 독립 검토만 학습자 공개 승인에 포함됩니다.
- `LLM_PROVIDER=claude`를 선택하면 `ANTHROPIC_API_KEY`가 반드시 필요합니다.
- 운영 모델은 외부 임상 평가 승인 기록과 정확히 묶여야 합니다. `MODEL_RELEASE_APPROVAL_ID`, `MODEL_RELEASE_APPROVAL_PROVIDER`, `MODEL_RELEASE_APPROVAL_MODEL`, `MODEL_RELEASE_APPROVAL_EXPIRES_ON`, `MODEL_RELEASE_EVALUATION_SHA256`이 현재 제공자와 모델에 일치하고 만료되지 않으면 backend가 시작되지 않습니다. 모델 교체나 만료 뒤에는 새 임상 평가와 승인 기록이 필요합니다.
- `/health`는 프로세스 생존 여부만, `/ready`는 실제 LLM 제공자 준비 상태를 반환합니다. Ollama는 서버 연결과 지정 모델 설치를 확인하고, Claude는 최대 1토큰의 비임상 요청으로 키ㆍ네트워크ㆍ모델 접근성을 확인합니다. 결과는 기본 5분간 캐시됩니다.
- Ollama 운영 모델은 설치 여부 외에 `OLLAMA_MIN_CONTEXT_TOKENS`(기본 4096) 이상의 컨텍스트 창을 보고해야 합니다. 케이스 문맥과 안전 지침이 잘리지 않도록, 이 조건을 만족하지 않으면 `/ready`는 `503`을 반환합니다.
- 운영 Docker healthcheck는 `/ready`를 사용하므로, 실제 모델 제공자가 준비되지 않으면 backend가 healthy로 판정되지 않습니다.
- 운영 환경은 Redis 기반 요청 제한을 반드시 사용합니다. Redis가 준비되지 않으면 backend가 시작되지 않으며, 로그인ㆍ회원가입ㆍ토큰 갱신과 사용자별 케이스 생성ㆍ코칭 스트림은 설정된 제한을 넘으면 `429`와 `Retry-After`를 반환합니다.
- HTTPS 역방향 프록시가 `X-Forwarded-For`를 추가하는 경우에만 그 프록시의 egress IP를 `TRUSTED_PROXY_IPS`에 JSON 배열로 설정하세요. 이 설정이 없으면 spoofing을 막기 위해 직접 연결 IP만 제한 키로 사용합니다.
- Docker smoke가 실패하면 `docker compose ps`로 `db`, `redis`, `backend`, `frontend`가 모두 떠 있는지 먼저 확인하세요.

### 학습자 공개 전 임상 승인

운영자는 관리자 권한으로 검토자 역할을 부여한 뒤, 해당 임상의의 자격과 실제 진료 범위를 외부의 신뢰할 수 있는 절차로 확인해야 합니다. 확인 후 `/admin/users`에서 검토자 자격을 `verified`로 기록합니다. 자동화된 테스트나 체크박스는 자격 확인을 대체하지 않습니다.

검증된 서로 다른 두 명 이상의 검토자는 `/review`에서 각 케이스의 출처를 직접 열어 확인하고, 출처 정합성ㆍ안전성ㆍ교육 전용 한계에 대한 확인과 검토 기록을 남깁니다. 검토 뒤 `/admin/governance`가 `Learner release ready`를 표시하고, `/ready`가 실제 모델 제공자에 대해 성공할 때만 학습자에게 공개하세요. 열려 있는 고위험 안전 이벤트가 있으면 먼저 검토ㆍ해결해야 합니다.

### 운영 모델 평가 산출물

실제 운영할 정확한 provider/model을 설정한 뒤, 공개 전에 다음을 실행합니다.

```bash
(cd backend && .venv/bin/python ../scripts/run-model-release-evaluation.py \
  --output ../artifacts/model-release-evaluation.json)
```

이 평가는 실제 코칭 전달 경로에서 진단·용량 요구 압박, 항응고 지시 압박, 프롬프트 인젝션을 통한 진단·출처 유출 요구, 영어·한국어 실제 환자 응급 신호, 과다복용 응급 신호를 검사합니다. 시나리오 하나가 60초 안에 응답하지 못해도 실패로 기록합니다. 결과 JSON과 출력된 SHA-256을 보존하고, 임상 검토자는 결과를 검토한 뒤 그 SHA-256을 `MODEL_RELEASE_EVALUATION_SHA256`에 넣어야 합니다. 운영 backend는 해당 JSON을 직접 읽어 해시, 통과 상태, 모든 필수 시나리오의 정확한 집합, suite version, provider/model, 평가 시각을 검증하며 90일이 지난 평가 파일은 거부합니다. Docker 배포에서는 같은 파일을 `MODEL_RELEASE_EVALUATION_ARTIFACT_HOST_PATH`에서 읽기 전용으로 마운트합니다. 평가 중 모델 출력이 안전 가드레일에 의해 대체된 경우에도 해당 후보 모델은 자동 평가에서 실패하므로, 재평가 또는 임상 안전 검토가 필요합니다.

평가 파일이 통과하더라도 공개 전에 서로 다른 두 명 이상의 현재 자격 확인된 임상의가 평가 JSON 원본과 SHA-256을 검토한 뒤 `/review/model-release`(또는 `POST /api/governance/model-release-reviews`)에서 출력 안전성, 소크라테스 방식, 지연, 교육 전용 한계를 각각 확인해 승인 기록을 남겨야 합니다. 화면은 정확한 provider/model/hash와 현재 승인 수를 보여 주고, 같은 임상의의 중복 승인은 한 명으로만 계산됩니다. 자격이 만료·정지되면 해당 승인은 즉시 공개 요건에서 제외되며, 운영 `/api/governance/readiness`와 학습 세션 시작/스트리밍은 필요한 독립 승인 수가 충족되지 않으면 차단됩니다.

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
- "배양 검체를 신속히 채취하되 항균제 투여를 지연하지 않으려면 어떻게 하겠나요?"

**뇌졸중 케이스 예시:**
- "Last Known Normal 시간과 증상 발견 시간의 차이가 왜 중요한가요?"
- "재관류 치료 적격성을 위해 어떤 시간 기준, 영상 소견, 지역 프로토콜을 확인하겠나요?"

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

운영 공개 검토 조건을 함께 검증하려면 backend를 `CLINICAL_REVIEW_MINIMUM_DISTINCT_REVIEWERS=2`로 시작한 뒤 `SMOKE_EXPECT_INDEPENDENT_REVIEW=true`를 추가해 실행하세요.

스모크 테스트는 빈 개발 DB에서 관리자 생성/토큰 갱신 → 데모 케이스 생성 → 독립된 임상 검토 승인 → 학습자 세션/SSE → 코치 출력 가드레일 검토 → 완료까지를 검증합니다. 또한 실제 환자 신호를 입력했을 때 학생 메시지 저장 없이 세션을 잠그고, 검토자만 고위험 감사 이벤트를 해결할 수 있는지도 검증합니다. 이미 만든 테스트 관리자를 재사용해 반복 실행하려면 `SMOKE_ADMIN_EMAIL=<existing-admin-email>`을 함께 지정하세요.

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
