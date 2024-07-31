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
        'name': 'VI Software API',
        'url': 'https://api.visoftware.tech/services/servers',
        'icon': 'https://icons.duckduckgo.com/ip3/api.visoftware.tech.ico',
        'slug': 'vi-software-api',
        'status': 'up',
        'uptime': '76.70%',
        'uptimeDay': '76.70%',
        'uptimeWeek': '76.70%',
        'uptimeMonth': '76.70%',
        'uptimeYear': '76.70%',
        'time': 13361,
        'timeDay': 13361,
        'timeWeek': 13361,
        'timeMonth': 13361,
        'timeYear': 13361,
        'dailyMinutesDown': {
            '2024-07-31': 8
        }
    },
    {
        'name': 'VI Software Yggdrasil Auth Server',
        'url': 'https://authserver.visoftware.tech',
        'icon': 'https://icons.duckduckgo.com/ip3/authserver.visoftware.tech.ico',
        'slug': 'vi-software-yggdrasil-auth-server',
        'status': 'up',
        'uptime': '52.42%',
        'uptimeDay': '52.42%',
        'uptimeWeek': '52.42%',
        'uptimeMonth': '52.42%',
        'uptimeYear': '52.42%',
        'time': 13360,
        'timeDay': 13360,
        'timeWeek': 13360,
        'timeMonth': 13360,
        'timeYear': 13360,
        'dailyMinutesDown': {
            '2024-07-31': 15
        }
    },
    {
        'name': 'VI Software CDN',
        'url': 'https://cdn.visoftware.tech',
        'icon': 'https://icons.duckduckgo.com/ip3/cdn.visoftware.tech.ico',
        'slug': 'vi-software-cdn',
        'status': 'up',
        'uptime': '61.72%',
        'uptimeDay': '61.72%',
        'uptimeWeek': '61.72%',
        'uptimeMonth': '61.72%',
        'uptimeYear': '61.72%',
        'time': 13170,
        'timeDay': 13170,
        'timeWeek': 13170,
        'timeMonth': 13170,
        'timeYear': 13170,
        'dailyMinutesDown': {
            '2024-07-31': 13
        }
    },
    {
        'name': 'VI Software PUF',
        'url': 'https://puf.visoftware.tech',
        'icon': 'https://icons.duckduckgo.com/ip3/puf.visoftware.tech.ico',
        'slug': 'vi-software-puf',
        'status': 'up',
        'uptime': '71.27%',
        'uptimeDay': '71.27%',
        'uptimeWeek': '71.27%',
        'uptimeMonth': '71.27%',
        'uptimeYear': '71.27%',
        'time': 6846,
        'timeDay': 6846,
        'timeWeek': 6846,
        'timeMonth': 6846,
        'timeYear': 6846,
        'dailyMinutesDown': {
            '2024-07-31': 9
        }
    },
    {
        'name': 'VI Software PUF Nightly',
        'url': 'https://nightly-puf.visoftware.tech',
        'icon': 'https://icons.duckduckgo.com/ip3/nightly-puf.visoftware.tech.ico',
        'slug': 'vi-software-puf-nightly',
        'status': 'up',
        'uptime': '80.80%',
        'uptimeDay': '80.80%',
        'uptimeWeek': '80.80%',
        'uptimeMonth': '80.80%',
        'uptimeYear': '80.80%',
        'time': 13632,
        'timeDay': 13632,
        'timeWeek': 13632,
        'timeMonth': 13632,
        'timeYear': 13632,
        'dailyMinutesDown': {
            '2024-07-31': 6
        }
    },
    {
        'name': 'VI Software Skin Rendering Service',
        'url': 'https://skins.visoftware.tech',
        'icon': 'https://icons.duckduckgo.com/ip3/skins.visoftware.tech.ico',
        'slug': 'vi-software-skin-rendering-service',
        'status': 'up',
        'uptime': '100.00%',
        'uptimeDay': '100.00%',
        'uptimeWeek': '100.00%',
        'uptimeMonth': '100.00%',
        'uptimeYear': '100.00%',
        'time': 13331,
        'timeDay': 13331,
        'timeWeek': 13331,
        'timeMonth': 13331,
        'timeYear': 13331,
        'dailyMinutesDown': {}
    },
    {
        'name': 'VI Software Docs',
        'url': 'https://docs.visoftware.tech',
        'icon': 'https://icons.duckduckgo.com/ip3/docs.visoftware.tech.ico',
        'slug': 'vi-software-docs',
        'status': 'up',
        'uptime': '100.00%',
        'uptimeDay': '100.00%',
        'uptimeWeek': '100.00%',
        'uptimeMonth': '100.00%',
        'uptimeYear': '100.00%',
        'time': 497,
        'timeDay': 497,
        'timeWeek': 497,
        'timeMonth': 497,
        'timeYear': 497,
        'dailyMinutesDown': {}
    }
]