-- V15: AS 배정 흐름
-- 1) 장비의 유지보수 업체: 무선망 AS는 대상 장비의 업체가 맡는다. 지금은 그 학교 · 유형의 배정 업체로 채운다.
alter table wireless_devices add column vendor_id bigint;
update wireless_devices set vendor_id = (
    select sv.vendor_id from school_vendors sv
    where sv.school_id = wireless_devices.school_id and sv.rcept_ty = wireless_devices.rcept_ty);

-- 2) 처리 담당 종류: VENDOR 업체(기사) · REGION 교육지원청 · PROVINCE 교육청. 비어 있으면 VENDOR (예전 건).
alter table as_requests add column handler_type varchar(10);

-- 3) 스쿨넷 신고를 먼저 받는 곳: REGION 교육지원청이 먼저 확인(기본) · VENDOR 통신사(학교 배정 업체)로 바로.
alter table orgs add column schoolnet_route varchar(10);
