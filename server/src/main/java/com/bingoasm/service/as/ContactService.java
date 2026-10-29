package com.bingoasm.service.as;

import com.bingoasm.auth.CurrentUser;
import com.bingoasm.auth.PermissionService;
import com.bingoasm.common.*;
import com.bingoasm.domain.AppUser;
import com.bingoasm.domain.as.AsCodes;
import com.bingoasm.domain.as.Contact;
import com.bingoasm.domain.as.Region;
import com.bingoasm.domain.as.School;
import com.bingoasm.domain.as.SchoolVendor;
import com.bingoasm.domain.as.Vendor;
import com.bingoasm.repo.UserRepository;
import com.bingoasm.repo.as.ContactRepository;
import com.bingoasm.repo.as.SchoolVendorRepository;
import com.bingoasm.repo.as.VendorRepository;
import java.util.*;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** 문의처 안내: 도교육청(regionId null)과 교육지원청별 담당자. */
@Service
@Transactional
public class ContactService {
    private final ContactRepository contacts;
    private final SchoolService schoolService;
    private final SchoolVendorRepository schoolVendors;
    private final VendorRepository vendors;
    private final UserRepository users;
    private final PermissionService permissions;

    public ContactService(ContactRepository contacts, SchoolService schoolService, SchoolVendorRepository schoolVendors,
                          VendorRepository vendors, UserRepository users, PermissionService permissions) {
        this.contacts = contacts; this.schoolService = schoolService; this.schoolVendors = schoolVendors;
        this.vendors = vendors; this.users = users; this.permissions = permissions;
    }

    private static Json view(Contact c) {
        return Json.obj().with("contactId", c.contactId).with("regionId", c.regionId).with("groupName", c.groupName).with("itemName", c.itemName)
                .with("tel", c.tel).with("note", c.note)
                .with("duties", c.duties == null || c.duties.isBlank() ? List.of() : Arrays.stream(c.duties.split("\\r?\\n")).map(String::trim).filter(x -> !x.isEmpty()).toList())
                .with("sortOrder", c.sortOrder);
    }

    /** [{regionId, regionName, groups:[{groupName, items:[...]}]}] — 도교육청이 먼저. 문의처가 없는 교육지원청도 (편집할 수 있게) 빈 채로 나온다. */
    @Transactional(readOnly = true)
    public List<Json> grouped(CurrentUser me) {
        Map<Long, Region> rm = schoolService.regionMap(me.orgId());
        List<Contact> all = contacts.findByOrgIdOrderBySortOrderAsc(me.orgId());
        Map<Long, List<Contact>> byRegion = new LinkedHashMap<>();
        byRegion.put(null, new ArrayList<>());
        for (Region r : rm.values()) byRegion.put(r.regionId, new ArrayList<>());
        for (Contact c : all) byRegion.computeIfAbsent(c.regionId, k -> new ArrayList<>()).add(c);
        List<Json> out = new ArrayList<>();
        byRegion.forEach((rid, list) -> {
            if (rid != null && !rm.containsKey(rid)) return;  // 지워진 교육지원청의 남은 항목
            Map<String, List<Json>> groups = new LinkedHashMap<>();
            for (Contact c : list) groups.computeIfAbsent(c.groupName, k -> new ArrayList<>()).add(view(c));
            List<Json> gs = new ArrayList<>();
            groups.forEach((g, items) -> gs.add(Json.obj().with("groupName", g).with("items", items)));
            out.add(Json.obj().with("regionId", rid).with("regionName", rid == null ? "도교육청" : rm.get(rid).regionName).with("groups", gs));
        });
        return out;
    }

    /** 전체 교체. rows: [{regionId, groupName, itemName, tel, note, duties:[...]|"a\nb"}] */
    public List<Json> replaceAll(CurrentUser me, List<Map<String, Object>> rows) {
        contacts.deleteByOrgId(me.orgId());
        save(me, rows, null, false);
        return grouped(me);
    }

    /**
     * 한 구역(도교육청 = regionId null, 또는 교육지원청 하나)의 문의처만 교체.
     * 도교육청 관리자는 어느 구역이든, 교육지원청 담당자는 자기 교육지원청만 고칠 수 있다.
     */
    public List<Json> replaceSection(CurrentUser me, Long regionId, List<Map<String, Object>> rows) {
        var sc = me.scope();
        if (!sc.province() && !(sc.region() && regionId != null && regionId.equals(sc.regionId())))
            throw ApiException.forbidden(regionId == null ? "도교육청 문의처는 도교육청 관리자만 고칠 수 있습니다." : "자기 교육지원청의 문의처만 고칠 수 있습니다.");
        if (regionId != null && !schoolService.regionMap(me.orgId()).containsKey(regionId)) throw ApiException.notFound("교육지원청을 찾을 수 없습니다.");
        if (regionId == null) contacts.deleteByOrgIdAndRegionIdIsNull(me.orgId());
        else contacts.deleteByOrgIdAndRegionId(me.orgId(), regionId);
        save(me, rows, regionId, true);
        return grouped(me);
    }

    private void save(CurrentUser me, List<Map<String, Object>> rows, Long regionId, boolean fixedRegion) {
        int i = 0;
        for (Map<String, Object> r : rows == null ? List.<Map<String, Object>>of() : rows) {
            Contact c = new Contact();
            c.orgId = me.orgId(); c.regionId = fixedRegion ? regionId : Params.lng(r, "regionId");
            c.groupName = Params.str(r, "groupName"); c.itemName = Params.str(r, "itemName");
            if (c.groupName == null || c.itemName == null) continue;
            c.tel = Params.str(r, "tel"); c.note = Params.str(r, "note");
            Object d = r.get("duties");
            c.duties = d instanceof List<?> l ? String.join("\n", l.stream().map(String::valueOf).toList()) : d == null ? null : String.valueOf(d);
            c.sortOrder = ++i;
            contacts.save(c);
        }
    }

    /**
     * 우리 학교 담당업체: 학교에 지정된 서비스별 업체·기사와 연락처 (기관정보관리 → 담당업체).
     * 학교 담당자는 자기 학교, 그 밖에는 범위 안에서 고른 학교. 교육청이 쓰는 서비스만, 지정이 없으면 vendorName 없이 나온다.
     */
    @Transactional(readOnly = true)
    public Json providers(CurrentUser me, Long schoolId) {
        Long sid = me.scope().school() ? me.scope().schoolId() : schoolId;
        if (sid == null) throw ApiException.badRequest("학교를 선택해 주세요.");
        School s = schoolService.loadSchool(me, sid);
        Map<String, SchoolVendor> byType = new HashMap<>();
        for (SchoolVendor sv : schoolVendors.findBySchoolId(s.schoolId)) byType.put(sv.rceptTy, sv);
        List<Json> items = new ArrayList<>();
        for (String ty : permissions.asTypes(me.orgId())) {
            SchoolVendor sv = byType.get(ty);
            Vendor v = sv == null || sv.vendorId == null ? null : vendors.findById(sv.vendorId).filter(x -> "Y".equals(x.useYn)).orElse(null);
            AppUser e = v == null || sv.engineerUserId == null ? null : users.findById(sv.engineerUserId).orElse(null);
            items.add(Json.obj().with("rceptTy", ty).with("rceptTyName", AsCodes.RCEPT_TY_NAME.get(ty))
                    .with("vendorName", v == null ? null : v.vendorName).with("vendorTel", v == null ? null : v.tel)
                    .with("engineerName", e == null ? null : e.userName).with("engineerTel", e == null ? null : e.mobile));
        }
        return Json.obj().with("schoolId", s.schoolId).with("schoolName", s.schoolName).with("items", items);
    }
}
