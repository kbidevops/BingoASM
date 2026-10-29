# BingoASM 서버 (원클릭 AS 백엔드)

학교 정보기기·무선망·스쿨넷·스마트기기 **AS 신청·처리**, 자산·도면(실)·QR 라벨·재물조사·일괄 등록, 게시판·문의처·통계를 제공하는 **REST API 서버**입니다.
충북교육청 원클릭 AS(https://www.cbe.go.kr/as/main.do)를 역설계해 만들었고, 화면(프런트엔드)은 `client/`의 Next.js 앱이 이 API 위에서 동작합니다.

| 구분 | 기술 |
|---|---|
| 서버 (`server/`) | Java 17, Spring Boot 3.3, Spring Data JPA, springdoc-openapi(Swagger) |
| DB | H2 파일 DB (기본, 설치 불필요) 또는 PostgreSQL 16 (Docker) |
| 화면 (`client/`) | Next.js 16 (App Router, React 19, TypeScript) — 정적 export를 이 서버가 그대로 제공. [client/README.md](client/README.md) |

---

## 1. 준비물

| 프로그램 | 버전 | 확인 명령 | 필요한 경우 |
|---|---|---|---|
| Java (JDK) | 17 이상 | `java -version` | 항상 |
| Docker Desktop | 최신 | `docker -v` | PostgreSQL을 쓸 때만 |
| Node.js | 20 이상 | `node -v` | `npm run ...` 단축 명령을 쓸 때만 (없어도 됨) |
| Python 3 | 3.9 이상 | `python3 --version` | 통합 테스트를 돌릴 때만 |

Maven은 따로 설치하지 않아도 됩니다. `server/mvnw`가 처음 실행될 때 자동으로 받습니다.

---

## 2. 실행하기

### 방법 A. 간단 실행 (H2 DB)

```bash
cd ~/Downloads/BingoASM/server && ./mvnw spring-boot:run
```

`Started BingoAsmApplication` 문구가 보이면 준비된 것입니다. 처음 실행하면 데모 데이터(학교 8곳, 업체 4곳, AS 20건 등)가 들어갑니다.
브라우저에서 **http://localhost:8080** 을 열면 Swagger UI(API 문서)로 이동합니다. 데이터는 `server/data/`에 저장됩니다.

### 방법 B. PostgreSQL로 실행

Docker Desktop을 켠 뒤:

```bash
cd ~/Downloads/BingoASM && docker compose up -d postgres
```
```bash
cd server && SPRING_PROFILES_ACTIVE=postgres ./mvnw spring-boot:run
```

PostgreSQL 데이터는 Docker 볼륨(`bingoasm-pgdata`)에 남습니다. 끄려면 `docker compose down`.

### 방법 C. 실행 JAR 하나로

```bash
cd ~/Downloads/BingoASM/server && ./mvnw -q -DskipTests package && java -jar target/bingoasm-server.jar
```

Node.js가 있으면 같은 일을 `npm run dev:server`, `npm run dev:server:pg`, `npm run build && npm start`로도 할 수 있습니다 (`package.json`).

---

## 3. API 문서 — Swagger

서버를 켠 뒤 **http://localhost:8080/swagger-ui.html**

- API 120개가 `1. 인증` · `2. 원클릭 AS` · `3. 자산·서비스(기존)` · `0. 전체` 그룹으로 나옵니다.
- `1. 인증 > POST /api/auth/login`을 **Try it out**으로 실행해 `accessToken`을 복사하고, 오른쪽 위 **Authorize**에 붙여 넣으면 이후 호출에 토큰이 자동으로 들어갑니다.
- 각 API 설명 끝의 **권한** 줄이 필요한 권한이고, 서버 코드의 주석이 그대로 설명으로 나옵니다. 코드가 바뀌면 문서도 같이 바뀝니다.
- OpenAPI JSON: `http://localhost:8080/v3/api-docs` — Postman·코드 생성기에 바로 넣을 수 있습니다.

읽는 문서가 필요하면 [docs/API_REFERENCE.md](docs/API_REFERENCE.md)(필드 단위 상세)와 `docs/원클릭AS_API_레퍼런스.docx`(요약 Word)를 보세요.

---

## 4. 프런트엔드 연동 (화면 개발자용)

화면은 `client/`(Next.js)에 있습니다. 개발: 서버를 켠 뒤 `cd client && npm install && npm run dev` → http://localhost:3000. 배포: `npm run build`로 `client/dist`를 만들면 서버가 http://localhost:8080 에서 화면까지 제공합니다(서버 재시작 필요). 자세한 내용은 [client/README.md](client/README.md).

| 항목 | 내용 |
|---|---|
| 호출 주소 | `http://<서버>:8080/api/...` (개발 중에는 `http://localhost:8080`) |
| CORS | 기본 `*`로 열려 있어 어떤 포트·도메인의 화면에서도 호출됩니다. 운영에서는 `CORS_ORIGINS=https://as.example.go.kr`처럼 제한하세요 |
| 인증 | `POST /api/auth/login` → `accessToken`을 `Authorization: Bearer <토큰>` 헤더로. 쿠키는 쓰지 않습니다 |
| 응답 | 성공 `{success:true, data}` / 실패 `{success:false, message}` + HTTP 상태 (400·401·403·404·409·423·429) |
| 메뉴·버튼 | `GET /api/auth/me`의 `permissions`로 메뉴를, AS 상세의 `allowedActions`로 처리 버튼을 결정하면 됩니다 |
| QR | 라벨 QR에 들어갈 주소는 서버의 `QR_BASE_URL`, QR이 보낼 화면 경로는 `ASSET_LINK`·`ROOM_LINK`로 맞춥니다 (아래 7절) |
| 예시 코드 | `scripts/as_integration_test.py`에 모든 API의 요청·응답 예시가 있습니다 |

---

## 5. 로그인 계정 (데모)

학교·업체·사람 이름은 모두 가상입니다.

| 아이디 | 비밀번호 | 역할 | 할 수 있는 일 |
|---|---|---|---|
| admin | admin1234! | 시스템 관리자 | 모든 메뉴 |
| school01 / school02 | user1234! | 학교 담당자 (봉황초등학교 / 온천중학교) | AS 신청·만족도 평가, 자기 학교 자산·도면(실)·재물조사·일괄 등록·QR 라벨, 게시판 |
| netengineer | user1234! | AS 기사 — 한빛네트웍스 (무선망·스쿨넷) | 접수·방문·처리 보고서·이관·반려. 동료가 보낸 **엔지니어 접근권한표**와 같은 메뉴 |
| vendoradmin | user1234! | 업체 관리자 (한빛네트웍스) | 기사 권한 + 자기 업체 AS 통계 |
| eduadmin | user1234! **+ OTP** | 교육청 관리자 (통합관리) | 학교·업체·장비·게시판·문의처·통계 전체. 개발 모드에서는 로그인 응답의 `devCode`가 OTP |
| regionadmin | user1234! | 교육지원청 담당자 (청주교육지원청 정보지원팀) | 관내 학교(봉황초·미래중·푸른고·새봄초)만: AS 조회·배정·취소, 통계, 학교·무선장비·자산·공간·재물조사. 업체 관리·공지·문의처·사용자 관리·AS 삭제는 없음 |
| helpdesk / engineer / user01 | user1234! | 기존 BingoASM 접수자·처리자·요청자 | 기존 서비스 요청 흐름 |

**AS 흐름 한 번 해 보기 (Swagger에서):** school01 로그인 → `POST /api/as/requests {rceptTy:"M", faultTypeCode:"P", requestTypeCode:"2", symptom:"...", installPlace:"...", visitRequestAt:"2026-11-01T10:00"}` → netengineer로 `POST /{sn}/receive {visitPlannedAt}` → `POST /{sn}/report {processContent}` → school01로 `POST /{sn}/evaluate {score:5}`.

---

## 6. 통합 테스트

새 H2 DB에 서버를 띄운 뒤 (다른 포트 예시):

```bash
cd ~/Downloads/BingoASM/server && DATA_DIR=/tmp/bingoasm-test PORT=8090 ./mvnw spring-boot:run
```
```bash
BINGOASM_URL=http://localhost:8090 python3 scripts/as_integration_test.py
```

로그인·OTP·QR 로그인·접근권한표·AS 전 흐름·게시판·통계·도면·QR·재물조사·일괄 등록·첨부·기존 기능 회귀까지 **171개 검사**를 돌립니다. 같은 DB에 두 번 돌리면 데이터가 쌓여 일부 수치 검사가 달라질 수 있고, 로그인 제한(분당 20회) 때문에 1분 간격을 두세요.

---

## 7. 운영 전에 꼭 바꿀 것 (환경 변수)

| 환경 변수 | 기본값 | 설명 |
|---|---|---|
| `JWT_SECRET` | 개발용 키 | 토큰 서명 키. **반드시 변경** (48자 이상) |
| `DATA_KEY` | 개발용 키 | 이메일·휴대폰 번호 AES-256-GCM 암호화 키. **반드시 변경**, 처음 설치할 때 정하고 이후 바꾸지 않기 |
| `OTP_DEV_ECHO` | `true` | 운영에서는 `false` (OTP 코드를 응답에 넣지 않음). 실제 발송은 `AuthController.startOtp`에 연결 |
| `CORS_ORIGINS` | `*` | 화면이 뜨는 출처만 허용 (쉼표로 여러 개) |
| `QR_BASE_URL` | `http://localhost:8080` | 자산 라벨·로그인 QR에 들어갈 주소 — 휴대폰이 접속할 수 있는 주소로 |
| `ASSET_LINK`, `ROOM_LINK` | `/admin/assets?no={assetNo}`, `/admin/floorplan?room={roomId}` | 라벨 QR(`/a/번호`, `/r/실ID`)이 보낼 화면 경로 (client의 기관자산관리·자산 위치 화면) |
| `PORT`, `DATA_DIR` | `8080`, `./data` | 포트, H2·업로드 폴더 |
| `SPRING_PROFILES_ACTIVE=postgres` + `DB_URL`, `DB_USER`, `DB_PASSWORD` | – | PostgreSQL 사용 |

---

## 8. 자주 생기는 문제

| 증상 | 해결 |
|---|---|
| `Port 8080 was already in use` | 이미 서버가 떠 있습니다. `lsof -i :8080`으로 PID를 찾아 종료하거나 `PORT=8081`로 실행 |
| `Unable to access jarfile target/bingoasm-server.jar` | `./mvnw -q -DskipTests package`로 먼저 빌드 |
| `java: command not found` / 버전 오류 | JDK 17 이상 설치 후 `java -version` 확인 |
| `./mvnw: Permission denied` | `chmod +x server/mvnw` |
| 로그인이 429로 막힘 | 같은 IP에서 1분에 20회 넘게 시도. 1분 뒤 다시 |
| 데이터를 처음 상태로 | 서버를 끄고 `rm -rf server/data` (PostgreSQL은 `docker compose exec postgres psql -U bingoasm -d bingoasm -c 'drop schema public cascade; create schema public;'`) |
| 브라우저 화면 호출이 CORS 오류 | `CORS_ORIGINS`에 화면 출처가 들어 있는지, 요청에 `Authorization` 헤더를 쓰는지(쿠키 아님) 확인 |

---

## 9. 폴더 구조

```text
BingoASM/
├─ server/              API 서버 (Java Spring Boot)
│  ├─ src/main/java/    소스 코드 (auth, common, domain, repo, service, web, seed)
│  ├─ src/main/resources/application.yml   설정
│  └─ data/             H2 DB와 업로드 파일 (실행하면 생김)
├─ client/              화면 (Next.js) — npm run build → client/dist 를 서버가 제공
├─ scripts/             as_integration_test.py — 통합 테스트 171개
├─ docs/                문서 (용도별 하나씩) — docs/README.md 참고
├─ legacy/docs-archive/ 이전 버전 문서 (지워도 됨)
├─ docker-compose.yml   로컬 PostgreSQL
└─ package.json         실행 단축 명령 (선택)
```

---

## 10. 문서

문서는 **용도별로 하나씩**만 둡니다. 전체 안내는 [docs/README.md](docs/README.md).

| 읽는 사람 | 문서 |
|---|---|
| 모두 | **Swagger UI** `http://localhost:8080/swagger-ui.html` — 항상 최신인 API 문서, 바로 호출 |
| 비개발자·대표님 | `docs/원클릭AS_소개(비개발자용).docx` — 무엇을 하는 시스템인지 3쪽 요약 |
| 화면 개발자 | [docs/FRONTEND_GUIDE.md](docs/FRONTEND_GUIDE.md) — 연동 순서·규칙, 동료 UI 검토 / `docs/원클릭AS_API_레퍼런스.docx` — API 요약 Word |
| 백엔드 개발자 | [docs/API_REFERENCE.md](docs/API_REFERENCE.md) — 필드 단위 API 명세 / [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — 구조·보안·데이터 모델 |
| 검수 | [docs/VERIFICATION_REPORT.md](docs/VERIFICATION_REPORT.md) — 검증 결과 (171개 검사, PostgreSQL) |

이전 버전의 문서(Word v1~v6, 초기 PPT, 옛 화면 기능 정의서)는 `legacy/docs-archive/`에 있으며 지워도 됩니다.
