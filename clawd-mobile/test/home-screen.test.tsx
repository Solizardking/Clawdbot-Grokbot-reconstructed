import { beforeEach, expect, it, vi } from 'vitest'
import { fireEvent, render } from '@testing-library/react-native'
const mock = vi.hoisted(() => ({ get: vi.fn(), set: vi.fn(), remove: vi.fn(), signIn: vi.fn(), native: vi.fn() }))
vi.mock('@/utils/secure-storage', () => ({ vault: { get: mock.get, set: mock.set, remove: mock.remove } }))
vi.mock('@wallet-ui/react-native-kit', () => ({
  useMobileWallet: () => ({ account: null, signIn: mock.signIn, disconnect: vi.fn() }),
  fromUint8Array: () => 'a'.repeat(43),
}))
vi.mock('expo-crypto', () => ({ getRandomBytesAsync: async () => new Uint8Array(32) }))
vi.mock('@/components/market-chart', () => ({ MarketChart: () => null }))
vi.mock('@/utils/clawd-api', async (original) => ({ ...(await original<object>()), nativeRequest: mock.native }))
import HomeScreen from '../app/index'
beforeEach(() => {
  vi.clearAllMocks()
  mock.get.mockResolvedValue(null)
  mock.native.mockResolvedValue({ challengeId: 'test', input: {} })
  mock.signIn.mockRejectedValue(new Error('Wallet request cancelled'))
})
it('does not invent a quote when an account has no market access', async () => {
  const screen = await render(<HomeScreen />)
  await fireEvent.press(screen.getByRole('button', { name: 'Load quote & chart' }))
  expect(screen.getByText('Connect your hosted account to load live prices and charts.')).toBeTruthy()
  expect(screen.getByText('Hosted Clawd access')).toBeTruthy()
  await screen.unmount()
})
it('a cancelled wallet request never creates a verified session', async () => {
  const screen = await render(<HomeScreen />)
  await fireEvent.press(screen.getByRole('tab', { name: 'Account' }))
  await fireEvent.press(screen.getByRole('button', { name: 'Use installed wallet' }))
  expect(await screen.findByText('Wallet request cancelled')).toBeTruthy()
  expect(mock.set).not.toHaveBeenCalled()
  expect(screen.queryByText('VERIFIED CLAWD ACCOUNT')).toBeNull()
  await screen.unmount()
})
it('chat without a granted hosted model does not invent a completion', async () => {
  const screen = await render(<HomeScreen />)
  await fireEvent.press(screen.getByRole('tab', { name: 'Chat' }))
  await fireEvent.changeText(screen.getByLabelText('Message Clawd'), 'Quote SOL')
  await fireEvent.press(screen.getByRole('button', { name: 'Send message' }))
  expect(await screen.findByText('Connect an account with a chat model grant first.')).toBeTruthy()
  expect(screen.queryByText('The model returned no answer. Try again or choose another model.')).toBeNull()
  await screen.unmount()
})
