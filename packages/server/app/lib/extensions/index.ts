import type { NextRequest } from 'next/server';

export type SessionUser = {
  id: string;
  name: string | null;
  email: string;
};

export type SessionCookieInit = {
  name: string;
  value: string;
  httpOnly: boolean;
  sameSite: 'lax';
  secure: boolean;
  path: '/';
  maxAge: number;
};

export type SignedStorageUrl = {
  url: string;
  expiresAt: string;
  localFallback: boolean;
};

export interface AuthProvider {
  getUserFromRequest(req: NextRequest): Promise<SessionUser | null>;
  getUserFromSession(sessionId: string | null | undefined): Promise<SessionUser | null>;
  createSessionCookie(userId: string): SessionCookieInit;
  destroySessionCookie(): SessionCookieInit;
  hashPassword(password: string): Promise<string>;
  verifyPassword(password: string, storedHash: string): Promise<boolean>;
}

export interface StorageProvider {
  createSignedUploadUrl(input: {
    objectKey: string;
    contentType: string;
    method: 'PUT' | 'GET' | 'HEAD';
    expiresInSeconds?: number;
  }): Promise<SignedStorageUrl>;
  createSignedDownloadUrl(input: {
    objectKey: string;
    contentType?: string;
    expiresInSeconds?: number;
  }): Promise<SignedStorageUrl>;
  deleteObject(objectKey: string): Promise<void>;
  getObjectStream(objectKey: string): Promise<ReadableStream<Uint8Array> | null>;
}

export interface AnalyticsProvider {
  track(event: string, properties?: Record<string, unknown>): Promise<void>;
  identify(userId: string, traits?: Record<string, unknown>): Promise<void>;
}

export interface BillingProvider {
  getEntitlements(userId: string): Promise<Record<string, unknown>>;
  checkLimit(userId: string, limitKey: string): Promise<boolean>;
}

const noopAnalyticsProvider: AnalyticsProvider = {
  async track() {},
  async identify() {},
};

const noopBillingProvider: BillingProvider = {
  async getEntitlements() {
    return {};
  },
  async checkLimit() {
    return true;
  },
};

let authProvider: AuthProvider | null = null;
let storageProvider: StorageProvider | null = null;
let analyticsProvider: AnalyticsProvider = noopAnalyticsProvider;
let billingProvider: BillingProvider = noopBillingProvider;

export function setAuthProvider(provider: AuthProvider) {
  authProvider = provider;
}

export function getAuthProvider() {
  if (!authProvider) {
    throw new Error('Auth provider has not been bound');
  }

  return authProvider;
}

export function setStorageProvider(provider: StorageProvider) {
  storageProvider = provider;
}

export function getStorageProvider() {
  if (!storageProvider) {
    throw new Error('Storage provider has not been bound');
  }

  return storageProvider;
}

export function setAnalyticsProvider(provider: AnalyticsProvider) {
  analyticsProvider = provider;
}

export function getAnalyticsProvider() {
  return analyticsProvider;
}

export function setBillingProvider(provider: BillingProvider) {
  billingProvider = provider;
}

export function getBillingProvider() {
  return billingProvider;
}

export async function trackAnalyticsEvent(event: string, properties?: Record<string, unknown>) {
  await analyticsProvider.track(event, properties);
}

export async function identifyAnalyticsUser(userId: string, traits?: Record<string, unknown>) {
  await analyticsProvider.identify(userId, traits);
}

export async function getBillingEntitlements(userId: string) {
  return billingProvider.getEntitlements(userId);
}

export async function checkBillingLimit(userId: string, limitKey: string) {
  return billingProvider.checkLimit(userId, limitKey);
}

export function resetExtensionBindingsForTests() {
  authProvider = null;
  storageProvider = null;
  analyticsProvider = noopAnalyticsProvider;
  billingProvider = noopBillingProvider;
}

export { noopAnalyticsProvider, noopBillingProvider };
