# 원클릭 AS 백엔드 API 명세

충북교육청 원클릭 AS 시스템(https://www.cbe.go.kr/as/main.do)을 역설계한 결과를 BingoASM Java 백엔드에 **원클릭 AS 모듈**로 구현한 것입니다.
동료가 만든 UI 클론(`충북교육청_원클릭AS시스템_UI_클론.html`)의 데이터 모델과 화면 함수를 그대로 받을 수 있게 설계했고, 대표님 코멘트 4가지(QR 로그인·자산등록, 도면 기반 자산 위치, 계정 암호화, 자산 일괄 등록)를 백엔드에서 모두 다룹니다.

- 기준 URL: `http://localhost:8080` (개발), 모든 API는 `/api/...`
- **Swagger UI**: `http://localhost:8080/swagger-ui.html` — 모든 엔드포인트의 요청·응답 스키마와 권한을 자동 생성하고 브라우저에서 바로 호출 (OpenAPI JSON `/v3/api-docs`)
- 응답 형식: `{ "success": true, "data": ... }` / 실패 `{ "success": false, "message": "..." }` + HTTP 상태(400 입력오류, 401 미로그인, 403 권한없음, 404 없음, 409 상태충돌, 423 잠김, 429 요청과다)
- 인증: `Authorization: Bearer <accessToken>` (JWT HS384, 기본 8시간, refresh 14일)
- 날짜·시각: `YYYY-MM-DD`, `YYYY-MM-DDTHH:mm[:ss]` (ISO, 서버 로컬 시간)
- 목록 응답: `{ content: [...], totalElements, page, size, totalPages }` (`page`는 1부터, `size` 기본 20)

---

## 1. 역할과 권한

### 1.1 역할

| 역할 | 누구 | 소속 필드 |
|---|---|---|
| `SCHOOL_USER` | 학교 담당자 (교사·행정) | `schoolId` |
| `AS_ENGINEER` | 유지관리 업체 기사 | `vendorId` |
| `VENDOR_ADMIN` | 업체 관리자 | `vendorId` |
| `EDU_ADMIN` | 교육청 담당자 (통합관리) | – |
| `REGION_ADMIN` | 교육지원청 담당자 (정보지원팀) | `regionId` — 관할 교육지원청 |
| `SYS_ADMIN` | 시스템 관리자 (기존 BingoASM 관리자 포함) | – |

소속 규칙 (`UserService.checkAffiliation`, 역할→소속 표는 `Roles.AFFILIATION`):
- 소속 역할은 해당 소속 필드가 꼭 있어야 한다 (학교 담당자 → `schoolId`, 기사·업체 관리자 → `vendorId`, 교육지원청 담당자 → `regionId`).
- 한 계정에 학교·업체·교육지원청 역할을 섞을 수 없고, `schoolId`와 `vendorId`를 함께 둘 수 없다.
- 원클릭 AS 역할과 기존 자산관리 역할(`REQUESTER`·`RECEIVER`·`PROCESSOR`)은 함께 줄 수 없다.
- 학교 계정의 지역은 학교에서 정해지므로 계정의 `regionId`는 비워진다.
- `POST /api/users`에 `roles`를 함께 보내면 그 역할로 만든다 (`ROLE_GRANT` 필요). 없으면 기존 기본값 `REQUESTER`.

### 1.2 권한 코드

| 권한 | 메뉴/기능 | SCHOOL_USER | AS_ENGINEER | VENDOR_ADMIN | EDU_ADMIN |
|---|---|:-:|:-:|:-:|:-:|
| `PORTAL_INTRO` | 시스템소개 | ○ | ○ | ○ | ○ |
| `BOARD_NOTICE` | 공지 및 자료실 | ○ | × | × | ○ |
| `BOARD_QNA` | 질문 및 건의하기 | ○ | ○ | ○ | ○ |
| `BOARD_CONSULT` | 컨설팅 신청 | ○ | ○ | ○ | ○ |
| `PORTAL_CONTACT` | 문의처 안내 | ○ | ○ | ○ | ○ |
| `SMART_REQUEST` | 스마트기기지원신청 | ○ | × | × | ○ |
| `AS_C_REQUEST` | 정보기기 AS신청 | ○ | × | × | ○ |
| `AS_C_VIEW` | 정보기기 AS결과조회 | ○ | ○ | ○ | ○ |
| `BOARD_DISPOSAL` | 불용PC수거신청 | ○ | ○ | ○ | ○ |
| `BOARD_VENDOR` | 유지관리업체(정보공유) | ○ | ○ | ○ | ○ |
| `AS_M_REQUEST` / `AS_M_VIEW` | 무선망 AS신청 / 결과조회 | ○ | 업체 서비스 유형에 M이 있을 때 | 〃 | ○ |
| `AS_S_REQUEST` / `AS_S_VIEW` | 스쿨넷 AS신청 / 결과조회 | ○ | 업체 서비스 유형에 S가 있을 때 | 〃 | ○ |
| `BOARD_SLA` | 스쿨넷 SLA 공유 | ○ | × | × | ○ |
| `AS_PROCESS` | AS 접수·방문·보고서·이관·반려 | × | ○ | ○ | ○ |
| `AS_EVALUATE` | 처리 완료 건 만족도 평가 | ○ | × | × | ○ |
| `AS_MANAGE` | AS신청관리(배정·삭제) | × | × | ○(자기 업체) | ○ |
| `AS_STATS` | AS통계관리 | × | × | ○(자기 업체) | ○ |
| `WDEVICE_MANAGE` | 무선망장비관리 | × | × | × | ○ |
| `SCHOOL_MANAGE` / `VENDOR_MANAGE` | 학교·지역 / 업체 관리 | × | × | × | ○ |
| `BOARD_ADMIN` | 공지·SLA 작성, 게시판 진행상태, 문의처 편집 | × | × | × | ○ |
| `SPACE_MANAGE` | 건물·층·실(도면) 관리 | ○ | × | × | ○ |
| `INVENTORY` | 재물조사(QR) | ○ | × | × | ○ |
| `ASSET_BULK` | 자산 일괄 등록 | ○ | × | × | ○ |
| `ASSET_READ` / `ASSET_WRITE` / `FLOOR_READ` / `FLOOR_WRITE` | 자산·도면 (기존 BingoASM) | ○ | × | × | ○ |

기사·업체관리자의 `AS_{유형}_REQUEST / _VIEW`는 소속 업체의 `serviceTypes`(C, M, S, T)에서 **로그인 때마다 계산**됩니다(`PermissionService.effectivePerms`). 데모의 `netengineer`(한빛네트웍스: M,S)는 동료가 보낸 **엔지니어 접근권한표**와 정확히 같은 메뉴를 갖습니다:

| 접근권한표 (엔지니어) | 권한 | 데모 검증 |
|---|---|---|
| 시스템소개 있음 | `PORTAL_INTRO` | ○ |
| 공지 및 자료실 없음 | – (`GET /api/as/boards/NOTICE` → 403) | ○ |
| 질문 및 건의하기 있음 | `BOARD_QNA` | ○ |
| 컨설팅 신청 있음 | `BOARD_CONSULT` | ○ |
| 문의처 안내 있음 | `PORTAL_CONTACT` | ○ |
| 스마트기기지원신청 없음 | – (`POST rceptTy=T` → 403) | ○ |
| 정보기기 AS신청 없음 / 결과조회 있음 | `AS_C_VIEW`만 | ○ |
| 불용PC수거신청 있음 | `BOARD_DISPOSAL` | ○ |
| 유지관리업체(정보공유) 있음 | `BOARD_VENDOR` | ○ |
| 무선망 AS신청·결과조회 있음 | `AS_M_REQUEST`, `AS_M_VIEW` (업체 M) | ○ |
| 스쿨넷 AS신청·결과조회 있음 | `AS_S_REQUEST`, `AS_S_VIEW` (업체 S) | ○ |
| 스쿨넷 SLA 공유 없음 | – (403) | ○ |
| 통합관리 6개 모두 없음 | – (통계·학교·업체·장비·게시판관리 403) | ○ |

### 1.3 데이터 범위(스코프)

범위는 `CurrentUser.scope()`(`auth/Scope`) 한 곳에서 정하고, 학교 단위 범위는 `SchoolService.scopeSchoolIds`가 계산한다.
역할이 여러 개면 우선순위는 도교육청(`EDU_ADMIN`·`SYS_ADMIN`) > 교육지원청 > 학교 > 업체. 원클릭 AS 소속이 없는 기존 계정은 AS는 본인 신청만, 자산은 기관 전체.

| 역할 | AS 신청 | 자산·공간·재물조사 | 무선망 장비 |
|---|---|---|---|
| SCHOOL_USER | 자기 학교 건 | 자기 학교 | 자기 학교(다른 학교 지정 시 403) |
| AS_ENGINEER / VENDOR_ADMIN | 자기 업체에 배정된 건 | – | 조회만 |
| REGION_ADMIN | 관내 학교 건 (배정·취소 가능, 삭제 불가) | 관내 학교 | 관내 학교 |
| EDU_ADMIN / SYS_ADMIN | 전체 | 전체 | 전체 |

---

## 2. 인증·계정 보안 (`/api/auth`)

대표님 코멘트 **"계정 암호화 꼼꼼히"** 에 대한 구현입니다.

| 항목 | 구현 |
|---|---|
| 비밀번호 저장 | BCrypt strength 12 (`SecurityBeans`) |
| 비밀번호 정책 | 10자 이상, 영문·숫자·특수문자 중 2종 이상, 아이디·휴대폰 번호 포함 금지, 연속·반복 문자 제한 (`PasswordPolicy`) |
| 개인정보 암호화 | 이메일·휴대폰은 AES-256-GCM으로 암호화해 저장 (`CryptoConverter`, 키 `DATA_KEY`, 저장 형태 `enc:base64(iv+ct)`) — DB가 유출돼도 평문이 없음. 암호화 이전의 평문 행은 기동 시 `PiiMigration`이 암호화 |
| 로그인 실패 | 5회 실패 시 30분 잠금(`lockedUntil`), 실패 횟수 응답에 표시 `(1/5)` |
| 요청 제한 | 로그인·OTP·QR 시작: IP당 분당 20회, 초과 시 429 (`RateLimiter`) |
| 2단계 인증 | `otpEnabled` 사용자는 비밀번호 확인 후 6자리 OTP(5분, 1회용, 해시 저장). 메신저/SMS 발송은 연동 지점만 두고 개발 모드(`OTP_DEV_ECHO=true`)에서는 `devCode`로 돌려줌 |
| QR 로그인 | PC가 QR을 띄우고 이미 로그인한 휴대폰이 승인 — 세션 토큰 32바이트 난수, 2자리 확인 숫자, 3분 만료, 토큰 1회 발급 후 `CONSUMED` |
| 토큰 | JWT HS384, 비밀키가 기본값(`change-me`)이면 기동 시 경고 |
| 로그인 이력 | 방법(PASSWORD/OTP/QR)·성공 여부·마스킹된 IP(`10.0.***.5`, IPv6 `2001:db8:****`)·UA 저장, 본인 최근 5건 조회 |

| 메서드 | 경로 | 권한 | 요청 | 응답 |
|---|---|---|---|---|
| POST | `/api/auth/login` | 공개 | `{loginId, password, orgCode?}` | 토큰 `{accessToken, refreshToken}` 또는 OTP 단계 `{step:"otp", otpToken, expiresAt, devCode?}` |
| POST | `/api/auth/otp/verify` | 공개 | `{otpToken, code}` | 토큰 |
| POST | `/api/auth/otp/resend` | 공개 | `{otpToken}` | 새 OTP 단계 |
| POST | `/api/auth/qr/start` | 공개 | – | `{token, num, expiresAt, qrText}` — `qrText`를 QR로 표시 |
| GET | `/api/auth/qr/{token}` | 공개 | – | `{status: PENDING/APPROVED/CONSUMED/EXPIRED/REJECTED, num}`; APPROVED일 때 한 번만 토큰 포함 |
| GET | `/api/auth/qr/{token}/info` | 로그인(휴대폰) | – | `{status, num, clientIp}` — 사용자가 PC 화면의 숫자와 비교 |
| POST | `/api/auth/qr/{token}/approve` | 로그인(휴대폰) | `{num}` | `{status:"APPROVED"}` |
| POST | `/api/auth/qr/{token}/reject` | 로그인 | – | – |
| POST | `/api/auth/refresh` | 공개 | `{refreshToken}` | 새 토큰 |
| GET / PUT | `/api/auth/me` | 로그인 | `{userName, email, mobile, otpEnabled, ...}` | 내 정보 + `roles`, `permissions`, `memberType`, `schoolName`, `vendorName` |
| PUT | `/api/auth/password` | 로그인 | `{currentPassword, newPassword}` | 정책 위반 시 400 메시지 |
| GET | `/api/auth/me/logins` | 로그인 | – | 최근 로그인 5건 |
| GET / POST / DELETE | `/api/auth/me/scraps`, `/me/scraps/{id}` | 로그인 | `{menuKey, groupName, title}` | 즐겨찾기 메뉴 (동료 UI의 localStorage 스크랩을 서버 저장으로) |
| GET | `/qr?t={token}` | 공개 | – | 302 → `/login/qr-approve?t=` (휴대폰이 QR을 찍었을 때) |

---

## 3. AS 신청·처리 (`/api/as/requests`)

cbe.go.kr의 네 가지 신청(정보기기 C · 무선망 M · 스쿨넷 S · 스마트기기 T)을 하나의 모델 `AsRequest`로 다룹니다. 유형은 `rceptTy`.

### 3.1 상태와 처리

| 상태 | 뜻 | 누가 어떻게 |
|---|---|---|
| `A` 신청완료 | 학교가 신청, 학교↔업체 매핑으로 업체·기사 자동 지정 | 학교: `update`, `cancel` / 기사: `receive`, `return`, `transfer` |
| `R` 접수완료 | 기사가 방문예정일시를 넣고 접수 | 기사: `visit`(방문일 변경), `report`, `transfer` |
| `C` 처리완료 | 기사가 처리 보고서 등록 | 기사: `report`(보고서 수정) / 학교: `evaluate`(1회) |
| `X` 반려 | 기사가 사유와 함께 반려 | 기사: `return-cancel` / 학교: `cancel` |

관리자(`AS_MANAGE`)는 어느 상태에서든 `assign`(업체·기사 배정), `delete`. 모든 처리는 `AsHistory`에 기록됩니다.

| 메서드 | 경로 | 권한 | 설명 |
|---|---|---|---|
| GET | `/api/as/requests/codes` | 로그인 | 접수유형·상태·고장유형(유형별)·요청유형·처리유형 코드표 |
| GET | `/api/as/requests` | 결과조회 권한 | 목록. 파라미터: `rceptTy`, `status`(A/R/C/X), `searchType`(school/applicant/region), `keyword`, `fromDate`, `toDate`, `schoolId`, `regionId`, `vendorId`, `engineerUserId`, `mine`, `unassigned`, `sort`(asc/desc), `page`, `size` |
| GET | `/api/as/requests/summary` | 〃 | 유형별·상태별 건수, 오늘 신청, 평가 대기 |
| GET | `/api/as/requests/excel` | 〃 | 같은 필터로 xlsx 내려받기 |
| GET | `/api/as/requests/{sn}` | 〃 + 스코프 | 상세: 신청 내용, 업체·기사, 처리 보고서(`report`), 첨부(`attachments`, `reportFiles`), 평가, `histories`, **`allowedActions`**(현재 사용자가 지금 할 수 있는 처리) |
| POST | `/api/as/requests` | `AS_{ty}_REQUEST` / `SMART_REQUEST` | 신청. 아래 필드 |
| PUT | `/api/as/requests/{sn}` | 작성자(A 상태) | 신청 수정 |
| POST | `/api/as/requests/{sn}/{action}` | 상태·역할에 따라 | `receive {visitPlannedAt}` · `return {reason}` · `return-cancel` · `transfer {rceptTy, content}` · `cancel` · `visit {visitPlannedAt}` · `report {...}` · `evaluate {score 1~5, opinion}` · `assign {vendorId, engineerUserId?}` · `delete` |
| DELETE | `/api/as/requests/{sn}` | `AS_MANAGE` | 관리자 삭제 |

신청 필드 (cbe.go.kr 폼과 1:1):

| 필드 | C 정보기기 | M 무선망 | S 스쿨넷 | T 스마트기기 |
|---|---|---|---|---|
| `faultTypeCode` 장애유형 | 11~17 | S 속도느림 / P 접속불량 / W 직접입력(+`faultTypeName`) | 71 전체 / 72 일부 / 73 기타 | 81~85 |
| `requestTypeCode` 요청내용 | – | **필수** 1 AP 원격 재부팅 / 2 방문요청 / 3 기타 | – | – |
| `symptom` 증상 | 필수 | 필수 | 필수 | 필수 |
| `installPlace` 설치장소 | 필수 | 필수 | 선택 | 선택 |
| `contactTel` 연락처 | 계정 휴대폰 기본값, `phone1/2/3`도 받음 | 〃 | 〃 | 〃 |
| `visitRequestAt` 방문요청일시 | 필수 (`visitRequestDate` + `visitTime1/2`도 받음) | 〃 | 〃 | 〃 |
| `deviceId` 무선장비 | – | 무선망장비관리 번호 → `deviceName` 자동 | – | – |
| `assetId` 자산 | 자산 연결 시 `equipmentName/productName/modelName` 자동 | – | – | 〃 |
| `equipmentName, productName, modelName, quantity` | 직접 입력 | – | – | 〃 |
| `attachFileIds` | `POST /api/files` 결과의 id 배열 | 〃 | 〃 | 〃 |

처리 보고서(`report`) 필드: `engineerName`, `visitAt`, `visitEndAt`, `troubleSymptom`(장애증상), `inspectContent`(점검내용), `processTypeCode`(1 장비불량 … 8 기타), `processContent`(처리내용, 필수), `processAmount`(비용), `fileIds`.

규칙(cbe.go.kr과 동일): 정보기기 AS는 유지관리 표준계약 체결(`contractStatus=CONTRACTED`) 학교만 · 담당 업체가 없는 학교는 신청 불가 · 접수에는 방문예정일시 필수 · 반려에는 사유 필수 · 이관은 대상 유형의 업체로 재배정되며 상태 A로 돌아감 · 평가는 신청자만 1회.

### 3.2 기준정보 (`/api/as/regions`, `/schools`, `/vendors`, `/wireless-devices`)

| 메서드 | 경로 | 권한 |
|---|---|---|
| GET | `/api/as/regions` | 로그인 |
| POST / PUT / DELETE | `/api/as/regions[/{id}]` | `SCHOOL_MANAGE` |
| GET | `/api/as/schools?keyword&regionId&contractStatus` | 로그인 (학교 사용자는 자기 학교) |
| GET | `/api/as/schools/{id}` | 〃 — 유형별 담당 업체·기사(`vendors`), 자산 수, 담당자 |
| POST / PUT / DELETE | `/api/as/schools[/{id}]` | `SCHOOL_MANAGE` — `{schoolName, regionId, schoolType ELEM/MID/HIGH/SPECIAL/ETC, address, tel, classCount, contractStatus NONE/CONTRACTED, memo}` |
| PUT | `/api/as/schools/{id}/vendors` | `SCHOOL_MANAGE`/`VENDOR_MANAGE` — `[{rceptTy, vendorId, engineerUserId}]` |
| GET | `/api/as/vendors?regionId&rceptTy` | 로그인 |
| POST / PUT / DELETE | `/api/as/vendors[/{id}]` | `VENDOR_MANAGE` — `{vendorName, regionId, bizNo, tel, address, serviceTypes:"M,S"}` |
| GET | `/api/as/vendors/{id}/engineers` | 관리자·기사 |
| GET | `/api/as/wireless-devices?schoolId&regionId&deviceType&status&keyword` | 장비관리·무선망 신청/조회·기사 |
| POST / PUT / DELETE | `/api/as/wireless-devices[/{id}]` | `WDEVICE_MANAGE` — `{schoolId, deviceCode, deviceName, deviceType AP/SWITCH/CONTROLLER, modelName, ipAddress, macAddress, location, installedAt, lastCheckedAt, status NORMAL/FAULT/REPLACED, note}` |

### 3.3 통계 (`/api/as/stats`, 권한 `AS_STATS`)

| 경로 | 내용 |
|---|---|
| `GET /monthly?year&rceptTy&regionId` | 월별 건수·완료·반려·비용·평균 처리일, 유형별·지역별·업체별 집계(업체 관리자는 자기 업체만) |
| `GET /satisfaction?year&rceptTy&regionId&page&size` | 완료 대비 평가율, 점수 분포, 업체별·기사별 평균, 평가 목록 |

---

## 4. 게시판·문의처 (`/api/as/boards`, `/api/as/contacts`)

| 코드 | 게시판 | 읽기 | 쓰기 | 특징 |
|---|---|---|---|---|
| `NOTICE` | 공지 및 자료실 | `BOARD_NOTICE` | `BOARD_ADMIN` | 분류 일반/긴급/자료, 첨부 |
| `QNA` | 질문 및 건의하기 | `BOARD_QNA` | 읽는 사람 모두 | 분류 질문/건의, 분야(WIRELESS/DEVICE/SCHOOLNET/ETC), 비밀글, 답변(관리자·기사·작성자) |
| `CONSULT` | 컨설팅 신청 | `BOARD_CONSULT` | 〃 | 진행상태 WAIT/RECEIVED/DONE, 방문일, 지역 |
| `DISPOSAL` | 불용PC수거신청 | `BOARD_DISPOSAL` | 〃 | 진행상태, 방문일, 학교·지역 자동 |
| `VENDOR` | 유지관리업체(정보공유) | `BOARD_VENDOR` | 〃 | 분류 의견사항/업무질의, 지역 |
| `SLA` | 스쿨넷 SLA 공유 | `BOARD_SLA` | `BOARD_ADMIN` | 첨부 |

| 메서드 | 경로 | 설명 |
|---|---|---|
| GET | `/api/as/boards` | 내가 볼 수 있는 게시판(메뉴 구성용) |
| GET | `/api/as/boards/{code}?keyword&searchType(title/content/author)&regionId&fieldCode&categoryCode&status&mine&page&size` | 목록 (`isNew`, `commentCount`, `hasAttach`) |
| GET | `/api/as/boards/{code}/{id}` | 상세 + `attachments`, `comments`, `canEdit/canComment/canSetStatus`. 비밀글은 작성자·관리자만 |
| POST / PUT / DELETE | `/api/as/boards/{code}[/{id}]` | `{title, content, categoryCode, fieldCode, regionId, schoolId, secret, attachFileIds}` |
| PATCH | `/api/as/boards/{code}/{id}/status` | `{status, visitDate}` — 관리자 |
| POST / DELETE | `/api/as/boards/{code}/{id}/comments[/{commentId}]` | 답변 `{content}` |
| GET | `/api/as/contacts` | 문의처: `[{regionName:"도교육청"|교육지원청, groups:[{groupName, items:[{itemName, tel, note, duties[]}]}]}]` 교육지원청의 `groupName:"유지보수 사업자"` 그룹은 cbe.go.kr에 공개된 지역별 업체 목록(업체 계정과 별개) |
| PUT | `/api/as/contacts` | `BOARD_ADMIN` 전체 교체 `[{regionId, groupName, itemName, tel, note, duties}]` |
| POST | `/api/files` (multipart `files`) | 첨부 업로드(최대 5개·20MB, 실행 파일·HTML·SVG 차단) → `[{fileId, name, size, url}]` |
| GET | `/files/{id}/download` | 첨부 내려받기 (attachment + nosniff) |

---

## 5. 자산 위치·도면·QR·재물조사·일괄등록

### 5.1 공간(도면) — `/api/as/spaces`  (대표님 코멘트 2: 자산 위치 파악)

학교 → 건물 → 층(도면 이미지) → **실(room)**. 실은 도면 위 사각형(`rect`, 퍼센트 0~100)으로 표시되고, 자산은 실에 소속됩니다. 기존 BingoASM의 자산 단위 핀(`posX/posY`)도 그대로 쓸 수 있습니다.

| 메서드 | 경로 | 권한 | 설명 |
|---|---|---|---|
| GET | `/api/as/spaces/buildings?schoolId` | 읽기 | 건물과 층(`planUrl`, 실 수) |
| POST | `/api/as/spaces/buildings` | `SPACE_MANAGE` | `{schoolId, buildingName, address?, floorCount?}` |
| POST | `/api/as/spaces/buildings/{id}/floors` | 〃 | `{floorNo, floorName?}` |
| POST | `/api/places/floors/{floorId}/plan` (multipart `file`) | `FLOOR_WRITE` | 도면 이미지 업로드(기존 API 재사용) |
| GET | `/api/as/spaces/rooms?schoolId&floorId` | 읽기 | 실 목록(`fullName`, `assetCount`, `rect`) |
| GET | `/api/as/spaces/rooms/{id}` | 읽기 | 실 상세 + **이 실의 자산 목록** (실 QR을 찍었을 때 화면) |
| POST / PUT / DELETE | `/api/as/spaces/rooms[/{id}]` | `SPACE_MANAGE` | `{schoolId, floorId, roomNo, roomName, roomType OFFICE/CLASS/LAB/SERVER/ETC, ownerName, rect:{x,y,w,h}}` — `rect`만 보내면 도면 위 위치만 바뀜(동료 UI `placeAt`) |
| POST | `/api/as/spaces/rooms/move-assets` | `SPACE_MANAGE`/`INVENTORY` | `{roomId, assetIds[], how?}` — 자산을 실에 배정(`assignRoom`), 자산 이력 기록 |

### 5.2 QR — `/api/qr`  (대표님 코멘트 1: QR 로그인 또는 자산등록)

| 메서드 | 경로 | 권한 | 설명 |
|---|---|---|---|
| GET | `/api/qr/asset/{assetNo}.png?size` | 자산 읽기 | 자산 라벨 QR 이미지 (내용 `{QR_BASE_URL}/a/{assetNo}`) |
| GET | `/api/qr/room/{roomId}.png` | 도면 읽기 | 실 QR 이미지 (`/r/{roomId}`) |
| POST | `/api/qr/resolve` | 로그인 | `{text}` 카메라로 읽은 문자열 → `{type: ASSET(state REGISTERED/RESERVED/NOT_FOUND) | ROOM | LOGIN | UNKNOWN, ...}` (동료 UI `gotScan`) |
| GET | `/api/assets/by-no/{assetNo}` | 자산 읽기 | 자산번호로 조회 |
| POST | `/api/qr/labels` | 자산 읽기 | `{assetIds[] | assetNos[]}` → 라벨 인쇄 항목 `[{assetNo, qrText, title, sub:"학교 · 실"}]` (최대 60장, `labelsHtml`) |
| POST | `/api/qr/reserve` | `ASSET_WRITE` | `{count 1~100, year?, schoolId?}` → 빈 라벨용 번호 예약 `CB-2026-5xxxx`. 라벨을 먼저 붙이고 나중에 그 번호로 자산을 등록하면 자동 연결 |
| GET | `/a/{assetNo}`, `/r/{roomId}` | 공개 | 라벨에 인쇄된 주소 → 302로 프런트 라우트(`ASSET_LINK`, `ROOM_LINK` 템플릿) |

자산번호 체계: `{기관접두어}-{취득연도}-{일련번호 5자리}` (예 `CB-2024-00012`). 접두어는 `Org.assetNoPrefix`, 없으면 기존 `HW-2026-0008` 형식.

### 5.3 재물조사 — `/api/as/inventory` (권한 `INVENTORY`)

실 QR 또는 실 선택 → 자산 라벨 QR을 차례로 스캔 → 실 완료 → 보고서 → 이동 반영.

| 메서드 | 경로 | 설명 |
|---|---|---|
| GET | `/api/as/inventory?schoolId` | 조사 세션 목록 |
| POST | `/api/as/inventory` | `{schoolId, title?}` 시작 |
| POST | `/api/as/inventory/{id}/scans` | `{roomId, assetNo | text}` → `result`: `FOUND`(제자리) · `DUPLICATE`(이미 확인) · `MOVED`(다른 실 자산, `fromRoomId`) · `UNKNOWN`(미등록 번호). 자산 QR이 아니면 400 (`invHandle`) |
| PUT | `/api/as/inventory/{id}/rooms/{roomId}` | `{done:true|false}` 실 조사 완료 표시 |
| GET | `/api/as/inventory/{id}` | 보고서: 실별 등록·확인·**미확인(완료한 실만)**·이동 발견·미등록, 스캔 목록 (`ivReport`) |
| POST | `/api/as/inventory/{id}/apply-moves` | `{scanIds?[]}` 이동 발견 자산을 스캔한 실로 옮김(자산 이력 "재물조사에서 이동 확인") |
| POST | `/api/as/inventory/{id}/close` | 종료 (이후 스캔 409) |

### 5.4 자산 일괄 등록 — `/api/assets/bulk` (권한 `ASSET_BULK`)  (대표님 코멘트 4)

동료 UI의 `BK_HEAD` 열 순서 그대로: **기관명 · 분류 · 품명·규격 · 취득일(YYYY-MM-DD) · 내용연수(년) · 위치 · 상태**

| 메서드 | 경로 | 설명 |
|---|---|---|
| GET | `/api/assets/bulk/template` | xlsx 양식: 자산 시트(헤더+예시 2행+기관·분류·상태 드롭다운), 안내 시트, 실 목록 시트 (`bkTemplate`) |
| POST | `/api/assets/bulk/validate` | multipart `file` **또는** JSON `{rows:[[헤더],[행]...]}` → `{total, ok, error, rows:[{rowNo, cells, errors[], warning, ok, asset}]}` (`bkValidate`) |
| POST | `/api/assets/bulk/commit` | 같은 입력 + `skipErrors` → `{created, skipped, assets:[{rowNo, assetId, assetNo}]}` |

검증 규칙: 헤더 7개 일치 · 최대 2,000행 · 수식 주입(`=`, `+`, `@`, `-`로 시작) 차단 · 기관명은 존재하는 학교이며 학교 담당자는 자기 학교만 · 분류는 분류명 일치 · 품명 60자 이내 · 취득일은 `YYYY-MM-DD`(`2023.05.02`, `20230502`도 허용)이며 오늘 이후 불가 · 내용연수 1~15(비우면 분류 기본값) · 위치는 실 이름/실번호(없으면 경고 후 비고에 기록) · 상태 사용/유휴/수리/불용예정/불용. 등록된 자산은 자동 채번되고 실·층·건물이 연결됩니다.

### 5.5 자산 (기존 `/api/assets` 확장)

- `schoolId`, `roomId`, `lifeYears` 필드 추가. `lifeYears`가 없으면 분류 기본값, 상세의 `lifeExceeded`(내용연수 경과)로 불용예정 판단.
- 상태 `DISPOSE_PLANNED`(불용예정) 추가.
- `GET /api/assets/categories`에 `lifeYears` 포함.

---

## 6. 동료 UI 함수 ↔ API 매핑

| UI(클론 HTML) | 백엔드 |
|---|---|
| `loginOk` | `POST /api/auth/login` → 토큰 또는 `step:"otp"` |
| `otpHtml` | `POST /api/auth/otp/verify`, `/otp/resend` |
| `qrLoginHtml`, `newQr` | `POST /api/auth/qr/start` → `qrText`를 QR로; 2초마다 `GET /api/auth/qr/{token}`; 휴대폰은 `/qr/{token}/info` → `/approve` |
| `ME` | `GET /api/auth/me` (`permissions`로 메뉴 가드) |
| `MENU`(스크랩) | `GET/POST/DELETE /api/auth/me/scraps` |
| `mpPw` | `PUT /api/auth/password` |
| `SEC`(보안 설정·로그인 이력) | `PUT /api/auth/me {otpEnabled}`, `GET /api/auth/me/logins` |
| `REG`, `SCH`, `VEND`, `INST` | `/api/as/regions`, `/schools`, `/vendors`, `/vendors/{id}/engineers` |
| `EQ`(무선 장비) | `/api/as/wireless-devices` |
| `INC`(AS 접수 건) | `/api/as/requests` + `/{sn}/{action}`; 코드표 `/codes` |
| `SMRT`(스마트기기) | `/api/as/requests?rceptTy=T` |
| `POSTS`, `postAnswer` | `/api/as/boards/{code}`, `/{id}/comments` |
| `LOGS` | 상세의 `histories` / `GET /api/auth/me/logins` |
| `AST` | `/api/assets`, `/api/assets/by-no/{assetNo}`, `/api/assets/bulk/*` |
| `SPC`, `PLANS`, `assignRoom`, `placeAt` | `/api/as/spaces/*`, 도면 `/api/places/floors/{id}/plan` |
| `openScan`, `gotScan` | `POST /api/qr/resolve` → type에 따라 자산/실/로그인 승인 화면으로 |
| `labelsHtml` | `POST /api/qr/labels` + `GET /api/qr/asset/{no}.png`; 빈 라벨 `POST /api/qr/reserve` |
| `bkTemplate`, `bkValidate` | `/api/assets/bulk/template`, `/validate`, `/commit` |
| `invHandle`, `ivReport` | `/api/as/inventory/*` |

---

## 7. 데이터 모델 (추가 테이블)

| 테이블 | 내용 |
|---|---|
| `as_regions` | 교육지원청 (도교육청은 `regionId` 없음) |
| `schools` | 학교: 지역, 학교코드, 유형, 계약 상태 |
| `vendors` | 유지관리 업체: `serviceTypes` (C,M,S,T csv) |
| `school_vendors` | 학교 × 유형 → 업체·기사 |
| `wireless_devices` | 무선망 장비 |
| `as_requests`, `as_histories` | AS 신청과 처리 이력 |
| `posts`, `post_comments` | 게시판 6종 |
| `as_contacts` | 문의처 |
| `rooms` | 실 (건물·층·도면 사각형) |
| `inventory_sessions`, `inventory_scans` | 재물조사 |
| `asset_no_reservations` | 빈 라벨 번호 예약 |
| `qr_login_sessions`, `otp_challenges`, `login_histories`, `menu_scraps` | 인증·계정 |
| 기존 `users` | + `school_id`, `vendor_id`, `otp_enabled`, `locked_until`, `password_changed_at`; `email`·`mobile` 암호화 |
| 기존 `assets`, `buildings`, `asset_categories`, `orgs` | + `school_id`, `room_id`, `life_years` / `school_id` / `life_years` / `asset_no_prefix` |

JPA `ddl-auto: update`라 기존 H2·PostgreSQL DB에 그대로 기동하면 테이블·컬럼이 추가되고, 학교가 하나도 없으면 `AsDataSeeder`가 데모 데이터를 넣습니다.

---

## 8. 환경 변수

| 변수 | 기본값 | 설명 |
|---|---|---|
| `JWT_SECRET` | change-me… | **운영 전 반드시 변경** (32자 이상) |
| `DATA_KEY` | bingoasm-dev-data-key… | 이메일·휴대폰 AES-256-GCM 키. **운영 전 반드시 변경**, 바꾸면 기존 암호문은 복호화 불가 |
| `OTP_DEV_ECHO` | true | `false`면 OTP 코드를 응답에 넣지 않음(운영) |
| `QR_BASE_URL` | http://localhost:8080 | 라벨 QR과 로그인 QR에 들어갈 주소 (휴대폰이 접속할 수 있는 주소) |
| `ASSET_LINK` / `ROOM_LINK` | `/assets/by-no/{assetNo}` / `/rooms/{roomId}` | `/a/`, `/r/` 공개 주소가 보낼 프런트 라우트 |
| `PORT`, `DATA_DIR`, `SPRING_PROFILES_ACTIVE=postgres`, `DB_URL/DB_USER/DB_PASSWORD` | 기존 | 기존과 같음 |

---

## 9. 데모 계정과 테스트

| 아이디 | 비밀번호 | 역할 |
|---|---|---|
| `school01` / `school02` | user1234! | 학교 담당자 (봉황초등학교 / 온천중학교) |
| `netengineer` | user1234! | 한빛네트웍스 기사 (무선망·스쿨넷) — 접근권한표의 엔지니어 |
| `vendoradmin` | user1234! | 한빛네트웍스 업체 관리자 |
| `eduadmin` | user1234! + OTP | 교육청 관리자 (통합관리). 개발 모드에서는 로그인 응답의 `devCode`가 OTP |
| `regionadmin` | user1234! | 교육지원청 담당자 (청주교육지원청). 관내 학교만 |
| `admin` | admin1234! | 시스템 관리자 (기존) |

학교·업체·사람은 모두 가상입니다.

통합 테스트(171개 검사, 로그인·OTP·QR 로그인·접근권한표·AS 전 흐름·게시판·통계·도면·QR·재물조사·일괄등록·첨부·기존 기능 회귀):

```bash
BINGOASM_URL=http://localhost:8080 python3 scripts/as_integration_test.py
```

새 DB(데모 데이터)에 대해 실행하도록 만들어져 있습니다. 같은 서버에 두 번 돌리면 데이터가 쌓여 일부 수치 검사가 달라질 수 있고, 로그인 요청 제한(분당 20회) 때문에 1분 간격을 두세요.
