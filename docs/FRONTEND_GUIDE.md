# 동료 UI 클론 검토와 백엔드 연결 안내

대상: `충북교육청_원클릭AS시스템_UI_클론 (1).html` (단일 HTML SPA, 약 582KB, 그중 JS 약 440KB)
검토 관점: 백엔드 담당자로서 "이 화면이 그대로 API에 붙을 수 있는가", 그리고 대표님 코멘트 4가지가 화면·백엔드에서 어떻게 채워지는가.

---

## 1. 전체 평가

**잘 된 점**

- cbe.go.kr 원클릭 AS의 메뉴 구조(시스템소개 · 공지 및 자료실 · 질문 및 건의 · 컨설팅 신청 · 문의처 · 스마트기기지원 · 정보기기/무선망/스쿨넷 AS 신청·결과조회 · 불용PC수거 · 유지관리업체 · 스쿨넷 SLA · 통합관리 6종)를 빠짐없이 옮겼고, 역할별 메뉴 노출이 접근권한표와 맞습니다.
- 원본에 없는 기능(QR 로그인, QR 스캔, 라벨 인쇄, 도면 위 실 배치, 재물조사, 일괄 등록, 보안 설정)이 화면 흐름으로 이미 그려져 있어 백엔드 설계의 기준으로 삼기 좋았습니다. 백엔드는 이 화면의 데이터 전역(`MENU, REG, SCH, INST, VEND, AST, EQ, INC, SMRT, SPC, PLANS, POSTS, LOGS, SEC, ME`)과 함수(`loginOk, otpHtml, qrLoginHtml, newQr, openScan, gotScan, labelsHtml, bkValidate, bkTemplate, invHandle, ivReport, assignRoom, placeAt, postAnswer, mpPw`)를 기준으로 API를 맞췄습니다(`docs/API_REFERENCE.md` 6절 매핑표).
- 일괄 등록의 헤더(`BK_HEAD` 7열)와 검증 메시지, 재물조사의 FOUND/MOVED/UNKNOWN 구분, 라벨의 "미등록 라벨" 개념은 그대로 백엔드 규칙이 되었습니다.

**바로 붙이려면 고쳐야 할 점**

| # | 발견 | 영향 | 제안 |
|---|---|---|---|
| 1 | **서버 호출이 전혀 없음** — `fetch`/`XMLHttpRequest`가 없고 모든 데이터가 JS 전역 상수. 로그인도 `loginOk`가 상수 비교 | 데모 전용. 실제 로그인·권한·저장이 동작하지 않음 | `api.js` 한 층을 두고 전역 상수를 API 호출 결과로 교체. 매핑표대로 1:1 대응이 되도록 만들어 두었음 |
| 2 | 즐겨찾기 메뉴만 `localStorage` 저장, 나머지 상태는 새로고침하면 사라짐 | 사용자별 데이터가 브라우저에 묶임 | 스크랩은 `GET/POST/DELETE /api/auth/me/scraps`로, 나머지는 서버 상태를 읽도록 |
| 3 | 역할·권한이 화면 쪽 상수(`ME.role`)로만 판단 | 메뉴를 숨겨도 API는 열려 있는 구조가 되기 쉬움 | 백엔드가 모든 엔드포인트에서 권한·스코프를 다시 검사함(접근권한표 13개 항목 자동 테스트 통과). 화면은 `GET /api/auth/me`의 `permissions`로 메뉴를 그리면 됨 |
| 4 | OTP 코드·QR 승인 번호가 화면 상수(데모) | 실제 2단계 인증이 아님 | 서버가 OTP를 발급·해시 저장·1회 사용 처리, QR 세션은 3분 만료·토큰 1회 발급. 화면은 `devCode`(개발 모드)만 표시 |
| 5 | 단일 HTML 582KB, 인라인 JS 440KB | 유지보수·코드 리뷰가 어렵고 첫 로딩이 큼 | 화면 단위로 분리(React/Vite로 옮기면 BingoASM 클라이언트와 합칠 수 있음). 백엔드는 어느 쪽이든 동일 |
| 6 | 도면 좌표 단위가 화면마다 달라질 여지(픽셀/퍼센트) | 창 크기·해상도에 따라 어긋남 | 백엔드는 실 영역 `rect`와 자산 핀 모두 **퍼센트(0~100)** 로 저장하도록 고정 |
| 7 | 엑셀 파싱(SheetJS)을 브라우저에서만 수행 | 검증 규칙이 두 군데(화면·서버)로 갈라질 수 있음 | 서버가 파일(multipart)과 파싱된 행(JSON) 둘 다 받아 **같은 규칙**으로 검증·등록. 화면은 결과 `rows[].errors`만 표시 |
| 8 | 비밀글·첨부·진행상태 등 게시판 세부 규칙이 화면 로직에 흩어짐 | 관리자/작성자/기사 답변 권한 불일치 가능 | 서버 규칙으로 고정(비밀글은 작성자·관리자만, 답변은 관리자·기사·작성자, 진행상태는 관리자) |

---

## 2. 대표님 코멘트별 반영

| 코멘트 | 화면(동료 UI) | 백엔드 구현 | 상태 |
|---|---|---|---|
| 1. QR 로그인 또는 자산등록 | `qrLoginHtml/newQr`(PC QR + 휴대폰 승인), `openScan/gotScan`(카메라), `labelsHtml`(라벨) | QR 로그인 세션 API, `POST /api/qr/resolve`(자산/실/로그인 QR 구분), 자산 라벨·실 QR PNG 생성(zxing), 빈 라벨 번호 예약 → 라벨 붙인 뒤 등록 시 자동 연결 | 완료 (자동 테스트) |
| 2. 자산 위치 파악(도면) — 김건호 이사님 웹페이지 참고 | `SPC/PLANS`, `assignRoom`, `placeAt` | 기존 BingoASM 도면(층 이미지, 자산 핀) 위에 **실(room)** 계층 추가: 실 사각형 배치, 실별 자산 목록, 실 QR, 자산 → 실 배정, 재물조사에서 이동 반영 | 완료 |
| 3. 계정 암호화 꼼꼼히 (PHP 사건) | `SEC`, `mpPw` | BCrypt(12), 비밀번호 정책, 이메일·휴대폰 AES-256-GCM 암호화, 5회 실패 30분 잠금, IP당 요청 제한, OTP 2단계, JWT 비밀키 기본값 경고, 로그인 이력(IP 마스킹), 첨부 파일 형식 차단·nosniff, 엑셀 수식 주입 차단 | 완료 |
| 4. 자산 일괄 등록 | `bkTemplate`, `bkValidate` | 양식 생성(드롭다운·안내·실 목록 시트) → 검증(행별 오류) → 확정(오류 행 제외 옵션), 자동 채번, 실·층 연결, 내용연수 기본값 | 완료 |

---

## 3. 화면 담당자에게 전달할 연결 순서

1. **로그인** `POST /api/auth/login` → `step:"otp"`면 OTP 화면 → `POST /api/auth/otp/verify`. 토큰은 메모리/세션에, 만료 시 `POST /api/auth/refresh`.
2. **메뉴** `GET /api/auth/me`의 `permissions`로 메뉴 표시 여부 결정(접근권한표와 동일). `GET /api/as/boards`로 게시판 메뉴.
3. **AS 신청 화면** `GET /api/as/requests/codes`(셀렉트 박스), 무선망은 `GET /api/as/wireless-devices?schoolId=`, 정보기기는 `GET /api/assets?schoolId=`. 제출 `POST /api/as/requests`.
4. **결과조회** `GET /api/as/requests?rceptTy=&status=&searchType=&keyword=&fromDate=&toDate=`; 상세의 `allowedActions`로 버튼 노출; 처리 `POST /api/as/requests/{sn}/{action}`.
5. **기사 화면** 같은 API. 접수 시 방문예정일시, 보고서 `report`, 이관 `transfer`(이관 후에는 목록으로 돌아가기 — 응답에 `transferred:true`).
6. **도면** `GET /api/as/spaces/buildings?schoolId=` → 층의 `planUrl` 이미지 위에 `GET /api/as/spaces/rooms?floorId=`의 `rect`(퍼센트)로 실 그리기. 드래그 후 `PUT /api/as/spaces/rooms/{id} {rect}`. 실 클릭 → `GET /api/as/spaces/rooms/{id}`의 `assets`.
7. **QR 스캔** 카메라 문자열을 `POST /api/qr/resolve`에 보내 `type`에 따라 자산 상세·실 상세·로그인 승인(`/api/auth/qr/{token}/approve`)으로 분기.
8. **라벨 인쇄** `POST /api/qr/labels` 결과를 그리드로, 각 QR 이미지는 `GET /api/qr/asset/{assetNo}.png`(토큰 필요 → blob으로).
9. **재물조사** 시작 → 실 선택(또는 실 QR) → 스캔 → 실 완료 → 보고서 → 이동 반영 → 종료.
10. **일괄 등록** 양식 다운로드 → 파일 업로드(multipart) 또는 SheetJS 파싱 행(JSON) → 검증 결과 표 → 확정.

모든 엔드포인트·필드·권한은 `docs/API_REFERENCE.md`, 자동 테스트는 `scripts/as_integration_test.py`에 있습니다.
