"use client";

import { api, rows, type Page } from "./api";
import type { School } from "./types";

// Shared types, code tables and loaders for the 통합관리 screens.

export const DEVICE_TYPES: [string, string][] = [["AP", "무선 AP"], ["SWITCH", "PoE 스위치"], ["CONTROLLER", "무선 컨트롤러"]];
export const SCHOOLNET_DEVICE_TYPES: [string, string][] = [["ROUTER", "라우터"], ["L3", "L3 스위치"], ["L2", "L2 스위치"], ["FIREWALL", "보안장비(방화벽)"], ["ETC", "기타"]];
export const DEVICE_STATUSES: [string, string, string][] = [["NORMAL", "정상", "s1"], ["CHECK", "점검중", "s2"], ["FAULT", "장애", "s4"], ["DISPOSED", "폐기", "s3"]];

export const ASSET_STATUSES: [string, string, string][] = [
  ["INUSE", "사용", "s1"], ["IDLE", "유휴", "s3"], ["REPAIR", "수리", "s2"], ["DISPOSE_PLANNED", "불용예정", "s2"], ["DISPOSED", "불용", "s4"],
];
export const ROOM_TYPES: [string, string][] = [["CLASS", "교실"], ["SPECIAL", "특별실"], ["ADMIN", "행정·지원"], ["ETC", "기타"]];
export const SCHOOL_TYPES: [string, string][] = [["ELEM", "초등학교"], ["MID", "중학교"], ["HIGH", "고등학교"], ["SPECIAL", "특수학교"], ["ETC", "기타"]];

export const label = (table: [string, string, ...string[]][], code?: string | null) => table.find((t) => t[0] === code)?.[1] ?? code ?? "-";
export const badgeClass = (table: [string, string, string][], code?: string | null) => table.find((t) => t[0] === code)?.[2] ?? "s3";

export interface Device {
  deviceId: number;
  /** 유지보수 업체 (무선망 AS는 이 업체가 맡는다) */
  vendorId?: number;
  vendorName?: string;
  /** M 무선망 장비 / S 스쿨넷 장비 */
  rceptTy?: "M" | "S";
  deviceCode: string;
  deviceName: string;
  deviceType?: string;
  deviceTypeName?: string;
  modelName?: string;
  ipAddress?: string;
  macAddress?: string;
  location?: string;
  installedAt?: string;
  lastCheckedAt?: string;
  /** 무선장비 위치(도면): 놓인 층과 도면 위 좌표(%), "건물 층" 이름 */
  floorId?: number | null;
  posX?: number | null;
  posY?: number | null;
  floorFullName?: string | null;
  /** 스쿨넷 회선 */
  carrier?: string;
  circuitId?: string;
  bandwidth?: string;
  status: string;
  statusName: string;
  schoolId: number;
  schoolName?: string;
  regionId?: number;
  regionName?: string;
  note?: string;
}

/** GET /api/as/{wireless|schoolnet}-devices/places: 설치위치 고르기 (건물·층 + 이미 쓴 상세 위치 이름). */
export interface DevicePlaces {
  buildings: { buildingId: number; buildingName: string; floors: { floorId: number; floorName: string; hasPlan: boolean }[] }[];
  details: string[];
}

/** 장비 위치 변경 기록 한 줄. */
export interface DeviceHistoryRow {
  historyId: number;
  actionType: "EDIT" | "PLAN" | "FLOOR";
  actionName: string;
  fromPlace?: string | null;
  toPlace?: string | null;
  workerName?: string;
  createdAt: string;
}

export interface SchoolFull extends School {
  schoolCode?: string;
  schoolType?: string;
  schoolTypeName?: string;
  regionId?: number;
  address?: string;
  tel?: string;
  classCount?: number;
  memo?: string;
  assetCount?: number;
  vendors?: { rceptTy: string; rceptTyName: string; vendorId?: number; vendorName?: string; engineerUserId?: number; engineerName?: string }[];
}

export interface Vendor {
  vendorId: number;
  vendorName: string;
  allRegions: boolean;
  regions: { regionId: number; regionName: string }[];
  /** "전체", "미지정", or the region names joined */
  regionName: string;
  tel?: string;
  address?: string;
  serviceTypes: string[];
  serviceTypeNames: string[];
  engineerCount: number;
  updatedAt?: string;
  /** 지금 사용자가 고칠 수 있는 업체 (도교육청: 모두, 교육지원청: 관할 지역만 맡는 업체) */
  editable?: boolean;
}

export interface Engineer {
  userId: number;
  userName: string;
  positionName?: string;
  mobile?: string;
}

export interface Category {
  categoryId: number;
  assetType: string;
  categoryName: string;
  lifeYears?: number;
}

/** 자산이 있는 곳 (GET /api/assets/{id}, QR resolve): 기관 · 건물 · 층 · 실과 이를 이은 path. */
export interface AssetLocation {
  schoolId?: number; schoolName?: string;
  buildingId?: number; buildingName?: string;
  floorId?: number; floorName?: string;
  roomId?: number; roomName?: string; roomNo?: string;
  detail?: string;
  path?: string;
  /** 학교·건물·층이 모두 정해졌는지 */
  complete: boolean;
}

export interface Asset {
  assetId: number;
  assetNo: string;
  assetType: string;
  categoryId: number;
  categoryName?: string;
  assetName: string;
  manufacturer?: string;
  modelName?: string;
  serialNo?: string;
  spec?: string;
  acquiredAt?: string;
  acquirePrice?: number;
  status: string;
  buildingId?: number;
  buildingName?: string;
  floorId?: number;
  floorName?: string;
  locationDetail?: string;
  schoolId?: number;
  roomId?: number;
  lifeYears?: number;
  lifeExceeded?: boolean;
  note?: string;
  openServiceCount?: number;
  /** 상세에서만 */
  location?: AssetLocation;
}

export interface Floor {
  floorId: number;
  floorNo: number;
  floorName: string;
  planUrl?: string;
  roomCount: number;
  /** 이 층 도면에 놓인 장비 수 (층 삭제 안내) */
  deviceCount?: number;
}

export interface Building {
  buildingId: number;
  schoolId: number;
  buildingName: string;
  address?: string;
  floors: Floor[];
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Room {
  roomId: number;
  schoolId: number;
  buildingId: number;
  buildingName?: string;
  floorId: number;
  floorName?: string;
  roomNo?: string;
  roomName: string;
  roomType?: string;
  roomTypeName?: string;
  ownerName?: string;
  fullName: string;
  assetCount: number;
  rect?: Rect;
}

export interface RoomDetail extends Room {
  assets: { assetId: number; assetNo: string; assetName: string; status: string; modelName?: string }[];
}

export interface Label {
  assetNo: string;
  qrText: string;
  title: string;
  sub: string;
  blank?: boolean;
}

let schoolsCache: Promise<SchoolFull[]> | null = null;
let categoriesCache: Promise<Category[]> | null = null;

/** Schools visible to this user (a school user gets only their own). */
export function loadSchools(force = false): Promise<SchoolFull[]> {
  if (force) schoolsCache = null;
  schoolsCache ??= api.get<SchoolFull[] | Page<SchoolFull>>("/api/as/schools").then((d) => rows(d)).catch((e) => {
    schoolsCache = null;
    throw e;
  });
  return schoolsCache;
}

/** 로그인 · 로그아웃 때: 학교 목록은 사용자의 범위(학교 · 업체 · 교육지원청)마다 다르다. */
export function clearAdminCaches() {
  schoolsCache = null;
  categoriesCache = null;
}

export function loadCategories(): Promise<Category[]> {
  categoriesCache ??= api.get<Category[]>("/api/assets/categories").catch((e) => {
    categoriesCache = null;
    throw e;
  });
  return categoriesCache;
}

/** Fetches every page of a paged endpoint (lists here stay well under a few thousand rows). */
export async function fetchAll<T>(path: string, query: Record<string, string | number | boolean | undefined> = {}): Promise<T[]> {
  const out: T[] = [];
  for (let page = 1; page <= 50; page++) {
    const p = await api.get<Page<T>>(path, { ...query, page, size: 500 });
    out.push(...p.content);
    if (page >= p.totalPages) break;
  }
  return out;
}

/** Excel-friendly CSV (UTF-8 BOM, formula-injection safe). */
export function downloadCsv(name: string, head: string[], data: (string | number | null | undefined)[][]) {
  const cell = (v: string | number | null | undefined) => {
    let s = v == null ? "" : String(v);
    if (/^[=+\-@]/.test(s)) s = "'" + s;
    return '"' + s.replace(/"/g, '""') + '"';
  };
  const csv = [head, ...data].map((r) => r.map(cell).join(",")).join("\r\n");
  const href = URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = href;
  a.download = name.replace(/\s/g, "_") + ".csv";
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(href);
    a.remove();
  }, 500);
}

/** Loads a protected image (needs the Bearer token) as an object URL for <img src>. */
export async function protectedImage(path: string): Promise<string> {
  const res = await api.raw(path);
  return URL.createObjectURL(await res.blob());
}
