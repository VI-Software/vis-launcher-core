import { createWriteStream, WriteStream } from 'fs'
import got, { CancelError, HTTPError, ParseError, Progress, ReadError, RequestError } from 'got'
import { pipeline } from 'stream/promises'
import { Asset } from './Asset'
import * as fastq from 'fastq'
import type { queueAsPromised } from 'fastq'
import { ensureDir } from 'fs-extra'
import { dirname } from 'path'
import { LoggerUtil } from '../util/LoggerUtil'
import { sleep } from '../util/NodeUtil'
import { machineIdSync } from 'node-machine-id'

const log = LoggerUtil.getLogger('DownloadEngine')

// Cache the device ID to avoid multiple calls to machineIdSync
let deviceId: string
function getDeviceId(): string {
    if (!deviceId) {
        try {
            deviceId = machineIdSync()
        } catch (error) {
            log.error('Failed to get machine ID', error)
            deviceId = 'unknown-device'
        }
    }
    return deviceId
}

export function getExpectedDownloadSize(assets: Asset[]): number {
    return assets.map(({ size }) => size).reduce((acc, v) => acc + v, 0)
}

export async function downloadQueue(assets: Asset[], onProgress: (received: number) => void): Promise<{ [id: string]: number }> {

    const receivedTotals: { [id: string]: number } = assets.map(({ id }) => id).reduce((acc, id) => ({ ...acc, [id]: 0}), ({}))

    let received = 0

    const onEachProgress = (asset: Asset): (progress: Progress) => void => {
        return ({ transferred }: Progress): void => {
            received += (transferred - receivedTotals[asset.id])
            receivedTotals[asset.id] = transferred
            onProgress(received)
        }
    }

    const wrap = (asset: Asset): Promise<void> => downloadFile(asset.url, asset.path, onEachProgress(asset), asset.headers)

    const q: queueAsPromised<Asset, void> = fastq.promise(wrap, 15)

    const promises: Promise<void>[] = assets.map(asset => q.push(asset)).reduce((acc, p) => ([...acc, p]), ([] as Promise<void>[]))
    await Promise.all(promises)

    return receivedTotals
}

export async function downloadFile(url: string, path: string, onProgress?: (progress: Progress) => void, authHeaders?: Record<string, string>): Promise<void> {

    await ensureDir(dirname(path))

    // Only add device ID if not already provided in headers
    const headers = authHeaders || {}
    if (!headers.device) {
        headers.device = getDeviceId()
    }

    const MAX_RETRIES = 10
    let fileWriterStream: WriteStream = null!       // The write stream.
    let retryCount = 0                              // The number of retries attempted.
    let error: Error = null!                        // The caught error.
    let retry = false                               // Should we retry.
    let rethrow = false                             // Should we throw an error.

    // Got's streaming retry API is nonexistant and their "example" is egregious.
    // To use their "api" you need to commit yourself to recursive callback hell.
    // No thank you, I prefer this simpler, non error-prone logic.
    do {

        retry = false
        rethrow = false

        if(retryCount > 0) {
            log.debug(`Retry attempt #${retryCount} for ${url}.`)
        }

        try {
            // Always pass headers, even if empty
            const options = { headers }
            const downloadStream = got.stream(url, options)

            fileWriterStream = createWriteStream(path)

            if(onProgress) {
                downloadStream.on('downloadProgress', (progress: Progress) => onProgress(progress))
            }

            await pipeline(downloadStream, fileWriterStream)

        } catch(err) {
            error = err as Error
            retryCount++
            rethrow = true

            // For now, only retry timeouts.
            retry = retryCount <= MAX_RETRIES && retryableError(error)

            if(fileWriterStream) {
                fileWriterStream.destroy()
            }

            if(onProgress && retry) {
                // Reset progress on this asset. since we're going to retry.
                onProgress({ transferred: 0, percent: 0, total: 0 })
            }

            if(retry) {
                // Wait one second before retrying.
                // This can become an exponential backoff, but I see no need for that right now.
                await sleep(1000)
            }
        }

    } while(retry)

    if(rethrow && error) {
        const detail = `${error.name}${(error as Error & { code?: string }).code ? ` (${(error as Error & { code?: string }).code})` : ``}: ${error.message}`
        if(retryCount > MAX_RETRIES) {
            log.error(`Maximum retries attempted for ${url}. Last error was ${detail}. Rethrowing exception.`)
        } else {
            log.error(`Non-retryable exception for ${url}: ${detail}. Rethrowing exception.`)
        }

        throw error
    }

}

/**
 * Decide whether a download failure is worth retrying.
 *
 * Retried: network-level failures before/while receiving the response
 * (DNS resolution, connection refused, socket timeout, connection reset).
 * Also retried: HTTP responses where the server side is likely at fault
 * (5xx), a client timeout (408) or rate limiting (429).
 *
 * Not retried: permanent request errors (404, 403, protocol errors),
 * cancelled requests, response parsing errors, and anything that is not
 * a request error at all (e.g. local file system problems).
 */
export function retryableError(error: Error): boolean {
    if(error instanceof CancelError || error instanceof ParseError) {
        return false
    }
    if(error instanceof HTTPError) {
        const statusCode = error.response.statusCode
        return statusCode === 408 || statusCode === 429 || statusCode >= 500
    }
    if(error instanceof ReadError) {
        return error.code === 'ECONNRESET' || error.code === 'EPIPE'
    }
    // Covers bare RequestError and its TimeoutError subclass: the request
    // failed at the network level without a usable response.
    return error instanceof RequestError
}