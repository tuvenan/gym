// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Settings from './Settings.jsx'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

// The updater downloads an .apk and hands it to the Android package installer, so its row
// may only ever show on the native Android build: never on the web, never on iOS. Each test
// flips the two gates (MOBILE flag, Capacitor platform) and watches whether Settings even
// asks gitlab.com for the latest release.
const mocks = vi.hoisted(() => {
  const state = { S: null, MOBILE: false, android: false }
  state.snapshot = () => ({
    S: state.S,
    user: null,
    update: mut => {
      const next = structuredClone(state.S)
      mut(next)
      state.S = next
    },
    replaceState: vi.fn(), setUser: vi.fn(), pullState: vi.fn(), pushState: vi.fn(),
    signOut: vi.fn(), signOutAll: vi.fn(), resetDemo: vi.fn(), disconnectServer: vi.fn(),
  })
  state.checkForUpdate = vi.fn(() => Promise.resolve({ hasUpdate: true, latestVersion: '9.9.9', apkUrl: 'https://x/opengym.apk', hashUrl: null }))
  state.confirmSheet = vi.fn()
  return state
})
vi.mock('../store/useStore.js', () => {
  const useStore = selector => selector ? selector(mocks.snapshot()) : mocks.snapshot()
  useStore.getState = mocks.snapshot
  return { useStore, DEF: { reminder: { time: '17:30' } }, hasData: () => false }
})
vi.mock('../store/useUI.js', () => {
  const snap = () => ({ toast: vi.fn(), openSheet: vi.fn() })
  const useUI = selector => selector ? selector(snap()) : snap()
  useUI.getState = snap
  return { useUI }
})
vi.mock('react-router-dom', () => ({ useNavigate: () => () => {} }))
vi.mock('../lib/api.js', () => ({
  api: vi.fn(), webauthnOK: () => false, passkeyLogin: vi.fn(), passkeyRegister: vi.fn(), IS_ANDROID: false,
}))
vi.mock('../lib/push.js', () => ({ pushSupported: () => false, enablePush: vi.fn(), disablePush: vi.fn(), sendTestPush: vi.fn() }))
vi.mock('../lib/wakelock.js', () => ({ wakeLockSupported: () => false }))
// MOBILE is read at render time through a getter so one module mock serves both builds.
vi.mock('../lib/mobile.js', () => ({
  get MOBILE() { return mocks.MOBILE },
  isAndroid: () => Promise.resolve(mocks.android),
  shareExport: vi.fn(), syncReminder: vi.fn(),
}))
vi.mock('../lib/update.js', () => ({
  checkForUpdate: (...a) => mocks.checkForUpdate(...a),
  downloadAndInstall: vi.fn(),
}))
vi.mock('./MobileOnboarding.jsx', () => ({ ConnectSheet: () => null }))
vi.mock('../sheets.jsx', () => ({
  starterPlanSheet: vi.fn(), confirmSheet: (...a) => mocks.confirmSheet(...a), importFromApp: vi.fn(),
  importFromHevy: vi.fn(), equipmentProfileSheet: vi.fn(), menuSheet: vi.fn(),
}))

globalThis.__APP_VERSION__ ??= 'test'

let host, root
beforeEach(() => {
  mocks.S = {
    unit: 'kg', restSec: 90, restPauseSec: 15, sound: false, effort: 'none',
    gifSize: 'full', workouts: [], routines: [], exWeights: {},
  }
  mocks.MOBILE = false
  mocks.android = false
  mocks.checkForUpdate.mockClear()
  mocks.confirmSheet.mockClear()
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

// The effect resolves two promises (isAndroid, then checkForUpdate) before the row can render.
const mount = async () => {
  await act(async () => { root.render(<Settings page="about" />) })
  await act(async () => { await Promise.resolve(); await Promise.resolve() })
}
const updateRow = () => [...host.querySelectorAll('.lrow')].find(r => r.textContent.includes('Update to openGym v9.9.9'))
const checkRow = () => [...host.querySelectorAll('.lrow')].find(r => r.textContent.includes('Check for updates'))
const webRow = () => [...host.querySelectorAll('.lrow')].find(r => r.textContent.includes('Get the Android app'))

describe('Settings — about page', () => {
  it('keeps only the version row on the About page', async () => {
    await mount()
    expect(mocks.checkForUpdate).not.toHaveBeenCalled()
    expect(host.textContent).toContain('Version')
    expect(host.textContent).toContain('v1.4.1')
    expect(host.textContent).not.toContain('Get the Android app')
    expect(host.textContent).not.toContain('Download the APK from opengym.ch')
    expect(host.textContent).not.toContain('Check for updates')
    expect(host.textContent).not.toContain('The web app updates together with your server.')
    expect(host.textContent).not.toContain('Tip')
    expect(host.textContent).not.toContain('Source code')
  })

  it('keeps the About page version-only on Android too', async () => {
    mocks.MOBILE = true
    mocks.android = true
    await mount()
    expect(mocks.checkForUpdate).not.toHaveBeenCalled()
    expect(host.textContent).toContain('Version')
    expect(host.textContent).toContain('v1.4.1')
    expect(host.textContent).not.toContain('Check for updates')
    expect(host.textContent).not.toContain('Update to openGym v9.9.9')
    expect(host.textContent).not.toContain('Get the Android app')
  })
})
