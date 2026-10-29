# 문서 안내

용도별로 문서 하나씩만 둡니다. 내용이 겹치지 않게 역할을 나눴으니, 고칠 때도 해당 문서 하나만 고치면 됩니다.

| 문서 | 누가 | 무엇을 |
|---|---|---|
| **Swagger UI** (`http://localhost:8080/swagger-ui.html`) | 모두 | 서버 코드에서 자동 생성되는 API 문서. 엔드포인트·요청·응답·권한, 브라우저에서 바로 호출. **API에 대해 다른 문서와 다르면 이것이 맞습니다** |
| `원클릭AS_소개(비개발자용).docx` | 비개발자·대표님 | 이 시스템이 하는 일, 누가 무엇을 할 수 있나, AS 처리 흐름 그림, 주요 기능, 보안 — 3쪽 |
| `원클릭AS_API_레퍼런스.docx` | 화면 개발자 | API를 "호출 / 하는 일" 두 열로 요약한 Word (12개 절) |
| [FRONTEND_GUIDE.md](FRONTEND_GUIDE.md) | 화면 개발자 | 동료 UI 클론 검토, 대표님 코멘트 4가지 반영, 화면 연결 순서 10단계, UI 함수 ↔ API 매핑 |
| [API_REFERENCE.md](API_REFERENCE.md) | 백엔드·화면 개발자 | 필드 단위 API 명세: 권한표, 인증·보안, AS 상태 전이와 처리 규칙, 유형별 신청 필드, 데이터 모델, 환경 변수 |
| [ARCHITECTURE.md](ARCHITECTURE.md) | 백엔드 개발자 | 패키지 구조, 권한 모델, 보안 구현, 데이터 모델, 원클릭 AS 모듈 설계 |
| [VERIFICATION_REPORT.md](VERIFICATION_REPORT.md) | 검수·PM | 원본 대비 검증, H2·PostgreSQL, 원클릭 AS 통합 테스트 171개 결과와 고친 문제 |

온라인(Claude Docs)에도 같은 두 문서가 있습니다 — 「원클릭 AS 소개 (비개발자용)」, 「원클릭 AS API 레퍼런스」. 코멘트를 달면 반영합니다.

이전 버전(Word v1~v6, 초기 아키텍처 PPT/PDF, 옛 React 화면 기능 정의서)은 `../legacy/docs-archive/`에 모아 두었습니다. 필요 없으면 지워도 됩니다.
