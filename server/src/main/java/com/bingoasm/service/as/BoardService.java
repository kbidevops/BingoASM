package com.bingoasm.service.as;

import com.bingoasm.auth.CurrentUser;
import com.bingoasm.common.*;
import com.bingoasm.domain.StoredFile;
import com.bingoasm.domain.as.*;
import com.bingoasm.repo.FileRepository;
import com.bingoasm.repo.as.*;
import jakarta.persistence.criteria.Predicate;
import java.util.*;
import java.util.function.Function;
import java.util.stream.Collectors;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Sort;
import org.springframework.data.jpa.domain.Specification;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** 게시판 6종: 공지 및 자료실, 질문 및 건의하기, 컨설팅 신청, 불용PC수거신청, 유지관리업체(정보공유), 스쿨넷 SLA 공유. */
@Service
@Transactional
public class BoardService {
    private final PostRepository posts;
    private final PostCommentRepository comments;
    private final FileRepository files;
    private final SchoolService schoolService;

    public BoardService(PostRepository posts, PostCommentRepository comments, FileRepository files, SchoolService schoolService) {
        this.posts = posts; this.comments = comments; this.files = files; this.schoolService = schoolService;
    }

    public static AsCodes.Board board(String code) {
        AsCodes.Board b = AsCodes.BOARDS.get(code == null ? "" : code.toUpperCase());
        if (b == null) throw ApiException.notFound("게시판을 찾을 수 없습니다.");
        return b;
    }

    public List<Json> boards(CurrentUser me) {
        return AsCodes.BOARDS.values().stream().filter(b -> me.can(b.readPerm())).map(b -> Json.obj().with("code", b.code()).with("name", b.name())
                .with("canWrite", b.writePerm() == null || me.can(b.writePerm())).with("hasStatus", b.hasStatus()).with("categories", b.categories())
                .with("hasField", b.hasField()).with("hasRegion", b.hasRegion()).with("allowSecret", b.allowSecret())).toList();
    }

    private void checkRead(CurrentUser me, AsCodes.Board b) {
        if (!me.can(b.readPerm())) throw ApiException.forbidden("권한이 없습니다.");
    }

    private boolean canModerate(CurrentUser me) {
        return me.can("BOARD_ADMIN");
    }

    private boolean canSeeSecret(CurrentUser me, Post p) {
        return canModerate(me) || me.userId().equals(p.authorUserId) || (p.schoolId != null && me.scope().school() && p.schoolId.equals(me.scope().schoolId()));
    }

    private List<Json> fileInfos(String csv) {
        if (csv == null || csv.isBlank()) return List.of();
        List<Long> ids = Arrays.stream(csv.split(",")).map(String::trim).filter(x -> !x.isEmpty()).map(Long::valueOf).toList();
        Map<Long, StoredFile> m = files.findAllById(ids).stream().collect(Collectors.toMap(f -> f.fileId, Function.identity()));
        return ids.stream().map(m::get).filter(Objects::nonNull).map(f -> Json.obj().with("fileId", f.fileId).with("name", f.originalName)
                .with("size", f.fileSize).with("url", "/files/" + f.fileId + "/download")).toList();
    }

    public Json row(Post p, Map<Long, Region> rm, Map<Long, Long> commentCounts, Map<Long, School> sm) {
        Region r = p.regionId == null ? null : rm.get(p.regionId);
        School s = p.schoolId == null ? null : sm.get(p.schoolId);
        return Json.obj().with("postId", p.postId).with("boardCode", p.boardCode).with("title", p.title)
                .with("authorUserId", p.authorUserId).with("authorName", p.authorName).with("createdAt", p.createdAt).with("viewCount", p.viewCount)
                .with("categoryCode", p.categoryCode).with("fieldCode", p.fieldCode).with("fieldName", p.fieldCode == null ? null : AsCodes.FIELD_NAME.getOrDefault(p.fieldCode, p.fieldCode))
                .with("regionId", p.regionId).with("regionName", r == null ? null : r.regionName)
                .with("schoolId", p.schoolId).with("schoolName", s == null ? null : s.schoolName)
                .with("status", p.status).with("statusName", p.status == null ? null : AsCodes.POST_STATUS_NAME.get(p.status)).with("visitDate", p.visitDate)
                .with("secret", Boolean.TRUE.equals(p.secret)).with("commentCount", commentCounts.getOrDefault(p.postId, 0L))
                .with("isNew", p.createdAt != null && p.createdAt.isAfter(Times.now().minusHours(24)))
                .with("hasAttach", p.attachFileIds != null && !p.attachFileIds.isBlank());
    }

    public record Filter(String keyword, String searchType, Long regionId, String fieldCode, String categoryCode, String status, boolean mine) {}

    @Transactional(readOnly = true)
    public PageResult<Json> list(CurrentUser me, String code, Filter f, Integer page, Integer size) {
        AsCodes.Board b = board(code);
        checkRead(me, b);
        Specification<Post> spec = (root, q, cb) -> {
            List<Predicate> p = new ArrayList<>();
            p.add(cb.equal(root.get("orgId"), me.orgId()));
            p.add(cb.equal(root.get("boardCode"), b.code()));
            p.add(cb.equal(root.get("useYn"), "Y"));
            if (f.regionId() != null) p.add(cb.equal(root.get("regionId"), f.regionId()));
            if (!Params.blank(f.fieldCode())) p.add(cb.equal(root.get("fieldCode"), f.fieldCode()));
            if (!Params.blank(f.categoryCode())) p.add(cb.equal(root.get("categoryCode"), f.categoryCode()));
            if (!Params.blank(f.status())) p.add(cb.equal(root.get("status"), f.status()));
            if (f.mine()) p.add(cb.equal(root.get("authorUserId"), me.userId()));
            if (!Params.blank(f.keyword())) {
                String like = "%" + f.keyword().trim().toLowerCase() + "%";
                String t = Optional.ofNullable(f.searchType()).orElse("title");
                p.add(switch (t) {
                    case "content" -> cb.like(cb.lower(cb.coalesce(root.get("content"), "")), like);
                    case "titleContent" -> cb.or(cb.like(cb.lower(root.get("title")), like), cb.like(cb.lower(cb.coalesce(root.get("content"), "")), like));
                    case "author" -> cb.like(cb.lower(cb.coalesce(root.get("authorName"), "")), like);
                    case "field" -> cb.like(cb.lower(cb.coalesce(root.get("fieldCode"), "")), like);
                    default -> cb.like(cb.lower(root.get("title")), like);
                });
            }
            return cb.and(p.toArray(Predicate[]::new));
        };
        int pg = PageResult.page(page), sz = PageResult.size(size);
        Page<Post> res = posts.findAll(spec, PageRequest.of(pg - 1, sz, Sort.by(Sort.Direction.DESC, "postId")));
        Map<Long, Long> cc = new HashMap<>();
        for (Object[] o : comments.countByPostIds(res.getContent().stream().map(x -> x.postId).toList())) cc.put((Long) o[0], (Long) o[1]);
        Map<Long, Region> rm = schoolService.regionMap(me.orgId());
        Map<Long, School> sm = schoolService.schoolMap(me.orgId());
        return new PageResult<>(res.getContent().stream().map(x -> row(x, rm, cc, sm)).toList(), res.getTotalElements(), pg, sz, res.getTotalPages());
    }

    private Post load(CurrentUser me, String code, Long id) {
        AsCodes.Board b = board(code);
        checkRead(me, b);
        return posts.findById(id).filter(p -> p.orgId.equals(me.orgId()) && b.code().equals(p.boardCode) && "Y".equals(p.useYn))
                .orElseThrow(() -> ApiException.notFound("게시글을 찾을 수 없습니다."));
    }

    public Json detail(CurrentUser me, String code, Long id) {
        Post p = load(me, code, id);
        if (Boolean.TRUE.equals(p.secret) && !canSeeSecret(me, p)) throw ApiException.forbidden("비밀글 열람권한이 없습니다.");
        p.viewCount = (p.viewCount == null ? 0 : p.viewCount) + 1;
        Map<Long, Region> rm = schoolService.regionMap(me.orgId());
        Json j = row(p, rm, Map.of(), schoolService.schoolMap(me.orgId()));
        j.put("content", p.content);
        j.put("updatedAt", p.updatedAt);
        j.put("attachments", fileInfos(p.attachFileIds));
        j.put("comments", comments.findByPostIdAndUseYnOrderByCreatedAtAsc(p.postId, "Y").stream().map(c -> Json.obj()
                .with("commentId", c.commentId).with("content", c.content).with("authorUserId", c.authorUserId).with("authorName", c.authorName)
                .with("createdAt", c.createdAt).with("canDelete", canModerate(me) || me.userId().equals(c.authorUserId))).toList());
        boolean owner = me.userId().equals(p.authorUserId);
        j.put("canEdit", owner || canModerate(me));
        j.put("canComment", canModerate(me) || me.can("AS_PROCESS") || owner);
        j.put("canSetStatus", board(code).hasStatus() && canModerate(me));
        return j;
    }

    private void apply(CurrentUser me, AsCodes.Board b, Post p, Map<String, Object> body) {
        if (body.containsKey("title")) p.title = Params.str(body, "title");
        if (Params.blank(p.title)) throw ApiException.badRequest("제목을 입력해 주세요.");
        if (p.title.length() > 200) p.title = p.title.substring(0, 200);
        if (body.containsKey("content")) p.content = Params.rawStr(body, "content");
        if (body.containsKey("categoryCode")) {
            String c = Params.str(body, "categoryCode");
            if (c != null && !b.categories().isEmpty() && !b.categories().contains(c)) throw ApiException.badRequest("유형이 올바르지 않습니다.");
            p.categoryCode = c;
        }
        if (p.categoryCode == null && !b.categories().isEmpty()) p.categoryCode = b.categories().get(0);
        if (body.containsKey("fieldCode")) { String f = Params.str(body, "fieldCode"); if (f != null && !AsCodes.FIELD_NAME.containsKey(f)) throw ApiException.badRequest("분야가 올바르지 않습니다."); p.fieldCode = f; }
        if (body.containsKey("regionId")) p.regionId = Params.lng(body, "regionId");
        if (body.containsKey("schoolId") && (canModerate(me) || !me.scope().school())) p.schoolId = Params.lng(body, "schoolId");
        if (body.containsKey("visitDate")) p.visitDate = Params.date(body, "visitDate");
        if (body.containsKey("secret")) p.secret = b.allowSecret() && Boolean.parseBoolean(String.valueOf(body.get("secret")));
        if (body.containsKey("attachFileIds")) p.attachFileIds = AsRequestService.csv(body.get("attachFileIds"));
        // 학교 글의 지역은 학교의 교육지원청을 따른다. 지역을 고르는 것은 학교가 없는 글(업체·교육청)뿐.
        School s = p.schoolId == null ? null : schoolService.schoolMap(me.orgId()).get(p.schoolId);
        if (s != null) p.regionId = s.regionId;
        else if (p.regionId != null && !schoolService.regionMap(me.orgId()).containsKey(p.regionId)) throw ApiException.badRequest("지역이 올바르지 않습니다.");
    }

    public Long create(CurrentUser me, String code, Map<String, Object> body) {
        AsCodes.Board b = board(code);
        checkRead(me, b);
        if (b.writePerm() != null && !me.can(b.writePerm())) throw ApiException.forbidden("이 게시판에는 관리자만 글을 쓸 수 있습니다.");
        Post p = new Post();
        p.orgId = me.orgId(); p.boardCode = b.code(); p.authorUserId = me.userId(); p.authorName = me.user().userName;
        p.createdAt = Times.now(); p.updatedAt = p.createdAt;
        if (me.scope().school()) p.schoolId = me.scope().schoolId();
        if (b.hasStatus()) p.status = "WAIT";
        apply(me, b, p, body);
        posts.save(p);
        return p.postId;
    }

    public void update(CurrentUser me, String code, Long id, Map<String, Object> body) {
        Post p = load(me, code, id);
        if (!me.userId().equals(p.authorUserId) && !canModerate(me)) throw ApiException.forbidden("작성자만 수정할 수 있습니다.");
        apply(me, board(code), p, body);
        p.updatedAt = Times.now();
    }

    public void delete(CurrentUser me, String code, Long id) {
        Post p = load(me, code, id);
        if (!me.userId().equals(p.authorUserId) && !canModerate(me)) throw ApiException.forbidden("작성자만 삭제할 수 있습니다.");
        p.useYn = "N";
    }

    public void setStatus(CurrentUser me, String code, Long id, Map<String, Object> body) {
        AsCodes.Board b = board(code);
        if (!b.hasStatus()) throw ApiException.badRequest("진행상태가 없는 게시판입니다.");
        if (!canModerate(me)) throw ApiException.forbidden("권한이 없습니다.");
        Post p = load(me, code, id);
        String st = Params.str(body, "status");
        if (st != null) { if (!AsCodes.POST_STATUS_NAME.containsKey(st)) throw ApiException.badRequest("진행상태가 올바르지 않습니다."); p.status = st; }
        if (body.containsKey("visitDate")) p.visitDate = Params.date(body, "visitDate");
        p.updatedAt = Times.now();
    }

    public Long addComment(CurrentUser me, String code, Long id, Map<String, Object> body) {
        Post p = load(me, code, id);
        if (Boolean.TRUE.equals(p.secret) && !canSeeSecret(me, p)) throw ApiException.forbidden("비밀글 열람권한이 없습니다.");
        if (!(canModerate(me) || me.can("AS_PROCESS") || me.userId().equals(p.authorUserId))) throw ApiException.forbidden("답변 권한이 없습니다.");
        String content = Params.str(body, "content");
        if (content == null) throw ApiException.badRequest("내용을 입력해 주세요.");
        PostComment c = new PostComment();
        c.postId = p.postId; c.content = content; c.authorUserId = me.userId(); c.authorName = me.user().userName; c.createdAt = Times.now();
        comments.save(c);
        return c.commentId;
    }

    public void deleteComment(CurrentUser me, String code, Long id, Long commentId) {
        load(me, code, id);
        PostComment c = comments.findById(commentId).filter(x -> x.postId.equals(id)).orElseThrow(() -> ApiException.notFound("답변을 찾을 수 없습니다."));
        if (!canModerate(me) && !me.userId().equals(c.authorUserId)) throw ApiException.forbidden("권한이 없습니다.");
        c.useYn = "N";
    }
}
