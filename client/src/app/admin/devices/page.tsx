import NetDevices from "@/components/admin/NetDevices";
import SubPage from "@/components/SubPage";

/** 무선장비관리 (/api/as/wireless-devices): 학교의 무선 AP·PoE 스위치·컨트롤러. */
export default function DevicesPage() {
  return (
    <SubPage perm="WDEVICE_MANAGE">
      <NetDevices ty="M" />
    </SubPage>
  );
}
