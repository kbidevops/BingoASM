package com.bingoasm.web.as;

import io.swagger.v3.oas.annotations.tags.Tag;
import com.bingoasm.auth.AuthContext;
import com.bingoasm.auth.RequirePerm;
import com.bingoasm.common.ApiException;
import com.bingoasm.common.ApiResponse;
import com.bingoasm.service.as.ContactService;
import java.util.List;
import java.util.Map;
import org.springframework.web.bind.annotation.*;

/** 문의처 안내(도교육청·교육지원청별 담당자). */
@Tag(name = "문의처 안내", description = "도교육청·교육지원청별 담당자")
@RestController
@RequestMapping("/api/as/contacts")
public class ContactController {
    private final ContactService contacts;

    public ContactController(ContactService contacts) { this.contacts = contacts; }

    @GetMapping
    @RequirePerm("PORTAL_CONTACT")
    public ApiResponse list() { return ApiResponse.ok(contacts.grouped(AuthContext.get())); }

    /** 전체 교체. rows: [{regionId, groupName, itemName, tel, note, duties}] */
    @PutMapping
    @RequirePerm("BOARD_ADMIN")
    public ApiResponse replace(@RequestBody List<Map<String, Object>> rows) { return ApiResponse.ok(contacts.replaceAll(AuthContext.get(), rows)); }

    /** 한 구역만 교체. section = "province"(도교육청) 또는 교육지원청 id. 교육지원청 담당자는 자기 교육지원청만. */
    @PutMapping("/sections/{section}")
    @RequirePerm({"BOARD_ADMIN", "SCHOOL_MANAGE"})
    public ApiResponse replaceSection(@PathVariable String section, @RequestBody List<Map<String, Object>> rows) {
        Long regionId;
        if ("province".equals(section)) regionId = null;
        else {
            try { regionId = Long.valueOf(section); }
            catch (NumberFormatException e) { throw ApiException.badRequest("구역이 올바르지 않습니다."); }
        }
        return ApiResponse.ok(contacts.replaceSection(AuthContext.get(), regionId, rows));
    }

    /** 우리 학교 담당업체 (서비스별 업체·기사 연락처). 학교 담당자는 schoolId 없이 자기 학교. */
    @GetMapping("/providers")
    @RequirePerm("PORTAL_CONTACT")
    public ApiResponse providers(@RequestParam(required = false) Long schoolId) {
        return ApiResponse.ok(contacts.providers(AuthContext.get(), schoolId));
    }
}
