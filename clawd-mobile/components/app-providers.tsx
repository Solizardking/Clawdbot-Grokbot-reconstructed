import { PropsWithChildren } from 'react'
import { MobileWalletProvider } from '@wallet-ui/react-native-kit'
import { AppConfig } from '@/constants/app-config'
import { walletCache } from '@/utils/secure-storage'
export function AppProviders({ children }: PropsWithChildren) {
  return (
    <MobileWalletProvider cluster={AppConfig.networks[0]} identity={AppConfig.identity} cache={walletCache}>
      {children}
    </MobileWalletProvider>
  )
}
