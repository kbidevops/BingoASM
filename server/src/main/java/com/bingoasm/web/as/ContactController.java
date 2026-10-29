package com.bingoasm.web.as;

import io.swagger.v3.oas.annotations.tags.Tag;
import com.bingoasm.auth.AuthContext;
import com.bingoasm.auth.RequirePerm;
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
}
