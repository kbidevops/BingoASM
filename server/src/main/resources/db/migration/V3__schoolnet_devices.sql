-- V3: 스쿨넷장비관리. 무선장비와 같은 표(wireless_devices)를 쓰고 rcept_ty로 나눈다 (M 무선망 / S 스쿨넷).
-- 스쿨넷 장비에만 쓰는 회선 정보: 통신사·회선번호·회선 속도.
alter table wireless_devices add column rcept_ty varchar(1) default 'M';
update wireless_devices set rcept_ty = 'M' where rcept_ty is null;
alter table wireless_devices add column carrier varchar(30);
alter table wireless_devices add column circuit_id varchar(50);
alter table wireless_devices add column bandwidth varchar(30);

create index idx_wireless_devices_org_type on wireless_devices (org_id, rcept_ty);
