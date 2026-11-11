-- V10: 스쿨넷 SLA 기준 (교육청마다 한 줄). 없으면 기본값(접수 30분 · 도착 4시간 · 복구 8시간/24시간 · 가용률 99.5%).
create table sla_targets (
    org_id bigint not null,
    receive_min integer not null,
    visit_min integer not null,
    recover_full_min integer not null,
    recover_partial_min integer not null,
    availability_pct float(53) not null,
    updated_at timestamp(6),
    updated_by bigint,
    primary key (org_id)
);
