import { expect } from 'chai'
import {
    CancelError,
    HTTPError,
    ParseError,
    ReadError,
    RequestError,
    TimeoutError
} from 'got'
import { retryableError } from '../../../lib/dl/DownloadEngine'

// got 11 constructor signatures, verified at runtime:
//   RequestError(message, {code}, options)
//   HTTPError(response)
//   TimeoutError(wrappedError, timings, options)
//   ReadError(wrappedError, requestLike)
//   ParseError(wrappedError, response, options)
//   CancelError(options)
// Only the fields the classification reads are populated; the runtime casts
// below keep the test independent of got's internal typings.
// got 11 only attaches `response`/`options` to its errors from a real Request
// instance; the fakes attach them explicitly to match a production error.
const opts = { url: 'https://example.com/test.jar', method: 'GET', retry: { methods: [] } }

const fakeRequest = {
    options: { url: new URL('https://example.com/test.jar') }
}

const response = {
    statusCode: 0,
    statusMessage: 'test',
    body: '',
    headers: {},
    url: 'https://example.com/test.jar',
    requestUrl: 'https://example.com/test.jar',
    retryCount: 0,
    timings: {},
    rawBody: Buffer.alloc(0),
    request: fakeRequest
}

function buildHTTPError(statusCode: number): HTTPError {
    const C = HTTPError as unknown as new (res: object) => HTTPError
    const err = new C({ ...response, statusCode })
    // Mirror the non-enumerable property got sets from a real Request.
    Object.defineProperty(err, 'response', { value: { ...response, statusCode } })
    return err
}

function buildReadError(code: string): ReadError {
    const C = ReadError as unknown as new (error: Error, requestLike: object) => ReadError
    const err = new C(Object.assign(new Error('socket problem'), { code }), opts)
    err.code = code as string
    return err
}

describe('Download Engine — retryableError', function() {

    it('[ RE ] plain non-request errors are not retryable', function() {
        expect(retryableError(new Error('something else'))).to.equal(false)
        expect(retryableError(Object.assign(new Error('disk full'), { code: 'ENOSPC' }))).to.equal(false)
    })

    it('[ RE ] bare RequestError (network level: DNS, refused, timeout) is retryable', function() {
        const C = RequestError as unknown as new (message: string, error: { code?: string }, options: object) => RequestError
        expect(retryableError(new C('no response', { code: 'ENOTFOUND' }, opts))).to.equal(true)
        expect(retryableError(new C('refused', { code: 'ECONNREFUSED' }, opts))).to.equal(true)
    })

    it('[ RE ] TimeoutError is retryable even though its name differs from RequestError', function() {
        const C = TimeoutError as unknown as new (
            error: Error, timings: object, options: object) => TimeoutError
        const wrapped = Object.assign(new Error('Timeout awaiting request'), {
            name: 'TimeoutError', code: 'ETIMEDOUT', event: 'response', timings: {}
        })
        const timeoutError = new C(wrapped, [], opts)
        expect(timeoutError instanceof RequestError).to.equal(true)
        expect(retryableError(timeoutError)).to.equal(true)
    })

    it('[ RE ] ReadError is retryable only for connection reset / broken pipe', function() {
        expect(retryableError(buildReadError('ECONNRESET'))).to.equal(true)
        expect(retryableError(buildReadError('EPIPE'))).to.equal(true)
        expect(retryableError(buildReadError('EACCES'))).to.equal(false)
    })

    it('[ RE ] HTTP 4xx (except 408/429) is permanent and not retryable', function() {
        expect(retryableError(buildHTTPError(404))).to.equal(false)
        expect(retryableError(buildHTTPError(403))).to.equal(false)
        expect(retryableError(buildHTTPError(401))).to.equal(false)
    })

    it('[ RE ] HTTP 408, 429 and 5xx are retryable', function() {
        expect(retryableError(buildHTTPError(408))).to.equal(true)
        expect(retryableError(buildHTTPError(429))).to.equal(true)
        expect(retryableError(buildHTTPError(500))).to.equal(true)
        expect(retryableError(buildHTTPError(502))).to.equal(true)
        expect(retryableError(buildHTTPError(503))).to.equal(true)
    })

    it('[ RE ] cancelled requests and parse errors are not retryable', function() {
        const cancelC = CancelError as unknown as new (options: object) => CancelError
        expect(retryableError(new cancelC(opts))).to.equal(false)

        const parseC = ParseError as unknown as new (
            error: Error, res: object, options?: object) => ParseError
        expect(retryableError(new parseC(
            new Error('bad json'),
            { request: fakeRequest }
        ))).to.equal(false)
    })

})
