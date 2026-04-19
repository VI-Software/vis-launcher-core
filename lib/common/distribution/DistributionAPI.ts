import { resolve } from 'path'
import { Distribution } from '@visoftware/distribution-types'
import got, { RequestError } from 'got'
import { LoggerUtil } from '../../util/LoggerUtil'
import { RestResponse, handleGotError, RestResponseStatus } from '../rest/RestResponse'
import { pathExists, readFile, writeJson } from 'fs-extra'
import { HeliosDistribution } from './DistributionFactory'
import { machineIdSync } from 'node-machine-id'
import { 
    DistributionError, 
    UnauthorizedDistributionError, 
    NetworkDistributionError,
    ServerDistributionError 
} from './DistributionError'

// TODO Option to check endpoint for hash of distro for local compare
// Useful if distro is large (MBs)
// #!/bin/bash apt show bug bug go away break our code another day

export class DistributionAPI {

    private static readonly log = LoggerUtil.getLogger('DistributionAPI')

    private readonly DISTRO_FILE = 'distribution.json'
    private readonly DISTRO_FILE_DEV = 'distribution_dev.json'

    private distroPath: string
    private distroDevPath: string

    private distribution!: HeliosDistribution
    private rawDistribution!: Distribution
    private deviceId: string

    constructor(
        private launcherDirectory: string,
        private commonDir: string,
        private instanceDir: string,
        private remoteUrl: string,
        private devMode: boolean,
        private authHeaders: Record<string, string> = {}
    ) {
        this.distroPath = resolve(launcherDirectory, this.DISTRO_FILE)
        this.distroDevPath = resolve(launcherDirectory, this.DISTRO_FILE_DEV)
        
        // Generate the device ID at initialization
        try {
            this.deviceId = machineIdSync()
        } catch (error) {
            DistributionAPI.log.error('Failed to get machine ID', error)
            this.deviceId = 'unknown-device'
        }
    }

    public async getDistribution(): Promise<HeliosDistribution> {
        if(this.rawDistribution == null) {
            this.rawDistribution = await this.loadDistribution()
            this.distribution = new HeliosDistribution(this.rawDistribution, this.commonDir, this.instanceDir)
        }
        return this.distribution
    }

    public async getDistributionLocalLoadOnly(): Promise<HeliosDistribution> {
        if(this.rawDistribution == null) {
            const x = await this.pullLocal()
            if(x == null) {
                throw new DistributionError('FATAL: Unable to load distribution from local disk.')
            }
            this.rawDistribution = x
            this.distribution = new HeliosDistribution(this.rawDistribution, this.commonDir, this.instanceDir)
        }
        return this.distribution
    }

    public async refreshDistributionOrFallback(): Promise<HeliosDistribution> {

        const distro = await this._loadDistributionNullable()

        if(distro == null) {
            DistributionAPI.log.warn('Failed to refresh distribution, falling back to current load (if exists).')
            return this.distribution
        } else {
            this.rawDistribution = distro
            this.distribution = new HeliosDistribution(distro, this.commonDir, this.instanceDir)

            return this.distribution
        }
    }

    public toggleDevMode(dev: boolean): void {
        this.devMode = dev
    }

    public isDevMode(): boolean {
        return this.devMode
    }


    public getAuthHeaders(): Record<string, string> {
        return this.authHeaders
    }

    protected async loadDistribution(): Promise<Distribution> {

        const remoteResult = await this.pullRemote()
        let distro: Distribution | null = null

        if(remoteResult.responseStatus === RestResponseStatus.SUCCESS && remoteResult.data != null) {
            distro = remoteResult.data
            await this.writeDistributionToDisk(distro)
            return distro
        }

        if(remoteResult.error) {
            if(remoteResult.statusCode === 401) {
                DistributionAPI.log.warn('Received 401 Unauthorized. Authentication token may be expired or invalid.')
                distro = await this.pullLocal()
                if(distro != null) {
                    DistributionAPI.log.warn('Using cached distribution due to authentication failure.')
                    return distro
                }
                throw new UnauthorizedDistributionError(
                    'Authentication failed: Invalid or expired token. No local cache available.',
                    remoteResult.error
                )
            }

            if(remoteResult.statusCode != null) {
                DistributionAPI.log.warn(`Received HTTP ${remoteResult.statusCode} from distribution server.`)
                distro = await this.pullLocal()
                if(distro != null) {
                    DistributionAPI.log.warn('Using cached distribution due to server error.')
                    return distro
                }
                // No local cache available, throw server error
                throw new ServerDistributionError(
                    `Distribution server returned error (HTTP ${remoteResult.statusCode}). No local cache available.`,
                    remoteResult.statusCode,
                    remoteResult.error
                )
            }

            // Network error (no response received)
            DistributionAPI.log.warn('Network error while fetching distribution.')
            distro = await this.pullLocal()
            if(distro != null) {
                DistributionAPI.log.warn('Using cached distribution due to network error.')
                return distro
            }
            // No local cache available, throw network error
            throw new NetworkDistributionError(
                'Network error: Unable to reach distribution server. No local cache available.',
                remoteResult.error
            )
        }

        // No error but no data, fall back to local
        distro = await this.pullLocal()
        if(distro == null) {
            throw new DistributionError('FATAL: Unable to load distribution from remote server or local disk.')
        }

        return distro
    }

    protected async _loadDistributionNullable(): Promise<Distribution | null> {

        let distro

        if(!this.devMode) {

            const remoteResult = await this.pullRemote()
            distro = remoteResult.data
            
            if(distro == null) {
                distro = await this.pullLocal()
            } else {
                await this.writeDistributionToDisk(distro)
            }

        } else {
            distro = await this.pullLocal()
        }

        return distro
    }

    protected async pullRemote(): Promise<RestResponse<Distribution | null>> {

        try {
            // Combine auth headers with device header
            const headers = { 
                ...this.authHeaders,
                'device': this.deviceId
            }

            const res = await got.get<Distribution>(this.remoteUrl, { 
                responseType: 'json',
                headers: headers
            })

            return {
                data: res.body,
                responseStatus: RestResponseStatus.SUCCESS
            }

        } catch(error) {

            return handleGotError('Pull Remote', error as RequestError, DistributionAPI.log, () => null)

        }
        
    }

    protected async writeDistributionToDisk(distribution: Distribution): Promise<void> {
        await writeJson(this.distroPath, distribution)
    }

    protected async pullLocal(): Promise<Distribution | null> {
        return await this.readDistributionFromFile(!this.devMode ? this.distroPath : this.distroDevPath)
    }

    protected async readDistributionFromFile(path: string): Promise<Distribution | null> {

        if(await pathExists(path)) {
            const raw = await readFile(path, 'utf-8')
            try {
                return JSON.parse(raw) as Distribution
            } catch(error) {
                DistributionAPI.log.error(`Malformed distribution file at ${path}`)
                return null
            }
        } else {
            DistributionAPI.log.error(`No distribution file found at ${path}!`)
            return null
        }

    }

}
