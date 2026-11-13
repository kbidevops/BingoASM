-- V19: 스쿨넷 SLA 단계마다 시간 세는 법. true = 근무 시간 달력(V14, 지연 알림과 같은 달력)으로만 센다, false = 24시간.
-- 기본은 모두 24시간 (지금까지와 같음). 회선 가용률은 늘 24시간이다.
alter table sla_targets add column receive_biz boolean default false not null;
alter table sla_targets add column visit_biz boolean default false not null;
alter table sla_targets add column recover_biz boolean default false not null;
