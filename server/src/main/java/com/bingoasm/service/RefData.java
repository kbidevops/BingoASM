package com.bingoasm.service;

import com.bingoasm.domain.*;
import com.bingoasm.repo.*;
import java.util.List;
import java.util.Map;
import java.util.function.Function;
import java.util.stream.Collectors;
import org.springframework.stereotype.Component;

/**
 * Small reference tables (users, departments, buildings, floors, categories) for one organization,
 * loaded once per request so list views can resolve names without N+1 queries.
 */
@Component
public class RefData {
    private final UserRepository users;
    private final DepartmentRepository depts;
    private final BuildingRepository buildings;
    private final FloorRepository floors;
    private final CategoryRepository categories;
    private final OrgRepository orgs;

    public RefData(UserRepository users, DepartmentRepository depts, BuildingRepository buildings, FloorRepository floors,
                   CategoryRepository categories, OrgRepository orgs) {
        this.users = users;
        this.depts = depts;
        this.buildings = buildings;
        this.floors = floors;
        this.categories = categories;
        this.orgs = orgs;
    }

    public Ref forOrg(Long orgId) {
        List<Building> bs = buildings.findByOrgId(orgId);
        return new Ref(
                orgs.findById(orgId).orElse(null),
                index(users.findByOrgIdOrderByUserIdAsc(orgId), u -> u.userId),
                index(depts.findByOrgId(orgId), d -> d.deptId),
                index(bs, b -> b.buildingId),
                index(floors.findByBuildingIdInOrderBySortOrderAsc(bs.stream().map(b -> b.buildingId).toList()), f -> f.floorId),
                index(categories.findAll(), c -> c.categoryId));
    }

    private static <T> Map<Long, T> index(List<T> list, Function<T, Long> key) {
        return list.stream().collect(Collectors.toMap(key, Function.identity(), (a, b) -> a));
    }

    public record Ref(Org org, Map<Long, AppUser> users, Map<Long, Department> depts, Map<Long, Building> buildings,
                      Map<Long, Floor> floors, Map<Long, Category> categories) {
        public String userName(Long id) { AppUser u = id == null ? null : users.get(id); return u == null ? null : u.userName; }
        public String deptName(Long id) { Department d = id == null ? null : depts.get(id); return d == null ? null : d.deptName; }
        public Building building(Long id) { return id == null ? null : buildings.get(id); }
        public Floor floor(Long id) { return id == null ? null : floors.get(id); }
        public String buildingName(Long id) { Building b = building(id); return b == null ? null : b.buildingName; }
        public String floorName(Long id) { Floor f = floor(id); return f == null ? null : f.floorName; }
        public String categoryName(Long id) { Category c = id == null ? null : categories.get(id); return c == null ? null : c.categoryName; }
    }
}
