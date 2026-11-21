import { LoggerUtil } from '../../util/LoggerUtil'
import { IndexProcessor } from '../IndexProcessor'
import { AssetGuardError } from '../AssetGuardError'
import { validateLocalFile, getVersionJsonPath, getLibraryDir} from '../../common/util/FileUtils'
import { Asset, HashAlgo } from '../Asset'
import { HeliosDistribution, HeliosModule, HeliosServer } from '../../common/distribution/DistributionFactory'
import { Module, Type } from '@visoftware/distribution-types'
import { mcVersionAtLeast } from '../../common/util/MojangUtils'
import { ensureDir, readJson, writeJson } from 'fs-extra'
import StreamZip from 'node-stream-zip'
import { dirname, join } from 'path'
import { VersionJsonBase } from '../mojang/MojangTypes'
import { machineIdSync } from 'node-machine-id'

export class DistributionIndexProcessor extends IndexProcessor {

    private static readonly logger = LoggerUtil.getLogger('DistributionIndexProcessor')
    private deviceId: string

    constructor(
        commonDir: string, 
        protected distribution: HeliosDistribution, 
        protected serverId: string,
        protected authHeaders: Record<string, string> = {}
    ) {
        super(commonDir)
        
        // Generate the device ID at initialization
        try {
            this.deviceId = machineIdSync()
        } catch (error) {
            DistributionIndexProcessor.logger.error('Failed to get machine ID', error)
            this.deviceId = 'unknown-device'
        }
    }

    public async init(): Promise<void> {
        // no-op
    }

    public totalStages(): number {
        return 1
    }

    public async validate(onStageComplete: () => Promise<void>): Promise<{[category: string]: Asset[]}> {

        const server: HeliosServer = this.distribution.getServerById(this.serverId)!
        if(server == null) {
            throw new AssetGuardError(`Invalid server id ${this.serverId}`)
        }

        const notValid: Asset[] = []
        await this.validateModules(server.modules, notValid)
        await onStageComplete()

        return {
            distribution: notValid
        }
    }

    public async postDownload(): Promise<void> {
        await this.loadModLoaderVersionJson()
    }

    private async validateModules(modules: HeliosModule[], accumulator: Asset[]): Promise<void> {
        for(const module of modules) {
            const hash = module.rawModule.artifact.MD5

            if(!await validateLocalFile(module.getPath(), HashAlgo.MD5, hash)) {
                accumulator.push({
                    id: module.rawModule.id,
                    hash: hash!,
                    algo: HashAlgo.MD5,
                    size: module.rawModule.artifact.size,
                    url: module.rawModule.artifact.url,
                    path: module.getPath(),
                    headers: {
                        ...this.authHeaders,
                        'device': this.deviceId
                    }
                })
            }

            if(module.rawModule.installer != null) {
                await this.validateInstallerFiles(module.rawModule, accumulator)
            }

            if(module.hasSubModules()) {
                await this.validateModules(module.subModules, accumulator)
            }
        }
    }

    /**
     * The installer payload declares the files extracted from the loader
     * installer jar (e.g. the client binary patch). They are stored under the
     * library directory and validated along with the rest of the distribution.
     */
    private async validateInstallerFiles(rawModule: Module, accumulator: Asset[]): Promise<void> {
        const installer = rawModule.installer!
        for(const installerFile of installer.installerFiles) {
            const path = join(getLibraryDir(this.commonDir), installerFile.artifact.path)
            const md5 = installerFile.artifact.MD5
            if(!await validateLocalFile(path, HashAlgo.MD5, md5)) {
                accumulator.push({
                    id: `${rawModule.id}@${installerFile.pathInInstaller}`,
                    hash: md5!,
                    algo: HashAlgo.MD5,
                    size: installerFile.artifact.size,
                    url: installerFile.artifact.url,
                    path,
                    headers: {
                        ...this.authHeaders,
                        'device': this.deviceId
                    }
                })
            }
        }
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    public async loadModLoaderVersionJson(): Promise<VersionJsonBase> {

        const server: HeliosServer = this.distribution.getServerById(this.serverId)!
        if(server == null) {
            throw new AssetGuardError(`Invalid server id ${this.serverId}`)
        }

        const modLoaderModule = server.modules.find(({ rawModule: { type } }) => 
            type === Type.ForgeHosted || 
            type === Type.Forge || 
            type === Type.Fabric ||
            type === Type.NeoForge
        )

        if(modLoaderModule == null) {
            throw new AssetGuardError('No mod loader found!')
        }

        // NeoForge uses the same version manifest approach as Fabric and ForgeGradle3+
        if(modLoaderModule.rawModule.type === Type.Fabric
            || modLoaderModule.rawModule.type === Type.NeoForge
            || DistributionIndexProcessor.isForgeGradle3(server.rawServer.minecraftVersion, modLoaderModule.getMavenComponents().version)) {
            return await this.loadVersionManifest<VersionJsonBase>(modLoaderModule)
        } else {

            const zip = new StreamZip.async({ file: modLoaderModule.getPath() })

            try {

                const data = JSON.parse((await zip.entryData('version.json')).toString('utf8')) as VersionJsonBase
                const writePath = getVersionJsonPath(this.commonDir, data.id)
    
                await ensureDir(dirname(writePath))
                await writeJson(writePath, data)
    
                return data
            }
            finally {
                await zip.close()
            }
            
        }
    }

    /**
     * Reads the mod loader version manifest module from a server's module tree.
     *
     * For NeoForge, the module tree carries two VersionManifest submodules
     * (NeoForge's own and Minecraft's), so the manifest whose id identifies neoforge
     * is preferred. Other loaders take the single declared VersionManifest.
     */
    public async loadVersionManifest<T>(modLoaderModule: HeliosModule): Promise<T> {
        const manifestModules = modLoaderModule.subModules.filter(({ rawModule }) => rawModule.type === Type.VersionManifest)
        const versionManifestModule = (modLoaderModule.rawModule.type === Type.NeoForge
            ? manifestModules.find(({ rawModule: { id } }) => id.toLowerCase().includes('neoforge'))
            : undefined)
            ?? manifestModules[0]

        if(versionManifestModule == null) {
            throw new AssetGuardError('No mod loader version manifest module found!')
        }

        return await readJson(versionManifestModule.getPath(), 'utf-8') as T
    }

    // TODO Move this to a util maybe
    public static isForgeGradle3(mcVersion: string, forgeVersion: string): boolean {

        if(mcVersionAtLeast('1.13', mcVersion)) {
            return true
        }

        try {
            
            const forgeVer = forgeVersion.split('-')[1]

            const maxFG2 = [14, 23, 5, 2847]
            const verSplit = forgeVer.split('.').map(v => Number(v))

            for(let i=0; i<maxFG2.length; i++) {
                if(verSplit[i] > maxFG2[i]) {
                    return true
                } else if(verSplit[i] < maxFG2[i]) {
                    return false
                }
            }
        
            return false

        } catch(err) {
            throw new Error('Forge version is complex (changed).. launcher requires a patch.')
        }
    }

}