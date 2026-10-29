package com.bingoasm.web.as;

import io.swagger.v3.oas.annotations.tags.Tag;
import com.bingoasm.auth.AuthContext;
import com.bingoasm.auth.RequirePerm;
import com.bingoasm.common.ApiResponse;
import com.bingoasm.service.as.SchoolService;
import java.util.List;
import java.util.Map;
import org.springframework.web.bind.annotation.*;

/** 통합관리 > 학교·지역·업체. 조회는 포털 사용자도 가능(신청 화면의 학교·업체 표시용). */
@Tag(name = "기준정보 · 지역·학교·업체", description = "교육지원청, 학교, 학교별 담당 업체·기사 매핑, 유지관리 업체, 기사 목록")
@RestController
@RequestMapping("/api/as")
public class SchoolController {
    private final SchoolService schools;

    public SchoolController(SchoolService schools) { this.schools = schools; }

    // ----- regions -----
    @GetMapping("/regions")
    public ApiResponse regions() { return ApiResponse.ok(schools.regions(AuthContext.get())); }

    @PostMapping("/regions")
    @RequirePerm("SCHOOL_MANAGE")
    public ApiResponse createRegion(@RequestBody Map<String, Object> body) { return ApiResponse.ok(schools.saveRegion(AuthContext.get(), null, body)); }

    @PutMapping("/regions/{id}")
    @RequirePerm("SCHOOL_MANAGE")
    public ApiResponse updateRegion(@PathVariable Long id, @RequestBody Map<String, Object> body) { return ApiResponse.ok(schools.saveRegion(AuthContext.get(), id, body)); }

    @DeleteMapping("/regions/{id}")
    @RequirePerm("SCHOOL_MANAGE")
    public ApiResponse deleteRegion(@PathVariable Long id) { schools.deleteRegion(AuthContext.get(), id); return ApiResponse.ok(null); }

    // ----- schools -----
    @GetMapping("/schools")
    public ApiResponse schools(@RequestParam(required = false) String keyword, @RequestParam(required = false) Long regionId,
                               @RequestParam(required = false) String contractStatus) {
        return ApiResponse.ok(schools.schools(AuthContext.get(), keyword, regionId, contractStatus));
    }

    @GetMapping("/schools/{id}")
    public ApiResponse school(@PathVariable Long id) { return ApiResponse.ok(schools.school(AuthContext.get(), id)); }

    @PostMapping("/schools")
    @RequirePerm("SCHOOL_MANAGE")
    public ApiResponse createSchool(@RequestBody Map<String, Object> body) { return ApiResponse.ok(schools.createSchool(AuthContext.get(), body)); }

    @PutMapping("/schools/{id}")
    @RequirePerm("SCHOOL_MANAGE")
    public ApiResponse updateSchool(@PathVariable Long id, @RequestBody Map<String, Object> body) { return ApiResponse.ok(schools.updateSchool(AuthContext.get(), id, body)); }

    @DeleteMapping("/schools/{id}")
    @RequirePerm("SCHOOL_MANAGE")
    public ApiResponse deleteSchool(@PathVariable Long id) { schools.deleteSchool(AuthContext.get(), id); return ApiResponse.ok(null); }

    /** 학교별 유형(C/M/S/T) 담당 업체·기사 매핑 교체. body: [{rceptTy, vendorId, engineerUserId}] */
    @PutMapping("/schools/{id}/vendors")
    @RequirePerm({"SCHOOL_MANAGE", "VENDOR_MANAGE"})
    public ApiResponse setVendors(@PathVariable Long id, @RequestBody List<Map<String, Object>> rows) {
        return ApiResponse.ok(schools.setSchoolVendors(AuthContext.get(), id, rows));
    }

    // ----- vendors -----
    @GetMapping("/vendors")
    public ApiResponse vendors(@RequestParam(required = false) Long regionId, @RequestParam(required = false) String rceptTy) {
        return ApiResponse.ok(schools.vendors(AuthContext.get(), regionId, rceptTy));
    }

    @PostMapping("/vendors")
    @RequirePerm("VENDOR_MANAGE")
    public ApiResponse createVendor(@RequestBody Map<String, Object> body) { return ApiResponse.ok(schools.createVendor(AuthContext.get(), body)); }

    @PutMapping("/vendors/{id}")
    @RequirePerm("VENDOR_MANAGE")
    public ApiResponse updateVendor(@PathVariable Long id, @RequestBody Map<String, Object> body) { return ApiResponse.ok(schools.updateVendor(AuthContext.get(), id, body)); }

    @DeleteMapping("/vendors/{id}")
    @RequirePerm("VENDOR_MANAGE")
    public ApiResponse deleteVendor(@PathVariable Long id) { schools.deleteVendor(AuthContext.get(), id); return ApiResponse.ok(null); }

    @GetMapping("/vendors/{id}/engineers")
    @RequirePerm({"VENDOR_MANAGE", "AS_MANAGE", "SCHOOL_MANAGE", "AS_PROCESS"})
    public ApiResponse engineers(@PathVariable Long id) { return ApiResponse.ok(schools.engineers(AuthContext.get(), id)); }
}
