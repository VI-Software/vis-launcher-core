import { RequestError, RestResponseStatus } from '../common/rest/RestResponse'
import { VISRAccount, VISRAuthPayload, VISRAuthResponse } from './VISRAccount'
import { VISRResponse, VISRErrorCode, VISRErrorBody, decipherErrorCode } from './rest/VISRResponse'
import { AccountType } from '../auth/AccountType'
import * as os from 'os'
import { machineIdSync } from 'node-machine-id'

export class VISRAuthService {
    private static readonly AUTH_ENDPOINT = 'https://api.visoftware.dev/services/visr/login'

    private static getDeviceInfo(): VISRAuthPayload['device'] {
        return {
            uuid: machineIdSync(),
            id: os.hostname(),
            hostname: os.hostname(),
            platform: process.platform as 'win32' | 'darwin' | 'linux',
            type: os.type(),
            release: os.release(),
            cpu: os.cpus()[0].model,
            ram: os.totalmem(),
            arch: process.arch as 'x64' | 'arm64' | 'ia32' | 'arm'
        }
    }

    public static async authenticate(payload: Omit<VISRAuthPayload, 'device'>): Promise<VISRResponse<VISRAccount>> {
        try {
            const fullPayload: VISRAuthPayload = {
                ...payload,
                device: this.getDeviceInfo()
            }

            const response = await fetch(this.AUTH_ENDPOINT, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(fullPayload)
            })

            const body = await response.json()

            if (!response.ok) {
                const errorBody = body as VISRErrorBody
                const error: RequestError = new Error(errorBody.message)
                error.name = errorBody.error
                return {
                    data: undefined,
                    error,
                    visrErrorCode: decipherErrorCode(errorBody),
                    responseStatus: RestResponseStatus.ERROR
                }
            }

            const authResponse = body as VISRAuthResponse
            return {
                data: {
                    type: AccountType.VISR,
                    username: authResponse.user.username,
                    userId: authResponse.user.id,
                    email: authResponse.user.email,
                    setupStage: authResponse.user.setup_stage,
                    isAdmin: authResponse.user.isAdmin,
                    supportPin: authResponse.user.support_pin,
                    legitowner: authResponse.user.legitowner,
                    rootToken: authResponse.rootToken,
                    device: authResponse.device,
                    minecraftAccounts: authResponse.minecraftAccounts
                },
                error: undefined,
                responseStatus: RestResponseStatus.SUCCESS
            }
        } catch (err) {
            return {
                data: undefined,
                error: err as RequestError,
                visrErrorCode: VISRErrorCode.UNKNOWN,
                responseStatus: RestResponseStatus.ERROR
            }
        }
    }
}
