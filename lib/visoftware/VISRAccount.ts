import { AccountType } from '../auth/AccountType'

export interface VISRAccount {
    type: AccountType.VISR
    username: string
    userId: number
    email: string
    setupStage: string
    isAdmin: boolean
    supportPin: string
    legitowner: boolean
    rootToken: {
        token: string
        expires: string
        refreshed: boolean
    }
    device: {
        uuid: string
        verified: boolean
        lastSession: string
    }
    minecraftAccounts: VISRMinecraftAccount[]
}

export interface VISRAuthPayload {
    username: string
    password: string
    device: {
        uuid: string
        id: string
        hostname: string
        platform: 'win32' | 'darwin' | 'linux' | 'android'
        type: string
        release: string
        cpu: string
        ram: number
        arch: 'x64' | 'arm64' | 'ia32' | 'arm'
    }
}

export interface VISRMinecraftAccount {
    id: string
    name: string
    accessToken: string
    isMain: boolean
}

export interface VISRAuthResponse {
    rootToken: {
        token: string
        expires: string
        refreshed: boolean
    }
    user: {
        id: number
        username: string
        email: string
        setup_stage: string
        isAdmin: boolean
        support_pin: string
        legitowner: boolean
    }
    device: {
        uuid: string
        verified: boolean
        lastSession: string
    }
    minecraftAccounts: VISRMinecraftAccount[]
}
