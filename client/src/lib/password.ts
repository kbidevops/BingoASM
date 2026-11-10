/** Mirrors the server's PasswordPolicy: 9~20 chars, letters+digits+symbols, no id/phone, no 4× repeat, no spaces. */
export function pwRules(v: string, who: { loginId: string; mobile?: string | null }) {
  const tel = (who.mobile ?? "").replace(/\D/g, "");
  return {
    len: v.length >= 9 && v.length <= 20 && !/\s/.test(v),
    kinds: /[A-Za-z]/.test(v) && /\d/.test(v) && /[^A-Za-z\d]/.test(v),
    id: !!v && !(who.loginId.length >= 3 && v.toLowerCase().includes(who.loginId.toLowerCase())) && !(tel.length >= 4 && v.includes(tel.slice(-4))),
    rep: !!v && !/(.)\1{3,}/.test(v),
  };
}

/** 강도 표시: [이름, 막대 %, 클래스] */
export function pwLevel(v: string, r: ReturnType<typeof pwRules>): [string, number, string] {
  const score = Object.values(r).filter(Boolean).length + (v.length >= 14 ? 1 : 0);
  return !v ? ["-", 0, ""] : score <= 2 ? ["약함", 25, "w"] : score <= 3 ? ["보통", 55, "m"] : score <= 4 ? ["강함", 80, "s"] : ["매우 강함", 100, "s"];
}
