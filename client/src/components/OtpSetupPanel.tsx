import type { OtpSetup } from "@/lib/types";

/**
 * 인증 앱 등록 안내: Google OTP(또는 Microsoft Authenticator 등) → ＋ → QR 스캔.
 * QR을 못 찍으면(PC 화면이 아닌 휴대폰에서 여는 경우 등) 비밀값을 직접 입력한다.
 */
export default function OtpSetupPanel({ setup }: { setup: Pick<OtpSetup, "qr" | "secret" | "account" | "issuer"> }) {
  return (
    <div className="otps">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img className="otps-qr" src={setup.qr} alt="인증 앱 등록용 QR 코드" width={180} height={180} />
      <ol className="otps-steps">
        <li>휴대폰에 <b>Google OTP</b>(Google Authenticator) 앱을 설치합니다. Microsoft Authenticator 등 다른 인증 앱도 됩니다.</li>
        <li>앱에서 <b>＋</b> → <b>QR 코드 스캔</b>을 눌러 화면의 QR을 찍습니다.</li>
        <li>앱에 <b>{setup.issuer}</b> · {setup.account} 항목이 생기면, 지금 보이는 <b>6자리 번호</b>를 아래에 입력합니다.</li>
      </ol>
      <details className="otps-key">
        <summary>QR을 찍을 수 없나요? 직접 입력하기</summary>
        <p>앱에서 ‘설정 키 입력’을 고르고 계정 이름 <b>{setup.account}</b>, 키 <code>{setup.secret}</code>, 유형 ‘시간 기준’으로 입력합니다.</p>
      </details>
    </div>
  );
}
