import AsyncStorage from '@react-native-async-storage/async-storage';
import { STORAGE_KEYS } from '../storage/keys';

function generateDeviceId(): string {
  const rand = () => Math.random().toString(36).slice(2, 10);
  return `dev-${rand()}-${rand()}`;
}

export async function getOrCreateDeviceId(): Promise<string> {
  const existing = await AsyncStorage.getItem(STORAGE_KEYS.deviceId);
  if (existing) return existing;
  const id = generateDeviceId();
  await AsyncStorage.setItem(STORAGE_KEYS.deviceId, id);
  return id;
}
