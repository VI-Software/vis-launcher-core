import { spawn } from 'child_process'
import { delimiter, join } from 'path'
import { calculateHash } from '../../common/util/FileUtils'
import { ensureDir, pathExists, readFile, remove, writeFile } from 'fs-extra'
import StreamZip from 'node-stream-zip'
import { LoggerUtil } from '../../util/LoggerUtil'
import { InstallerProcessorDef, InstallerSideValueMap } from '../../common/distribution/InstallerTypes'
import { InstallerTokenResolver, InstallerTokenContext } from './InstallerTokenResolver'

const log = LoggerUtil.getLogger('InstallerProcessor')

/**
 * Thrown when a processor fails or its declared output does not match the
 * installer's expectations. Carries enough information to make the failure
 * readable in the launcher UI.
 */
export class InstallerProcessorError extends Error {

    public readonly processorJar: string
    public readonly exitCode: number | null
    /** Short, UI-safe description of the failure. */
    public readonly displayable: string

    constructor(processorJar: string, exitCode: number | null, outputTail: string) {
        super(
            `Installer processor ${processorJar} failed` +
            (exitCode != null ? ` with exit code ${exitCode}` : '') +
            (outputTail.length > 0 ? `. Output:\n${outputTail}` : '')
        )
        this.name = 'InstallerProcessorError'
        this.processorJar = processorJar
        this.exitCode = exitCode
        this.displayable =
            `Failed to apply the loader client patches: processor ${processorJar}` +
            (exitCode != null ? ` exited with code ${exitCode}` : '') +
            '. Check the launch log for details.'
    }

}

export interface InstallerProcessorOptions {

    /** Active Minecraft version, resolves {MINECRAFT_VERSION}. */
    mcVersion: string

    /** Version of the loader being installed (only used for logging). */
    loaderVersion: string

    /** Path of the vanilla Minecraft client jar, resolves {MINECRAFT_JAR}. */
    minecraftJar: string

    /** The launcher's common directory, resolves {ROOT}. */
    commonDir: string

    /** Directory holding all maven-style libraries. */
    librariesDir: string

    /**
     * Extracted installer files: path inside the installer jar (e.g.
     * "data/client.lzma") to the validated local file.
     */
    installerFiles: Map<string, string>

    /** Values of the installer's `data` map, verbatim from install_profile.json. */
    data: Record<string, InstallerSideValueMap>

    /** Processors in execution order, verbatim from install_profile.json. */
    processors: InstallerProcessorDef[]

    /** Java executable used to spawn each processor JVM. */
    javaExecutable: string

    /** Receiver for processor stdout/stderr; runs for every emitted line. */
    onOutput?: (line: string, stream: 'stdout' | 'stderr') => void

    /**
     * Progress hook: fires once per client-side processor considered, before
     * it runs or is skipped. `index` is 1-based as the position among the
     * client-side processors, `total` their count, `processorJar` the maven
     * coordinate of the processor jar. Lets the caller surface stage-level
     * progress ("applying patches (2/7 ...)") in the UI.
     */
    onProcessorStart?: (index: number, total: number, processorJar: string) => void
}

/** The number of trailing output lines attached to failure messages. */
const OUTPUT_TAIL_SIZE = 25

/**
 * Runs an installer's client-side processor pass: the loader-agnostic
 * equivalent of what the Forge/NeoForge installer performs on the player's
 * machine. Processors are executed in declared order, each as its own JVM
 * (main class read from the processor jar's manifest), with classpath from
 * the processor's `jar` and `classpath` entries resolved under the launcher's
 * library directory.
 *
 * Skipping:
 *  - Processors with a `sides` filter not including 'client' are skipped.
 *  - Processors whose declared `outputs` all exist and match their declared
 *    SHA-1 are skipped. NOTE: real spec-1 profiles (e.g. MC 1.20.x) declare
 *    no `outputs` on most processors, so output checks alone cannot memoize
 *    the pipeline — the launcher additionally consults a patch state marker,
 *    see {@link PatchStateMarker}.
 *
 * On failure the declared outputs of the failing processor are removed so a
 * half-written artifact can never pass validation on a later launch.
 */
export class InstallerProcessor {

    private static readonly logger = LoggerUtil.getLogger('InstallerProcessor')

    private readonly options: InstallerProcessorOptions
    private readonly tokenResolver: InstallerTokenResolver

    constructor(options: InstallerProcessorOptions) {
        this.options = options
        this.tokenResolver = new InstallerTokenResolver({
            mcVersion: options.mcVersion,
            minecraftJar: options.minecraftJar,
            commonDir: options.commonDir,
            librariesDir: options.librariesDir,
            installerFiles: options.installerFiles,
            data: options.data,
            side: 'client'
        })
    }

    public async process(): Promise<void> {
        log.info(`Applying client patches for ${this.options.loaderVersion}`)
        const clientProcessors = this.options.processors
            .filter(processor => processor.sides == null || processor.sides.includes('client'))
        let clientIndex = 0
        for(let i = 0; i < this.options.processors.length; i++) {
            const processor = this.options.processors[i]
            const processorLabel = `${i + 1}/${this.options.processors.length} ${processor.jar}`
            if(processor.sides != null && !processor.sides.includes('client')) {
                log.info(`Skipping ${processorLabel} (sides: ${processor.sides.join(', ')})`)
                this.emit(`[processors] Skipping ${processor.jar} (client not affected)`)
                continue
            }
            clientIndex++
            this.options.onProcessorStart?.(
                clientIndex, clientProcessors.length, processor.jar
            )
            if(await areProcessorOutputsValid(this.tokenResolver, processor)) {
                log.info(`Skipping ${processorLabel} (outputs already present)`)
                this.emit(`[processors] Skipping ${processor.jar} (output already applied)`)
                continue
            }
            this.emit(`[processors] Running ${processor.jar} (${i + 1}/${this.options.processors.length})`)
            await this.runProcessor(processor)
            this.emit(`[processors] Completed ${processor.jar}`)
        }
        await this.verifyDeclaredOutputs()
        log.info(`Client patches applied for ${this.options.loaderVersion}`)
    }

    private emit(line: string): void {
        this.options.onOutput?.(line, 'stdout')
    }

    /**
     * Whether every declared output of the processor exists and matches its
     * declared SHA-1. Returns true when the processor declares no outputs
     * *and* it is known to be side-filtered; a processor without outputs is
     * never skipped by this check alone.
     */
    private async runProcessor(processor: InstallerProcessorDef): Promise<void> {
        const [javaExecutable, classpath, mainClass, args] = await Promise.all([
            this.options.javaExecutable,
            this.buildClasspath(processor),
            this.readMainClass(processor),
            this.buildArguments(processor)
        ])

        const outputLines: string[] = []
        const collect = (chunk: Buffer, stream: 'stdout' | 'stderr') => {
            for(const line of chunk.toString('utf8').split(/\r?\n/)) {
                if(line.length === 0) continue
                if(outputLines.length >= OUTPUT_TAIL_SIZE) outputLines.shift()
                outputLines.push(line)
                this.options.onOutput?.(line, stream)
            }
        }

        const exitCode = await new Promise<number | null>((resolve, reject) => {
            const child = spawn(javaExecutable, ['-cp', classpath, mainClass, ...args], {
                stdio: ['ignore', 'pipe', 'pipe']
            })
            child.stdout!.on('data', (chunk: Buffer) => collect(chunk, 'stdout'))
            child.stderr!.on('data', (chunk: Buffer) => collect(chunk, 'stderr'))
            child.on('error', reject)
            child.on('close', resolve)
        })

        if(exitCode !== 0) {
            // Remove declared outputs so failing runs never leave half-written
            // artifacts behind.
            if(processor.outputs != null) {
                for(const key of Object.keys(processor.outputs)) {
                    try {
                        await remove(this.tokenResolver.resolveOutputKey(key, processor.outputs[key]).file)
                    } catch(err) {
                        log.warn(`Failed to clean up output ${key}`, err)
                    }
                }
            }
            throw new InstallerProcessorError(processor.jar, exitCode, outputLines.join('\n'))
        }
    }

    private async buildClasspath(processor: InstallerProcessorDef): Promise<string> {
        const entries = [processor.jar, ...(processor.classpath ?? [])]
        const resolved = entries.map(coord => this.tokenResolver.resolveArg(`[${coord}]`))
        for(const entry of resolved) {
            if(!await pathExists(entry)) {
                throw new InstallerProcessorError(processor.jar, null,
                    `Classpath entry not found: ${entry} (from processor ${processor.jar}). Was the processor library downloaded and validated?`)
            }
        }
        return resolved.join(delimiter)
    }

    private async buildArguments(processor: InstallerProcessorDef): Promise<string[]> {
        return processor.args.map(arg => this.tokenResolver.resolveArg(arg))
    }

    /**
     * Reads the `Main-Class` attribute from the processor jar's manifest.
     * Handles manifest line continuations (continuation lines begin with a
     * single space) and does not assume the attribute is followed by another
     * entry — it may be the last attribute of the main section.
     */
    private async readMainClass(processor: InstallerProcessorDef): Promise<string> {
        const processorJar = this.tokenResolver.resolveArg(`[${processor.jar}]`)
        const zip = new StreamZip.async({ file: processorJar })
        try {
            const manifest = await zip.entryData('META-INF/MANIFEST.MF')
            return readMainClassFromManifest(manifest.toString('utf8'))
        } finally {
            await zip.close()
        }
    }

    /**
     * The processor outputs that the installer dataset declares, verified
     * once after the pass finishes.
     */
    private async verifyDeclaredOutputs(): Promise<void> {
        // The `*_SHA` data entries pair with their sibling `*` entries. Every
        // such pair is re-verified so that a corrupt or half-written artifact
        // fails the launch before the game starts.
        for(const key of Object.keys(this.options.data)) {
            if(!key.endsWith('_SHA')) continue
            const valueKey = key.substring(0, key.length - 4)
            const value = this.options.data[valueKey]
            if(value == null) continue
            const expectedSha1 = this.tokenResolver.resolveValue(this.options.data[key].client)
            const file = this.tokenResolver.resolveValue(value.client)
            const actualSha1 = await calculateHash(file, 'sha1')
            if(actualSha1 !== expectedSha1) {
                await remove(file)
                throw new InstallerProcessorError(file, null,
                    `Output ${file} hash mismatch: expected ${expectedSha1}, got ${actualSha1}. The file was removed and will be recreated on the next attempt.`)
            }
            log.info(`Verified output ${file} (${expectedSha1})`)
        }
    }

}

/**
 * Whether a processor's declared outputs all exist and match their declared
 * SHA-1 — the per-processor memoization rule. A processor whose outputs
 * declaration is empty is never considered satisfied by this check (real
 * spec-1 profiles declare outputs on only some client processors; the whole
 * pipeline short-circuit is done by {@link PatchStateStore}).
 */
export async function areProcessorOutputsValid(
    tokenResolver: InstallerTokenResolver,
    processor: InstallerProcessorDef
): Promise<boolean> {
    if(processor.outputs == null || Object.keys(processor.outputs).length === 0) {
        return false
    }
    for(const key of Object.keys(processor.outputs)) {
        const { file, expectedSha1 } = tokenResolver.resolveOutputKey(key, processor.outputs[key])
        if(!await pathExists(file)) {
            return false
        }
        const sha1 = await calculateHash(file, 'sha1')
        if(sha1 !== expectedSha1) {
            log.warn(`Declared output ${file} exists but its hash (${sha1}) does not match ${expectedSha1}.`)
            return false
        }
    }
    return true
}

/**
 * Reads the Main-Class attribute from a jar manifest string. Handles both
 * attribute-as-last-entry and multi-line continuation values.
 */
export function readMainClassFromManifest(manifest: string): string {
    const attributes: Record<string, string> = {}
    let currentAttribute: string | null = null
    for(const line of manifest.split(/\r?\n/)) {
        if(line.startsWith(' ')) {
            // Continuation line, appended to the previous attribute's value.
            if(currentAttribute != null) {
                attributes[currentAttribute] += line.substring(1)
            }
            continue
        }
        const separator = line.indexOf(': ')
        if(separator === -1) {
            currentAttribute = null
            continue
        }
        currentAttribute = line.substring(0, separator)
        if(attributes[currentAttribute] == null) {
            attributes[currentAttribute] = line.substring(separator + 2)
        }
    }
    if(attributes['Main-Class'] == null) {
        throw new Error('Processor jar manifest does not declare a Main-Class attribute!')
    }
    return attributes['Main-Class'].trim()
}

/**
 * Persisted decision state for the patcher. Real spec-1 installer profiles
 * declare `outputs` on too few processors to short-circuit the whole pass, so
 * the launcher also records which loader version it previously applied and to
 * which vanilla jar. Whenever the marker below does not match the launch's
 * current state (loader version changed, Minecraft version changed, or the
 * vanilla jar was redownloaded), the full processor pass runs again.
 */
export interface PatchStateMarker {
    loader: string
    loaderVersion: string
    mcVersion: string
    /** SHA-1 of the vanilla client jar the patches were built against. */
    vanillaJarSha1: string
}

export class PatchStateStore {

    private static readonly FILE = 'patchstate.json'

    constructor(
        private readonly commonDir: string,
        private readonly loader: string,
        private readonly serverId: string
    ) {}

    private get directory(): string {
        return join(this.commonDir, 'installer-cache', this.loader, this.serverId)
    }

    private get filePath(): string {
        return join(this.directory, PatchStateStore.FILE)
    }

    public async read(): Promise<PatchStateMarker | null> {
        try {
            if(!await pathExists(this.filePath)) {
                return null
            }
            return JSON.parse(await readFile(this.filePath, 'utf8')) as PatchStateMarker
        } catch(err) {
            log.warn('Failed to read patch state marker, treating as absent.', err)
            return null
        }
    }

    /**
     * Whether the marker exists and still equals the expected current state.
     */
    public async isSatisfied(marker: PatchStateMarker): Promise<boolean> {
        const existing = await this.read()
        if(existing == null) {
            return false
        }
        return existing.loader === marker.loader
            && existing.loaderVersion === marker.loaderVersion
            && existing.mcVersion === marker.mcVersion
            && existing.vanillaJarSha1 === marker.vanillaJarSha1
    }

    public async write(marker: PatchStateMarker): Promise<void> {
        await ensureDir(this.directory)
        await writeFile(this.filePath, JSON.stringify(marker, null, 4), 'utf8')
    }

    public async clear(): Promise<void> {
        await remove(this.filePath)
    }

}
