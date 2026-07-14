import { defaultAuthProvider } from '@git-for-music/server/app/lib/auth/default-provider';
import { defaultStorageProvider } from '@git-for-music/server/app/lib/daw/server/assets/storage-provider';
import {
  setAnalyticsProvider,
  setAuthProvider,
  setBillingProvider,
  setStorageProvider,
  noopAnalyticsProvider,
  noopBillingProvider,
} from '@git-for-music/server/app/lib/extensions';

export function bindDefaultProviders() {
  setAuthProvider(defaultAuthProvider);
  setStorageProvider(defaultStorageProvider);
  setAnalyticsProvider(noopAnalyticsProvider);
  setBillingProvider(noopBillingProvider);
}

bindDefaultProviders();
