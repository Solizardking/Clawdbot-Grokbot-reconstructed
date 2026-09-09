import { Platform } from 'react-native'
import * as SecureStore from 'expo-secure-store'
import type { WalletAuthorizationCache } from '@wallet-ui/react-native-kit'

const options = { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY }
export const vault = {
  get: (key: string) => SecureStore.getItemAsync(`clawd.${key}`, options),
  set: (key: string, value: string) => SecureStore.setItemAsync(`clawd.${key}`, value, options),
  remove: (key: string) => SecureStore.deleteItemAsync(`clawd.${key}`, options),
}
export const walletCache: WalletAuthorizationCache = {
  async get() {
    if (Platform.OS !== 'android') return undefined
    const value = await vault.get('wallet')
    if (!value) return undefined
    try {
      return JSON.parse(value)
    } catch {
      await vault.remove('wallet')
      return undefined
    }
  },
  async set(value) {
    if (value) await vault.set('wallet', JSON.stringify(value))
    else await vault.remove('wallet')
  },
  async clear() {
    await vault.remove('wallet')
  },
}
