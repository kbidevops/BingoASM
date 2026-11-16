-- V23: 스쿨넷 SLA 결과는 매월 올린다는 보장이 없다 — 연월 한 건 대신 제목 · 대상 기간(선택)으로, 몇 번이든 올린다.
alter table sla_reports drop constraint uk_sla_reports;
drop index if exists ix_sla_reports_org;
alter table sla_reports add column title varchar(200);
alter table sla_reports add column period_from date;
alter table sla_reports add column period_to date;
update sla_reports set title = report_year || '년 ' || report_month || '월 스쿨넷 SLA 결과' where title is null;
alter table sla_reports drop column report_year;
alter table sla_reports drop column report_month;
alter table sla_reports alter column title set not null;
create index ix_sla_reports_org on sla_reports (org_id, submitted_at);
