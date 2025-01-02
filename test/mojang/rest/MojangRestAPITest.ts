/* eslint-disable @typescript-eslint/no-explicit-any */
import { AuthPayload, MojangRestAPI, Session } from '../../../lib/mojang/rest/MojangRestAPI'
import { expect } from 'chai'
import nock from 'nock'
import { MojangErrorCode, MojangResponse } from '../../../lib/mojang/rest/MojangResponse'
import { assertResponse, expectFailure, expectSuccess } from '../../common/RestResponseUtil'

function expectMojangResponse(res: MojangResponse<unknown>, responseCode: MojangErrorCode, negate = false): void {
    assertResponse(res)
    expect(res).to.have.property('mojangErrorCode')
    if (!negate) {
        expect(res.mojangErrorCode).to.equal(responseCode)
    } else {
        expect(res.mojangErrorCode).to.not.equal(responseCode)
    }
}

describe('[Mojang Rest API] Errors', () => {

    after(() => {
        nock.cleanAll()
    })

    it('Status (Offline)', async () => {

        // eslint-disable-next-line @typescript-eslint/dot-notation
        const defStatusHack = MojangRestAPI['statuses']

        nock(MojangRestAPI.STATUS_ENDPOINT)
            .get('/')
            .reply(500, 'Service temprarily offline.')

        const res = await MojangRestAPI.status()
        expectFailure(res)
        expect(res.data).to.be.an('array')
        expect(res.data).to.deep.equal(defStatusHack)

    }).timeout(2500)

    it('Authenticate (Invalid Credentials)', async () => {

        nock(MojangRestAPI.API_ENDPOINT)
            .post('services/authentication/login')
            // eslint-disable-next-line @typescript-eslint/no-unused-vars
            .reply(403, (uri, requestBody: unknown): { error: string, errorMessage: string } => {
                return {
                    error: 'ForbiddenOperationException',
                    errorMessage: 'Invalid credentials. Invalid username or password.'
                }
            })

        const res = await MojangRestAPI.authenticate('user', 'pass', 'xxx', true)
        expectMojangResponse(res, MojangErrorCode.ERROR_INVALID_CREDENTIALS)
        expect(res.data).to.be.a('null')
        expect(res.error).to.not.be.a('null')

    })
})

describe('[Mojang Rest API] Status', () => {

    it('Status (Online)', async () => {

        // eslint-disable-next-line @typescript-eslint/dot-notation
        const defStatusHack = MojangRestAPI['statuses']

        nock(MojangRestAPI.STATUS_ENDPOINT)
            .get(/.*/)
            .reply(200, summaryResponse)

        const res = await MojangRestAPI.status()
        expectSuccess(res)
        expect(res.data).to.be.an('array')
        expect(res.data).to.deep.equal(defStatusHack)

    }).timeout(2500)

})

describe('[Mojang Rest API] Auth', () => {

    it('Authenticate', async () => {

        nock(MojangRestAPI.AUTH_ENDPOINT)
            .post('/authenticate')
            .reply(200, (uri, requestBody: AuthPayload): Session => {
                const mockResponse: Session = {
                    accessToken: 'abc',
                    clientToken: requestBody.clientToken!,
                    selectedProfile: {
                        id: 'def',
                        name: 'username'
                    }
                }

                if (requestBody.requestUser) {
                    mockResponse.user = {
                        id: 'def',
                        properties: []
                    }
                }

                return mockResponse
            })

        const res = await MojangRestAPI.authenticate('user', 'pass', 'xxx', true)
        expectSuccess(res)
        expect(res.data!.clientToken).to.equal('xxx')
        expect(res.data).to.have.property('user')

    })

    it('Validate', async () => {

        nock(MojangRestAPI.AUTH_ENDPOINT)
            .post('/validate')
            .times(2)
            .reply((uri, requestBody: any) => {
                return [
                    requestBody.accessToken === 'abc' ? 204 : 403
                ]
            })

        const res = await MojangRestAPI.validate('abc', 'def')

        expectSuccess(res)
        expect(res.data).to.be.a('boolean')
        expect(res.data).to.equal(true)

        const res2 = await MojangRestAPI.validate('def', 'def')

        expectSuccess(res2)
        expect(res2.data).to.be.a('boolean')
        expect(res2.data).to.equal(false)

    })

    it('Invalidate', async () => {

        nock(MojangRestAPI.AUTH_ENDPOINT)
            .post('/invalidate')
            .reply(204)

        const res = await MojangRestAPI.invalidate('adc', 'def')

        expectSuccess(res)

    })

    it('Refresh', async () => {

        nock(MojangRestAPI.AUTH_ENDPOINT)
            .post('/refresh')
            .reply(200, (uri, requestBody: any): Session => {
                const mockResponse: Session = {
                    accessToken: 'abc',
                    clientToken: requestBody.clientToken as string,
                    selectedProfile: {
                        id: 'def',
                        name: 'username'
                    }
                }

                if (requestBody.requestUser) {
                    mockResponse.user = {
                        id: 'def',
                        properties: []
                    }
                }

                return mockResponse
            })

        const res = await MojangRestAPI.refresh('gfd', 'xxx', true)
        expectSuccess(res)
        expect(res.data!.clientToken).to.equal('xxx')
        expect(res.data).to.have.property('user')

    })

})

const summaryResponse  = [
    {
        'name': 'VI Software Portal',
        'url': 'https://visoftware.dev',
        'icon': 'https://icons.duckduckgo.com/ip3/visoftware.dev.ico',
        'slug': 'vi-software-portal',
        'status': 'up',
        'uptime': '98.28%',
        'uptimeDay': '98.28%',
        'uptimeWeek': '98.28%',
        'uptimeMonth': '98.28%',
        'uptimeYear': '98.28%',
        'time': 501,
        'timeDay': 501,
        'timeWeek': 501,
        'timeMonth': 501,
        'timeYear': 501,
        'dailyMinutesDown': {
            '2025-01-02': 5,
            '2025-01-01': 15
        }
    },
    {
        'name': 'VI Software API',
        'url': 'https://api.visoftware.dev/services/servers',
        'icon': 'https://icons.duckduckgo.com/ip3/api.visoftware.dev.ico',
        'slug': 'vi-software-api',
        'status': 'up',
        'uptime': '96.83%',
        'uptimeDay': '98.40%',
        'uptimeWeek': '99.77%',
        'uptimeMonth': '99.93%',
        'uptimeYear': '96.83%',
        'time': 248,
        'timeDay': 460,
        'timeWeek': 455,
        'timeMonth': 248,
        'timeYear': 248,
        'dailyMinutesDown': {
            '2025-01-02': 5,
            '2025-01-01': 18,
            '2024-12-08': 2,
            '2024-09-03': 15,
            '2024-09-01': 124,
            '2024-08-30': 379,
            '2024-08-29': 389,
            '2024-08-20': 64,
            '2024-08-15': 34,
            '2024-08-12': 8,
            '2024-08-06': 5,
            '2024-08-05': 69,
            '2024-08-02': 8,
            '2024-07-31': 21
        }
    },
    {
        'name': 'VI Software Yggdrasil Auth Server',
        'url': 'https://authserver.visoftware.dev',
        'icon': 'https://icons.duckduckgo.com/ip3/authserver.visoftware.dev.ico',
        'slug': 'vi-software-yggdrasil-auth-server',
        'status': 'up',
        'uptime': '83.72%',
        'uptimeDay': '99.24%',
        'uptimeWeek': '99.89%',
        'uptimeMonth': '99.96%',
        'uptimeYear': '83.72%',
        'time': 181,
        'timeDay': 489,
        'timeWeek': 389,
        'timeMonth': 181,
        'timeYear': 181,
        'dailyMinutesDown': {
            '2025-01-02': 5,
            '2025-01-01': 6,
            '2024-12-08': 2,
            '2024-09-03': 15,
            '2024-09-01': 124,
            '2024-08-30': 548,
            '2024-08-29': 389,
            '2024-08-20': 659,
            '2024-08-19': 1440,
            '2024-08-18': 1440,
            '2024-08-17': 108,
            '2024-08-15': 339,
            '2024-08-05': 19,
            '2024-08-03': 6,
            '2024-08-01': 649,
            '2024-07-31': 121
        }
    },
    {
        'name': 'VI Software CDN',
        'url': 'https://cdn.visoftware.dev',
        'icon': 'https://icons.duckduckgo.com/ip3/cdn.visoftware.dev.ico',
        'slug': 'vi-software-cdn',
        'status': 'up',
        'uptime': '84.22%',
        'uptimeDay': '98.40%',
        'uptimeWeek': '99.77%',
        'uptimeMonth': '99.93%',
        'uptimeYear': '84.22%',
        'time': 177,
        'timeDay': 412,
        'timeWeek': 304,
        'timeMonth': 177,
        'timeYear': 177,
        'dailyMinutesDown': {
            '2025-01-02': 5,
            '2025-01-01': 18,
            '2024-12-08': 2,
            '2024-09-03': 15,
            '2024-09-01': 124,
            '2024-08-30': 375,
            '2024-08-29': 346,
            '2024-08-23': 891,
            '2024-08-22': 1440,
            '2024-08-21': 1440,
            '2024-08-20': 751,
            '2024-08-12': 8,
            '2024-08-06': 123,
            '2024-08-05': 119,
            '2024-08-02': 5,
            '2024-07-31': 25
        }
    },
    {
        'name': 'VI Software Skin Rendering Service',
        'url': 'https://skins.visoftware.dev',
        'icon': 'https://icons.duckduckgo.com/ip3/skins.visoftware.dev.ico',
        'slug': 'vi-software-skin-rendering-service',
        'status': 'up',
        'uptime': '99.13%',
        'uptimeDay': '98.34%',
        'uptimeWeek': '99.76%',
        'uptimeMonth': '99.93%',
        'uptimeYear': '99.13%',
        'time': 123,
        'timeDay': 318,
        'timeWeek': 225,
        'timeMonth': 123,
        'timeYear': 123,
        'dailyMinutesDown': {
            '2025-01-01': 24,
            '2024-12-08': 2,
            '2024-09-03': 15,
            '2024-09-01': 124,
            '2024-08-31': 5,
            '2024-08-29': 25,
            '2024-08-12': 3,
            '2024-08-06': 5,
            '2024-08-01': 95,
            '2024-07-31': 18
        }
    },
    {
        'name': 'VI Software Docs',
        'url': 'https://docs.visoftware.dev',
        'icon': 'https://icons.duckduckgo.com/ip3/docs.visoftware.dev.ico',
        'slug': 'vi-software-docs',
        'status': 'up',
        'uptime': '100.00%',
        'uptimeDay': '100.00%',
        'uptimeWeek': '100.00%',
        'uptimeMonth': '100.00%',
        'uptimeYear': '100.00%',
        'time': 524,
        'timeDay': 569,
        'timeWeek': 563,
        'timeMonth': 524,
        'timeYear': 524,
        'dailyMinutesDown': {}
    }
]