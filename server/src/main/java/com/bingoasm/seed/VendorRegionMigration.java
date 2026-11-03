package com.bingoasm.seed;

import com.bingoasm.domain.as.Contact;
import com.bingoasm.domain.as.Region;
import com.bingoasm.domain.as.Vendor;
import com.bingoasm.domain.as.VendorRegion;
import com.bingoasm.repo.as.ContactRepository;
import com.bingoasm.repo.as.RegionRepository;
import com.bingoasm.repo.as.SchoolVendorRepository;
import com.bingoasm.repo.as.VendorRegionRepository;
import com.bingoasm.repo.as.VendorRepository;
import com.bingoasm.service.as.ContactService;
import jakarta.persistence.EntityManager;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.CommandLineRunner;
import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

/**
 * 1) 업체의 예전 담당 지역(regionId)을 vendor_regions로 옮긴다.
 * 2) 유지보수 사업자를 업체에서 만들던 버전을 거친 DB를 되돌린다: 공개 업체(publicYn = Y)를 문의처 글자 항목으로 다시 쓰고,
 *    그 버전이 문의처 때문에 만든 업체(담당 분야 없고 어디에도 쓰이지 않음)는 지운다. 끝나면 Y가 남지 않아 다시 실행해도 할 일이 없다.
 */
@Component
@Order(4)
public class VendorRegionMigration implements CommandLineRunner {
    private static final Logger log = LoggerFactory.getLogger(VendorRegionMigration.class);
    private final VendorRepository vendors;
    private final VendorRegionRepository vendorRegions;
    private final ContactRepository contacts;
    private final RegionRepository regions;
    private final SchoolVendorRepository schoolVendors;
    private final EntityManager em;

    public VendorRegionMigration(VendorRepository vendors, VendorRegionRepository vendorRegions, ContactRepository contacts,
                                 RegionRepository regions, SchoolVendorRepository schoolVendors, EntityManager em) {
        this.vendors = vendors; this.vendorRegions = vendorRegions; this.contacts = contacts;
        this.regions = regions; this.schoolVendors = schoolVendors; this.em = em;
    }

    @Override
    @Transactional
    public void run(String... args) {
        int moved = 0;
        for (Vendor v : vendors.findAll()) {
            if (v.allRegions != null) continue;
            v.allRegions = v.regionId == null;
            if (v.regionId != null) {
                VendorRegion r = new VendorRegion();
                r.orgId = v.orgId; r.vendorId = v.vendorId; r.regionId = v.regionId;
                vendorRegions.saveAndFlush(r);
            }
            v.regionId = null;
            moved++;
        }
        if (moved > 0) log.info("Vendor regions: {} vendors moved", moved);
        restoreContacts();
    }

    private void restoreContacts() {
        List<Vendor> published = new ArrayList<>(vendors.findAll().stream().filter(v -> "Y".equals(v.publicYn)).toList());
        if (published.isEmpty()) return;
        Map<Long, List<Long>> regionsByOrg = new HashMap<>();
        for (Region r : regions.findAll()) regionsByOrg.computeIfAbsent(r.orgId, k -> new ArrayList<>()).add(r.regionId);
        Map<Long, Integer> nextSort = new HashMap<>();
        for (Contact c : contacts.findAll()) if (c.regionId != null) nextSort.merge(c.regionId, c.sortOrder == null ? 0 : c.sortOrder, Math::max);

        int rows = 0, removed = 0;
        List<VendorRegion> links = new ArrayList<>(vendorRegions.findAll());
        links.sort((a, b) -> Integer.compare(a.sortOrder == null ? 0 : a.sortOrder, b.sortOrder == null ? 0 : b.sortOrder));
        for (Vendor v : published) {
            List<VendorRegion> mine = links.stream().filter(l -> v.vendorId.equals(l.vendorId)).toList();
            Map<Long, VendorRegion> byRegion = new HashMap<>();
            for (VendorRegion l : mine) byRegion.put(l.regionId, l);
            List<Long> known = regionsByOrg.getOrDefault(v.orgId, List.of());
            List<Long> targets = Boolean.TRUE.equals(v.allRegions) ? known : mine.stream().map(l -> l.regionId).filter(known::contains).toList();
            for (Long regionId : targets) {
                VendorRegion l = byRegion.get(regionId);
                Contact c = new Contact();
                c.orgId = v.orgId; c.regionId = regionId; c.groupName = ContactService.VENDOR_GROUP; c.itemName = v.vendorName;
                c.tel = l == null || l.tel == null || l.tel.isBlank() ? v.tel : l.tel;
                c.note = l == null ? null : l.note;
                c.sortOrder = nextSort.merge(regionId, 1, Integer::sum);
                contacts.save(c);
                rows++;
            }
            v.publicYn = "N";
            if (v.serviceTypeList().isEmpty() && !inUse(v)) {
                vendorRegions.deleteAll(mine);
                vendors.delete(v);
                removed++;
            }
        }
        log.info("유지보수 사업자: {} rows restored to 문의처, {} listing-only vendors removed", rows, removed);
    }

    /** 기사·학교·AS 신청이 이 업체를 가리키면 지우지 않는다. */
    private boolean inUse(Vendor v) {
        return !schoolVendors.findByVendorId(v.vendorId).isEmpty()
                || count("select count(u) from AppUser u where u.vendorId = :id", v.vendorId) > 0
                || count("select count(r) from AsRequest r where r.vendorId = :id", v.vendorId) > 0;
    }

    private long count(String jpql, Long id) {
        return em.createQuery(jpql, Long.class).setParameter("id", id).getSingleResult();
    }
}
