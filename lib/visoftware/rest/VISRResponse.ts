import { DisplayableError, RestResponse } from '../../common/rest/RestResponse'

export enum VISRErrorCode {
    ERROR_INVALID_REQUEST,
    ERROR_INVALID_DEVICE,
    ERROR_INVALID_CREDENTIALS,
    ERROR_RATELIMIT,
    ERROR_ACCOUNT_BANNED,
    ERROR_INVALID_TOKEN,
    ERROR_NO_MINECRAFT_ACCOUNT,
    UNKNOWN
}

export function visrErrorDisplayable(errorCode: VISRErrorCode): DisplayableError {
    switch(errorCode) {
        case VISRErrorCode.ERROR_INVALID_REQUEST:
            return {
                title: 'Error During Login:<br>Invalid Request',
                desc: 'The login request is missing required information.'
            }
        case VISRErrorCode.ERROR_INVALID_DEVICE:
            return {
                title: 'Error During Login:<br>Invalid Device',
                desc: 'The provided device information is invalid.'
            }
        case VISRErrorCode.ERROR_INVALID_CREDENTIALS:
            return {
                title: 'Error During Login:<br>Invalid Credentials',
                desc: 'The email or password you\'ve entered is incorrect. Please try again.'
            }
        case VISRErrorCode.ERROR_RATELIMIT:
            return {
                title: 'Error During Login:<br>Too Many Attempts',
                desc: 'There have been too many login attempts with this account recently. Please try again later.'
            }
        case VISRErrorCode.ERROR_ACCOUNT_BANNED:
            return {
                title: 'Error During Login:<br>Account Banned',
                desc: 'This account has been banned.'
            }
        case VISRErrorCode.ERROR_INVALID_TOKEN:
            return {
                title: 'Error During Login:<br>Invalid Token',
                desc: 'Your session has expired. Please log in again.'
            }
        case VISRErrorCode.ERROR_NO_MINECRAFT_ACCOUNT:
            return {
                title: 'Error During Login:<br>No Minecraft Account',
                desc: 'No Minecraft accounts are linked to this VISR account.'
            }
        case VISRErrorCode.UNKNOWN:
            return {
                title: 'Unknown Error During Login',
                desc: 'An unknown error has occurred. Please see the console for details.'
            }
    }
}

export interface VISRResponse<T> extends RestResponse<T> {
    visrErrorCode?: VISRErrorCode
}

export interface VISRErrorBody {
    error: string
    message: string
    details?: string[]
}

export function decipherErrorCode(body: VISRErrorBody): VISRErrorCode {
    switch(body.error) {
        case 'ERROR_INVALID_REQUEST':
            return VISRErrorCode.ERROR_INVALID_REQUEST
        case 'ERROR_INVALID_DEVICE':
            return VISRErrorCode.ERROR_INVALID_DEVICE
        case 'InvalidCredentials':
            return VISRErrorCode.ERROR_INVALID_CREDENTIALS
        case 'RateLimit':
            return VISRErrorCode.ERROR_RATELIMIT
        case 'ERROR_ACCOUNT_BANNED':
            return VISRErrorCode.ERROR_ACCOUNT_BANNED
        case 'InvalidToken':
            return VISRErrorCode.ERROR_INVALID_TOKEN
        case 'NoMinecraftAccount':
            return VISRErrorCode.ERROR_NO_MINECRAFT_ACCOUNT
        default:
            return VISRErrorCode.UNKNOWN
    }
}
