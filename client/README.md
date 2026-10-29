# BingoASM 화면 (Next.js)

원클릭 AS 화면입니다. 동료의 UI 클론(`충북교육청_원클릭AS시스템_UI_클론.html`)과 같은 모양을 Next.js(App Router, React 19, TypeScript)로 옮기고, 데모 상수 대신 **실제 API**(`/api/...`)에 연결했습니다.

## 실행

```bash
cd client && npm install
npm run dev        # http://localhost:3000  (API는 .env.development의 http://localhost:8080)
npm run build      # 정적 파일을 client/dist 에 생성 → Spring 서버가 http://localhost:8080 에서 그대로 제공
```

- 서버를 먼저 켜 두세요 (`cd server && ./mvnw spring-boot:run`). 개발 중에는 서버 CORS가 `*`라 3000번 포트에서 바로 호출됩니다.
- `npm run build` 결과(`dist/`)는 Node 서버 없이 Spring이 제공합니다(`app.client-dist`). 이때 API는 같은 주소를 쓰므로 `NEXT_PUBLIC_API_URL`이 필요 없습니다.
- 데모 계정은 상위 README 5절 (`school01` / `user1234!`, `eduadmin`은 OTP — 개발 모드에서는 화면에 인증번호가 표시됨).

## 구조

```text
src/
├─ app/                  화면(라우트). 모두 정적 페이지 + 브라우저에서 API 호출
│  ├─ page.tsx           메인 (로그인 전 / 로그인 후 대시보드)
│  ├─ login/             아이디·OTP·QR 로그인, login/qr-approve = 휴대폰 승인 화면
│  ├─ as/{info,wireless,schoolnet}[/list], smart[/list]   AS 신청 / 결과조회
│  ├─ boards/{notice,qna,consult,disposal,vendor,sla}, boards/view, boards/write
│  ├─ mypage/            회원정보 · 비밀번호 · 나의 AS · 스크랩 · 로그인 기록
│  ├─ admin/requests     장애접수관리 (전체 AS)
│  └─ admin/*            그 외 통합관리 — 준비 중 (사용할 API 목록 표시)
├─ components/           SiteHeader, SubPage(배너·사이드·권한 가드), AsRequestForm, AsList, AsDetailModal, BoardList, ui
└─ lib/                  api(토큰·재발급), auth(세션·자동 로그아웃), menu(메뉴↔권한), as, boards, types, format
```

## 규칙

- **권한**: 메뉴는 `GET /api/auth/me`의 `permissions`로 거릅니다(`lib/menu.ts`의 `perm`). 페이지는 `<SubPage perm="...">`가 로그인·권한을 확인합니다. 최종 검사는 서버가 다시 합니다.
- **처리 버튼**: AS 상세의 `allowedActions`로만 표시합니다(접수·반려·이관·방문일 변경·보고서·평가·취소·삭제).
- **토큰**: `sessionStorage`에 저장하고 `Authorization: Bearer`로 보냅니다. 401이면 refresh 토큰으로 한 번 재발급 후 재시도, 실패하면 로그인 화면으로 갑니다.
- **자동 로그아웃**: 30분 무사용 시(2분 전 경고). `lib/auth.tsx`.
- **정적 export**: 동적 경로(`[id]`)를 쓰지 않고 쿼리(`/boards/view?code=qna&id=3`)를 씁니다. `useSearchParams`를 쓰는 페이지는 `<Suspense>`로 감쌉니다.
- **스타일**: 클론의 CSS를 `app/globals.css`로 그대로 가져와 클래스 이름(`.ftab`, `.ban`, `.side`, `.md` …)을 유지합니다.

## 아직 옮기지 않은 화면

클론에 있던 아래 화면은 서버 API는 완성되어 있고, 화면은 `admin/*`에 "준비 중"으로 API 목록만 표시합니다.

무선장비관리 · 기관자산관리(QR 라벨, 엑셀 일괄 등록) · 공간(실) 관리 · 자산 위치(도면) · 재물조사(QR 스캔) · 기관정보관리 · 업체관리 · AS통계. AS 신청 수정(`update`)과 관리자 배정(`assign`) 버튼도 아직 없습니다.
