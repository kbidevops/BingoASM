package com.bingoasm.service.as;

import com.bingoasm.auth.CurrentUser;
import com.bingoasm.common.*;
import com.bingoasm.domain.as.Contact;
import com.bingoasm.domain.as.Region;
import com.bingoasm.repo.as.ContactRepository;
import java.util.*;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** 문의처 안내: 도교육청(regionId null)과 교육지원청별 담당자. */
@Service
@Transactional
public class ContactService {
    private final ContactRepository contacts;
    private final SchoolService schoolService;

    public ContactService(ContactRepository contacts, SchoolService schoolService) {
        this.contacts = contacts; this.schoolService = schoolService;
    }

    private static Json view(Contact c) {
        return Json.obj().with("contactId", c.contactId).with("regionId", c.regionId).with("groupName", c.groupName).with("itemName", c.itemName)
                .with("tel", c.tel).with("note", c.note)
                .with("duties", c.duties == null || c.duties.isBlank() ? List.of() : Arrays.stream(c.duties.split("\\r?\\n")).map(String::trim).filter(x -> !x.isEmpty()).toList())
                .with("sortOrder", c.sortOrder);
    }

    /** [{regionId, regionName, groups:[{groupName, items:[...]}]}] — 도교육청이 먼저. */
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
            if (list.isEmpty() && rid != null) return;
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
        int i = 0;
        for (Map<String, Object> r : rows == null ? List.<Map<String, Object>>of() : rows) {
            Contact c = new Contact();
            c.orgId = me.orgId(); c.regionId = Params.lng(r, "regionId"); c.groupName = Params.str(r, "groupName"); c.itemName = Params.str(r, "itemName");
            if (c.groupName == null || c.itemName == null) continue;
            c.tel = Params.str(r, "tel"); c.note = Params.str(r, "note");
            Object d = r.get("duties");
            c.duties = d instanceof List<?> l ? String.join("\n", l.stream().map(String::valueOf).toList()) : d == null ? null : String.valueOf(d);
            c.sortOrder = ++i;
            contacts.save(c);
        }
        return grouped(me);
    }
}
