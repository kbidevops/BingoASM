# DB 스키마 변경 (Flyway)

BingoASM의 테이블·컬럼은 **Flyway 마이그레이션 SQL 파일**로만 바꿉니다. 서버가 뜰 때 Flyway가 아직 적용하지 않은 파일을 순서대로 실행하고, 그다음 Hibernate가 엔티티와 DB가 맞는지 **검사만** 합니다(`ddl-auto: validate`). 그래서 개발(H2·PostgreSQL)과 운영(PostgreSQL)의 스키마가 같은 파일로 만들어지고, 엔티티를 바꾸고 마이그레이션을 빠뜨리면 서버가 뜨지 않아 바로 드러납니다.

| 위치 | 내용 |
|---|---|
| `server/src/main/resources/db/migration/` | 마이그레이션 파일 (`V1__baseline.sql`, `V2__…sql`, …) |
| `scripts/schema_ddl.sh` | 지금 엔티티로 만든 CREATE 문 전체를 출력 (마이그레이션 작성용) |
| `flyway_schema_history` 테이블 | DB마다 어떤 파일이 언제 적용됐는지 Flyway가 기록 |

## 1. 엔티티를 바꿀 때 (새 마이그레이션 작성)

1. 엔티티를 고칩니다. 예: `AsContract`에 `contractNo` 필드 추가.
2. 바뀐 부분을 확인합니다. 바꾸기 전과 후에 각각 출력해서 비교합니다.
   ```bash
   git stash && scripts/schema_ddl.sh > /tmp/before.sql && git stash pop
   (cd server && ./mvnw -q package -DskipTests) && scripts/schema_ddl.sh > /tmp/after.sql
   diff /tmp/before.sql /tmp/after.sql
   ```
3. 다음 번호로 파일을 만듭니다. 이름은 `V{번호}__{설명}.sql` (밑줄 두 개).
   ```sql
   -- V2__contract_no.sql
   alter table as_contracts add column contract_no varchar(50);
   ```
4. 서버를 띄우면 적용됩니다. 로그에 `Successfully applied 1 migration … now at version v2`가 나옵니다.
5. 통합 테스트를 돌립니다 (격리 서버, `BINGOASM_URL` 지정).

### 규칙

- **이미 커밋·배포한 파일은 고치지 않습니다.** Flyway가 파일 체크섬을 기록해 두어, 고치면 `Validate failed: Migration checksum mismatch`로 서버가 뜨지 않습니다. 잘못 만든 변경은 다음 번호 파일로 되돌립니다.
- 번호는 겹치면 안 됩니다. 여러 사람이 동시에 작업하면 머지 전에 번호를 확인합니다.
- H2(기본 개발 DB)와 PostgreSQL(운영)에서 **모두** 돌아가는 SQL만 씁니다. 표준 `alter table … add column`, `create table`, `create index`, `update …`는 둘 다 됩니다. PostgreSQL 전용 문법(`DO $$ … $$`, `jsonb`, 함수)은 쓰지 않습니다.
- 컬럼 타입은 `scripts/schema_ddl.sh`가 출력한 그대로 씁니다 (예: 날짜시간 `timestamp(6)`, 문자열 `varchar(n)`). 다르면 `Schema-validation: wrong column type`으로 서버가 뜨지 않습니다.
- 데이터 정리도 마이그레이션으로 할 수 있습니다 (`update`, `insert`). 실행은 DB마다 한 번뿐입니다.
- 컬럼·테이블을 지울 때는 먼저 코드에서 쓰지 않게 배포한 뒤, 다음 배포에서 지웁니다. 같은 배포에서 지우면 롤백할 때 이전 jar가 뜨지 않습니다.

## 2. Flyway 도입 전부터 쓰던 DB (한 번만)

Flyway 이전에는 Hibernate가 `ddl-auto: update`로 스키마를 만들었습니다. 그런 DB에 새 jar를 처음 띄우면:

- Flyway는 `V1__baseline.sql`을 **실행하지 않고** 버전 1로 기준선만 찍습니다 (`baseline-on-migrate`). 데이터는 그대로입니다.
- 그 DB가 최신 엔티티보다 뒤처져 있으면(예: 계약·예산 테이블, 청구 컬럼이 없음) 검사에서 `Schema-validation: missing table [as_budgets]`처럼 실패하고 서버가 뜨지 않습니다. 데이터는 바뀌지 않습니다.

그래서 **첫 기동 한 번만** `DDL_AUTO=update`로 띄워 빠진 테이블·컬럼을 채우고, 그 뒤로는 지웁니다.

### 운영 서버 절차 (Rocky Linux, `/cvms/bin/srv/asm/`)

```bash
# 1) 백업 (컨테이너 이름은 docker ps로 확인)
docker exec <pg-container> pg_dump -U <db-user> -d <db-name> -Fc > /cvms/bin/srv/asm/db/before-flyway-$(date +%Y%m%d).dump

# 2) 새 jar로 바꾸고, asm.env에 한 줄 추가
echo 'DDL_AUTO=update' >> /cvms/bin/srv/asm/asm.env
#    서버 재시작 → 로그에서 "Successfully baselined schema with version: 1" 과 "Started BingoAsmApplication" 확인

# 3) asm.env에서 그 줄을 지우고 다시 재시작
sed -i '/^DDL_AUTO=update$/d' /cvms/bin/srv/asm/asm.env
#    로그에 Schema-validation 오류 없이 "Started BingoAsmApplication" 이면 끝
```

3)에서 `Schema-validation` 오류가 나면 그 DB에 엔티티와 다른 부분이 남아 있다는 뜻입니다 (예: 예전에 만든 컬럼의 타입이 지금 엔티티와 다름 — `update`는 타입을 바꾸지 않습니다). 오류 메시지의 테이블·컬럼을 고치는 마이그레이션 파일을 만들어 배포합니다. 급하면 `DDL_AUTO=update`를 다시 넣어 서버를 살려 두고 고칩니다.

개발 PC의 H2 DB(`server/data`)나 Docker PostgreSQL도 같습니다. 서버가 `Schema-validation`으로 안 뜨면 한 번만 `DDL_AUTO=update`로 띄웁니다. 데모 데이터만 있는 DB라면 `npm run reset-db`로 지우고 새로 만들어도 됩니다.

## 3. 새 DB

빈 DB(새 운영 서버, `npm run reset-db` 뒤의 H2, 새 Docker 볼륨)는 `V1__baseline.sql`부터 차례로 실행됩니다. 따로 할 일이 없습니다.

## 4. 문제 해결

| 로그 | 뜻 | 할 일 |
|---|---|---|
| `Schema-validation: missing table [x]` / `missing column [y] in table [x]` | 엔티티에 있는 테이블·컬럼이 DB에 없음 | 마이그레이션을 빠뜨렸으면 추가. Flyway 이전 DB면 2장 절차 |
| `Schema-validation: wrong column type encountered in column [y]` | 타입이 엔티티와 다름 | `scripts/schema_ddl.sh` 출력의 타입으로 바꾸는 마이그레이션 |
| `Validate failed: Migration checksum mismatch for migration version N` | 이미 적용된 파일을 고침 | 파일을 원래대로 되돌리고, 변경은 새 번호 파일로 |
| `Migration V2__x.sql failed` | SQL 오류. PostgreSQL은 그 파일 전체가 롤백됨 | SQL을 고친 뒤 재기동. H2에서 일부만 적용됐으면 `flyway_schema_history`의 실패 행을 지우고 재기동 |
| `Flyway upgrade recommended: H2 2.2.224 is newer than this version of Flyway` | 경고일 뿐 | 무시해도 됩니다 |

## 5. H2 데이터를 PostgreSQL로 옮기기 (`H2ToPostgres`)

개발 H2 파일(`server/data/bingoasm.mv.db`)의 모든 행을 PostgreSQL로 복사하는 도구가 서버 jar 안에 있습니다. 앱을 띄우지 않고 실행하며, 드라이버가 jar에 들어 있어 따로 설치할 것이 없습니다.

- 대상 PostgreSQL에는 Flyway 스키마가 있어야 합니다 (새 jar로 한 번 기동한 DB). 없으면 안내하고 멈춥니다.
- 두 DB에 모두 있는 컬럼만 복사하고, id를 그대로 두며, 끝나면 id 카운터를 맞춥니다.
- 개인정보(users.mobile·email)는 H2의 키(`SOURCE_DATA_KEY`, 기본은 개발 기본 키)로 풀어 대상의 `DATA_KEY`로 다시 암호화합니다. `DATA_KEY`가 없으면 비웁니다.
- 대상에 데이터가 있으면 `--replace` 없이는 멈춥니다. `--replace`는 대상의 기존 데이터를 **모두 지우고** H2 데이터로 바꿉니다.
- 한 트랜잭션이라 중간에 실패하면 대상은 그대로입니다.

운영 서버(Rocky Linux)에서 실행하는 예:

```bash
cd /cvms/bin/srv/asm
# 0) 새 jar로 한 번 기동해 Flyway 스키마가 있는 상태에서, 앱을 멈춘다
# 1) 백업
docker exec bingoasm-postgres pg_dump -U bingoasm -d bingoasm -Fc > backup/before-h2-import-$(date +%Y%m%d).dump
# 2) H2 파일을 올린다 (예: /cvms/bin/srv/asm/import/bingoasm.mv.db) — 개발 서버를 멈춘 뒤 복사한 파일
# 3) asm.env의 DB_URL·DB_USER·DB_PASSWORD·DATA_KEY를 불러와 미리보기
set -a; . ./asm.env; set +a
java -cp bingoasm-server.jar -Dloader.main=com.bingoasm.tools.H2ToPostgres \
     org.springframework.boot.loader.launch.PropertiesLauncher --source=import/bingoasm.mv.db --dry-run
# 4) 표를 확인한 뒤 실제 복사
java -cp bingoasm-server.jar -Dloader.main=com.bingoasm.tools.H2ToPostgres \
     org.springframework.boot.loader.launch.PropertiesLauncher --source=import/bingoasm.mv.db --replace
# 5) 첨부 파일: 개발 PC의 server/data/uploads/* 를 /cvms/bin/srv/asm/data/uploads/ 로 복사
# 6) 앱 기동 → 로그인 확인
```

주의: 계정·비밀번호도 H2의 것이 됩니다 (데모 계정이면 `admin1234!` 등). 운영에 옮겼다면 바로 비밀번호를 바꿉니다.

## 6. 개발 데이터를 운영과 맞추기

스키마는 Flyway로 같아지지만 **데이터**(지역, 문의처, 업체, 계약 등)는 DB마다 따로입니다. 운영 데이터를 개발로 가져오려면 `pg_dump` → 개발 Docker PostgreSQL에 `pg_restore` 한 뒤, 개발 서버의 `DATA_KEY`로는 운영의 암호화된 개인정보를 풀 수 없으므로 `UPDATE users SET mobile = NULL, email = NULL;`로 지웁니다. 첨부 파일은 DB 밖(`DATA_DIR/uploads`)에 있어 따로 복사합니다. 반대 방향(개발 H2 → 운영)은 5장의 도구로 하며, 운영 데이터를 통째로 바꾸므로 백업 후에만 합니다.
