import { expect } from 'chai'
import { VISRAuthService } from '../../lib/visoftware/VISRAuthService'
import { RestResponseStatus } from '../../lib/common/rest/RestResponse'
import { VISRErrorCode } from '../../lib/visoftware/rest/VISRResponse'
import { AccountType } from '../../lib/auth/AccountType'
import { expectFailure, expectSuccess } from '../common/RestResponseUtil'
import { VISRAuthPayload } from '../../lib/visoftware/VISRAccount'

describe('[VISR Auth Service]', () => {
    let originalFetch: typeof global.fetch

    beforeEach((): void => {
        originalFetch = global.fetch
    })

    afterEach((): void => {
        global.fetch = originalFetch
    })

    it('should handle successful response', async (): Promise<void> => {
        global.fetch = async (): Promise<Response> => new Response(JSON.stringify({
            rootToken: { token: 'test-token-123' },
            minecraftAccounts: [{ id: 'uuid1', name: 'player1' }]
        }), { status: 200 })

        const res = await VISRAuthService.authenticate({
            username: 'test@example.com',
            password: 'pass123'
        })

        expectSuccess(res)
        expect(res.data?.type).to.equal(AccountType.VISR)
        expect(res.data?.rootToken.token).to.equal('test-token-123')
        expect(res.data?.minecraftAccounts).to.have.lengthOf(1)
    })

    it('should handle invalid credentials', async (): Promise<void> => {
        global.fetch = async (): Promise<Response> => new Response(JSON.stringify({
            error: 'InvalidCredentials',
            message: 'Invalid username or password'
        }), { status: 403 })

        const res = await VISRAuthService.authenticate({
            username: 'test@example.com',
            password: 'wrong'
        })

        expectFailure(res)
        expect(res.visrErrorCode).to.equal(VISRErrorCode.ERROR_INVALID_CREDENTIALS)
        expect(res.responseStatus).to.equal(RestResponseStatus.ERROR)
    })

    it('should handle network error', async (): Promise<void> => {
        global.fetch = async (): Promise<Response> => { throw new Error('Network error') }

        const res = await VISRAuthService.authenticate({
            username: 'test@example.com',
            password: 'pass123'
        })

        expectFailure(res)
        expect(res.visrErrorCode).to.equal(VISRErrorCode.UNKNOWN)
        expect(res.responseStatus).to.equal(RestResponseStatus.ERROR)
    })

    it('should include device information in request', async (): Promise<void> => {
        let capturedPayload: VISRAuthPayload | undefined
        
        global.fetch = (async (input: RequestInfo, init?: RequestInit): Promise<Response> => {
            capturedPayload = JSON.parse(init?.body as string) as VISRAuthPayload 
            return new Response(JSON.stringify({
                rootToken: { token: 'test-token-123' },
                minecraftAccounts: [{ id: 'uuid1', name: 'player1' }]
            }), { status: 200 })
        }) as typeof global.fetch

        await VISRAuthService.authenticate({
            username: 'test@example.com',
            password: 'pass123'
        })

        expect(capturedPayload).to.not.be.undefined
        if (capturedPayload) {
            expect(capturedPayload).to.have.property('device')
            expect(capturedPayload.device).to.have.all.keys([
                'uuid',
                'id', 
                'hostname',
                'platform',
                'type',
                'release',
                'cpu',
                'ram',
                'arch'
            ])
        }
    })
})
