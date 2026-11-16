-- V22: AS 처리는 업체만 한다.
--  · 학교: 신청 · 취소 · 만족도 평가 · 재요청(처리완료 뒤 30일 안, 신청완료로 돌아간다)
--  · 업체: 업체 관리자 · 기사 누구나 접수 · 처리 (기사 배정 없음)
--  · 교육청 · 교육지원청: 보기만 (업체 배정 · 처리 담당 지정 · 대상 장비 지정 · AS 처리 흐름 설정 없음)
--  업체는 학교의 담당 업체 (무선망은 대상 장비의 유지보수 업체)로 자동으로 정한다.

-- AS 처리 흐름 설정 (V16) · 스쿨넷 첫 접수처 (V15)
drop table if exists as_workflows;
alter table orgs drop column schoolnet_route;

-- 재요청
alter table as_requests add column reopen_count integer default 0 not null;
alter table as_requests add column reopened_at timestamp(6);
alter table as_requests add column reopen_reason varchar(1000);

-- 처리 중인 건 중 교육지원청 · 교육청이 맡고 있던 건 → 학교의 담당 업체로 (같은 유형)
update as_requests set vendor_id = (
        select sv.vendor_id from school_vendors sv
         where sv.school_id = as_requests.school_id and sv.rcept_ty = as_requests.rcept_ty)
 where status in ('A', 'R') and use_yn = 'Y' and (handler_type in ('REGION', 'PROVINCE') or vendor_id is null);
-- 그렇게 업체가 정해진 건은 업체가 다시 접수한다 (교육지원청 · 교육청 담당자는 지운다)
update as_requests set handler_type = 'VENDOR', engineer_user_id = null, engineer_name = null,
        status = 'A', received_at = null, visit_planned_at = null
 where status in ('A', 'R') and use_yn = 'Y' and handler_type in ('REGION', 'PROVINCE') and vendor_id is not null;
