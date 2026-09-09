import { SITE_ORIGIN } from './endpoints'
import { AppIdentity, createSolanaMainnet, SolanaCluster } from '@wallet-ui/react-native-kit'
export class AppConfig {
  static identity: AppIdentity = { name: 'Clawd', uri: SITE_ORIGIN, icon: 'clawd-mobile-icon.png' }
  static networks: SolanaCluster[] = [createSolanaMainnet({ url: 'https://api.mainnet-beta.solana.com' })]
}
