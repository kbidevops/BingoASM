-- V11: 건물 · 층 기능 권한 SPACE_BUILDING을 넷으로 나눈다 (건물 추가 · 건물 삭제 · 층 추가 · 층 삭제).
-- 예전에 끈 SPACE_BUILDING(역할 · 사용자)은 네 기능을 모두 끈 것으로 옮겨, 저장해 둔 설정이 그대로 유지되게 한다.
insert into role_perm_overrides (org_id, role_code, perm_code, effect, updated_at, updated_by)
select o.org_id, o.role_code, c.code, o.effect, o.updated_at, o.updated_by
from role_perm_overrides o
cross join (select 'SPACE_BUILDING_CREATE' as code union all select 'SPACE_BUILDING_DELETE'
            union all select 'SPACE_FLOOR_CREATE' union all select 'SPACE_FLOOR_DELETE') c
where o.perm_code = 'SPACE_BUILDING';
delete from role_perm_overrides where perm_code = 'SPACE_BUILDING';

insert into user_perm_denies (user_id, perm_code)
select d.user_id, c.code
from user_perm_denies d
cross join (select 'SPACE_BUILDING_CREATE' as code union all select 'SPACE_BUILDING_DELETE'
            union all select 'SPACE_FLOOR_CREATE' union all select 'SPACE_FLOOR_DELETE') c
where d.perm_code = 'SPACE_BUILDING';
delete from user_perm_denies where perm_code = 'SPACE_BUILDING';
