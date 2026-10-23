"use client";
import { cloudAuthEnabled } from "./config";
import { useMockSession, signOutMock } from "./mock-session";
import { useCloudSession, signOutCloud } from "./cloud-session";
export const useAdminSession = cloudAuthEnabled ? useCloudSession : useMockSession;
export const signOutAdmin = cloudAuthEnabled ? signOutCloud : signOutMock;
