package com.bingoasm.common;

import java.util.regex.Pattern;

/** 비밀번호 규칙: 9~20자, 영문·숫자·특수문자 모두 포함, 아이디·연락처 포함 금지, 같은 문자 4회 반복 금지. */
public final class PasswordPolicy {
    private PasswordPolicy() {}
    private static final Pattern LETTER = Pattern.compile("[A-Za-z]");
    private static final Pattern DIGIT = Pattern.compile("[0-9]");
    private static final Pattern SPECIAL = Pattern.compile("[^A-Za-z0-9]");
    private static final Pattern REPEAT = Pattern.compile("(.)\\1{3,}");

    public static void check(String pw, String loginId, String mobile) {
        if (pw == null || pw.length() < 9 || pw.length() > 20) throw ApiException.badRequest("비밀번호는 9~20자여야 합니다.");
        if (!LETTER.matcher(pw).find() || !DIGIT.matcher(pw).find() || !SPECIAL.matcher(pw).find())
            throw ApiException.badRequest("비밀번호는 영문, 숫자, 특수문자를 모두 포함해야 합니다.");
        if (pw.chars().anyMatch(Character::isWhitespace)) throw ApiException.badRequest("비밀번호에 공백은 쓸 수 없습니다.");
        if (REPEAT.matcher(pw).find()) throw ApiException.badRequest("같은 문자를 4번 이상 반복할 수 없습니다.");
        String lower = pw.toLowerCase();
        if (loginId != null && loginId.length() >= 3 && lower.contains(loginId.toLowerCase()))
            throw ApiException.badRequest("비밀번호에 아이디를 포함할 수 없습니다.");
        if (mobile != null) {
            String digits = mobile.replaceAll("\\D", "");
            if (digits.length() >= 4 && pw.contains(digits.substring(digits.length() - 4)))
                throw ApiException.badRequest("비밀번호에 전화번호를 포함할 수 없습니다.");
        }
    }
}
