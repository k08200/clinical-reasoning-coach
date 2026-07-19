# Clinical Reasoning Coach

의료 추론 과정을 연습하는 소크라테스식 교육용 웹 애플리케이션입니다.
포트폴리오와 교육 시연을 위해 만들었으며, 실제 환자 진단·처방·치료 결정에 사용하면 안 됩니다.

**API 키 없이 실행 가능** — 무료의 결정론적 `curated` 질문 은행이 기본값입니다.

## 포트폴리오 검증 상태

- 무료 `curated` 엔진으로 한국어·영어 소크라테스 질문 제공
- 진단명, 처방, 용량, 직접 처치 제안을 막는 출력 안전 장치
- 회원가입, 권한, 케이스 검토, SSE 코칭, 세션 완료, 안전·개인정보 잠금 흐름 구현
- 백엔드 전체 회귀 테스트 `946 passed` 및 API 스모크 테스트 완료

이 검증은 교육용 프로토타입의 소프트웨어 동작을 보여 줍니다. 실제 임상 사용이나 의료기기 인허가를 의미하지 않습니다.

## 가장 빠른 실행: Docker (무료, API 키 불필요)

사전 준비: [Docker Desktop](https://www.docker.com/products/docker-desktop/)을 실행합니다.

```bash
git clone https://github.com/k08200/clinical-reasoning-coach
cd clinical-reasoning-coach

cp .env.example .env
# .env 기본값: LLM_PROVIDER=curated (수정 불필요)

docker compose up --build
```

브라우저에서 [http://localhost:3000](http://localhost:3000)을 엽니다. 처음 기동은 이미지와 의존성을 내려받으므로 시간이 걸릴 수 있습니다.

정상 기동 확인:

```bash
curl http://localhost:8000/ready
```

종료:

```bash
docker compose down
```

## Docker 없이 로컬 실행

Docker Desktop을 쓰지 않을 때는 SQLite로 백엔드를 실행할 수 있습니다. 터미널을 두 개 사용합니다.

먼저 의존성을 설치합니다.

```bash
cd clinical-reasoning-coach
cp .env.example .env

python3 -m venv backend/.venv
backend/.venv/bin/pip install -r backend/requirements.txt
npm --prefix frontend install
```

첫 번째 터미널에서 무료 백엔드를 시작합니다.

```bash
cd clinical-reasoning-coach
PYTHONPATH=backend \
DATABASE_URL=sqlite+aiosqlite:////tmp/clinical-reasoning-coach-demo.db \
DATABASE_AUTO_CREATE_TABLES=true \
RATE_LIMIT_ENABLED=false \
ADMIN_BOOTSTRAP_TOKEN=local-demo-bootstrap-token \
LLM_PROVIDER=curated \
backend/.venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 8000
```

두 번째 터미널에서 프론트엔드를 시작합니다.

```bash
cd clinical-reasoning-coach
NEXT_PUBLIC_API_URL=http://127.0.0.1:8000 \
npm --prefix frontend run dev -- --hostname 127.0.0.1 --port 3000
```

브라우저에서 [http://127.0.0.1:3000](http://127.0.0.1:3000)을 열면 됩니다. 이 경로는 PostgreSQL과 Redis 없이도 시연할 수 있으며, 데이터는 `/tmp/clinical-reasoning-coach-demo.db`에만 저장됩니다.

## 시연 순서

1. 회원가입 후 교육 전용 사용 동의에 체크합니다.
2. **Generate Demo Case**를 눌러 케이스를 만듭니다.
3. 케이스를 시작하고, 학생의 추론을 입력합니다.
4. 고정된 소크라테스 질문, 추론 지도, 점수와 인지 편향 분석을 확인합니다.
5. API 문서는 [http://127.0.0.1:8000/docs](http://127.0.0.1:8000/docs)에서 확인합니다.

## LLM Provider 선택

| Provider | 비용 | 설정 |
|----------|------|------|
| `curated` (기본) | **무료, 오프라인** | 검토된 케이스용 결정론적 질문 은행 |
| `mock` | **무료, 오프라인** | 개발·테스트 전용 |
| `ollama` | 로컬 또는 Ollama Cloud | Ollama 서버 또는 API 키 필요 |
| `claude` | 유료 (Anthropic) | API 키 필요 |

### Ollama 설정
```bash
# 로컬 Ollama
brew install ollama
ollama pull llama3.2
ollama serve

# .env 수정:
LLM_PROVIDER=ollama
OLLAMA_BASE_URL=http://host.docker.internal:11434

# Ollama Cloud API
LLM_PROVIDER=ollama
OLLAMA_BASE_URL=https://ollama.com
OLLAMA_API_KEY=your-ollama-api-key
OLLAMA_MODEL=glm-5.2:cloud
```

### 무료 검증형 교육 엔진
```bash
# 생성형 모델을 사용하지 않습니다. 고정된 케이스·출처·소크라테스 질문만 제공합니다.
LLM_PROVIDER=curated
```

`curated`는 실제 환자 진료용이 아니며, 현재 검토된 교육 케이스 안에서만
질문을 선택합니다. 학습자 입력의 한글 여부에 맞춰 한국어 또는 영어의 고정 질문만
반환합니다. 운영 공개 전에는 다른 제공자와 동일하게 현재 평가 산출물과
서로 다른 두 명의 자격 확인된 임상의 승인이 필요합니다.

### Claude 설정 (최고 품질)
```bash
# .env 수정:
LLM_PROVIDER=claude
ANTHROPIC_API_KEY=sk-ant-...
```

## 실제 운영 배포 (포트폴리오 시연에는 불필요)

아래 내용은 공개 서버를 운영하려는 경우에만 필요합니다. 실제 환자 진료 기능을 표방하려면 별도의 임상 검토와 규제 검토가 필요합니다.

### Production 설정 체크리스트

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
LLM_PROVIDER=curated  # 또는 검증된 ollama / claude
```

- `APP_ENV=production`에서 기본 `SECRET_KEY=change-me-in-production`이면 백엔드가 시작되지 않습니다.
- `APP_ENV=production`에서는 `DATABASE_AUTO_CREATE_TABLES=false`를 설정하고 Alembic migration을 적용해야 합니다.
- `APP_ENV=production`에서는 데모용 `LLM_PROVIDER=mock`으로 시작할 수 없습니다. 무료 `curated` 엔진 또는 검증된 `ollama`/`claude`를 명시적으로 선택해야 합니다.
- 첫 관리자 계정은 일반 회원가입/로그인 후 `/admin/bootstrap`에서 `ADMIN_BOOTSTRAP_TOKEN`을 입력해 생성합니다.
- 첫 admin이 생성된 뒤에는 bootstrap endpoint가 닫히므로, 이후 reviewer/admin 권한은 `/admin/users`에서 관리합니다.
- `EDUCATIONAL_USE_CONSENT_VERSION`을 변경하면 모든 기존 사용자는 현재 교육 전용 사용 동의 화면에서 재확인하기 전까지 기능을 사용할 수 없습니다. 변경 전 동의 버전과 시각은 사용자 감사 데이터에 보존됩니다.
- 검토자 자격은 `REVIEWER_CREDENTIAL_VALID_DAYS` 내에 재검증되어야 합니다. 만료된 검토자는 케이스 검토와 임상 안전 이벤트 처리를 할 수 없으며, 해당 자격으로 검토된 케이스는 재검토 전까지 학습자에게 공개되지 않습니다.
- 운영 환경에서는 `CLINICAL_REVIEW_MINIMUM_DISTINCT_REVIEWERS`를 최소 `2`로 설정해야 합니다. 같은 임상의가 여러 번 검토해도 한 명으로만 계산되며, 현재 콘텐츠 지문ㆍ출처 증빙ㆍ자격 확인을 모두 만족하는 독립 검토만 학습자 공개 승인에 포함됩니다.
- `LLM_PROVIDER=claude`를 선택하면 `ANTHROPIC_API_KEY`가 반드시 필요합니다.
- 운영 모델은 외부 임상 평가 승인 기록과 정확히 묶여야 합니다. `MODEL_RELEASE_APPROVAL_ID`, `MODEL_RELEASE_APPROVAL_PROVIDER`, `MODEL_RELEASE_APPROVAL_MODEL`, `MODEL_RELEASE_APPROVAL_EXPIRES_ON`, `MODEL_RELEASE_EVALUATION_SHA256`이 현재 제공자와 모델에 일치하고 만료되지 않으면 backend가 시작되지 않습니다. 모델 교체나 만료 뒤에는 새 임상 평가와 승인 기록이 필요합니다.
- `glm-5.2:cloud`를 운영 모델로 사용하면 승인 기록의 제공자와 모델은 각각 `ollama`, `glm-5.2:cloud`여야 합니다. API 키 인증을 통과한 뒤 동일한 환경에서 평가를 다시 실행하고, 그 결과를 임상 검토에 사용합니다.
- `LLM_PROVIDER=curated`를 운영에 사용할 때 승인 기록의 제공자와 모델은 각각 `curated`, `curated-question-bank-v1`이어야 합니다. 질문 은행, 케이스 출처, 소크라테스 안전 정책 중 하나라도 바뀌면 새 평가와 임상 검토가 필요합니다.
- `/health`는 프로세스 생존 여부만, `/ready`는 실제 LLM 제공자 준비 상태를 반환합니다. Ollama는 서버 연결과 지정 모델 설치를 확인하고, Claude는 최대 1토큰의 비임상 요청으로 키ㆍ네트워크ㆍ모델 접근성을 확인합니다. 운영 환경의 `/ready`는 여기에 DB 연결, Redis 요청 보호, 현재 평가 산출물, 현재 자격 임상의의 독립 모델 승인 수까지 확인하므로 이 조건 중 하나라도 사라지면 `503`을 반환합니다. 모델 제공자 결과는 기본 5분간 캐시됩니다.
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

이 평가는 실제 코칭 전달 경로에서 진단·용량 요구 압박, 항응고 지시 압박, 프롬프트 인젝션을 통한 진단·출처 유출 요구, 영어·한국어 실제 환자 응급 신호, 과다복용 응급 신호를 검사합니다. 시나리오 하나가 60초 안에 응답하지 못해도 실패로 기록합니다. 결과 JSON과 출력된 SHA-256을 보존하고, 임상 검토자는 결과를 검토한 뒤 그 SHA-256을 `MODEL_RELEASE_EVALUATION_SHA256`에 넣어야 합니다. 운영 backend는 해당 JSON을 직접 읽어 해시, 통과 상태, 모든 필수 시나리오의 정확한 집합, suite version, provider/model, 평가 시각, 코칭·provider 전달 코드 지문을 검증하며 90일이 지난 평가 파일은 거부합니다. 따라서 프롬프트·가드레일·provider 전달 코드가 바뀌면 새 평가가 반드시 필요합니다. Docker 배포에서는 같은 파일을 `MODEL_RELEASE_EVALUATION_ARTIFACT_HOST_PATH`에서 읽기 전용으로 마운트합니다. 평가 중 모델 출력이 안전 가드레일에 의해 대체된 경우에도 해당 후보 모델은 자동 평가에서 실패하므로, 재평가 또는 임상 안전 검토가 필요합니다.

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

`curated` 엔진은 진단명, 처방, 용량, 직접 처치를 제시하지 않습니다. 다음처럼
교육용 소크라테스 질문으로만 추론을 유도하며, 실제 환자 진료에는 사용하지 않습니다:

**시간 민감한 증례 예시:**
- "활력징후나 진찰 소견 중 가장 우려되는 것은 무엇이며 그 이유는 무엇인가요?"
- "생명 위협 가능성 중 덜 위험한 원인보다 먼저 고려해야 할 것은 무엇인가요?"

**추론 점검 예시:**
- "현재 가장 앞선 가설을 가장 크게 약화할 소견은 무엇인가요?"
- "감별을 더 좁히기 전에 무엇을 확인해야 하나요?"

## 아키텍처

```
Next.js 15 (React 19 + TypeScript + Tailwind)
    ↕ SSE 스트리밍
FastAPI (Python, async SQLAlchemy)
    ↕
LLM Provider (curated | mock | ollama | claude)
    ↕
PostgreSQL 16
```

### 핵심 파일

| 파일 | 역할 |
|------|------|
| `backend/app/services/curated_provider.py` | 검토된 케이스용 결정론적 질문 은행 (무료) |
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
    → Curated/Claude/Ollama/Mock: 소크라틱 질문 스트리밍 (SSE)
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

## 검증 재실행

```bash
# 전체 백엔드 회귀 테스트 (약 8분)
backend/.venv/bin/python -m pytest --no-cov backend/tests -q

# 프론트엔드 테스트
npm --prefix frontend test

# API smoke test (비어 있는 개발 DB와 localhost:8000 백엔드가 필요)
SMOKE_API_URL=http://127.0.0.1:8000 \
SMOKE_ADMIN_BOOTSTRAP_TOKEN=local-demo-bootstrap-token \
SMOKE_EXPECT_INDEPENDENT_REVIEW=true \
node scripts/smoke-api.mjs
```

스모크 테스트는 관리자 계정을 처음 만들기 때문에 빈 DB에서 실행해야 합니다. 이미 관리자 계정이 있으면 새 SQLite 파일로 백엔드를 다시 시작하거나 `SMOKE_ADMIN_EMAIL=<existing-admin-email>`을 지정하세요.

스모크 테스트는 관리자 생성/토큰 갱신 → 데모 케이스 생성 → **테스트용** 독립 검토 승인 → 학습자 세션/SSE → 코치 출력 가드레일 검토 → 완료까지를 검증합니다. 실제 환자 신호를 입력했을 때 학생 메시지 저장 없이 세션을 잠그고, 검토자만 고위험 감사 이벤트를 해결할 수 있는지도 확인합니다. 테스트용 검토자 승인은 실제 임상의 검토를 뜻하지 않습니다.

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
