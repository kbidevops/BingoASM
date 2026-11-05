import NetDevices from "@/components/admin/NetDevices";
import SubPage from "@/components/SubPage";

/** 스쿨넷장비관리 (/api/as/schoolnet-devices): 학교 인터넷망의 라우터·L3/L2 스위치·보안장비와 회선 정보. */
export default function SchoolNetDevicesPage() {
  return (
    <SubPage perm="SDEVICE_MANAGE">
      <NetDevices ty="S" />
    </SubPage>
  );
}
