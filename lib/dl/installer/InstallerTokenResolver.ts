import { join } from 'path'
import { InstallerSideValueMap } from '../../common/distribution/InstallerTypes'
import { MavenUtil } from '../../common/util/MavenUtil'

/**
 * Context handed to the {@link InstallerTokenResolver}. All paths must be
 * absolute. See docs/forge-installer-distribution.md for how the launcher
 * lays these directories out.
 */
export interface InstallerTokenContext {

    /** Minecraft version being patched, resolves {MINECRAFT_VERSION}. */
    mcVersion: string

    /** Path of the vanilla Minecraft client jar, resolves {MINECRAFT_JAR}. */
    minecraftJar: string

    /** The launcher's common directory, resolves {ROOT}. */
    commonDir: string

    /** Directory holding all maven-style libraries, resolves {LIBRARY_DIR}. */
    librariesDir: string

    /** Values of the installer's `data` map, verbatim from install_profile.json. */
    data: Record<string, InstallerSideValueMap>

    /**
     * The installed copies of the files extracted from the installer jar,
     * keyed by their path inside the installer jar (e.g. "data/client.lzma").
     * Used to resolve "/"-prefixed values. Populated from the distribution's
     * installerFileRefs after download validation.
     */
    installerFiles: ReadonlyMap<string, string>

    /** Side being processed, resolves {SIDE}. */
    side: 'client' | 'server'
}

/**
 * Resolves the parameter grammar declared by the Forge/NeoForge installer's
 * install_profile.json. This is a pure function component; units cover the
 * exact shapes observed in real installer profiles (spec 0 and spec 1).
 *
 * Grammar (verified against real installers, see
 * docs/forge-installer-distribution.md):
 *   {TOKEN}          — token. Resolved from the fixed set and the data map.
 *   [maven:coord]    — resolved to a path under {@link InstallerTokenContext.librariesDir}.
 *   'literal'        — used verbatim, quotes stripped.
 *   /path            — resolved through {@link InstallerTokenContext.installerFiles}.
 */
export class InstallerTokenResolver {

    private static readonly LITERAL_REGEX = /^'(.*)'$/
    private static readonly MAVEN_REGEX = /^\[([^[\]]+)\]$/

    constructor(
        private readonly context: InstallerTokenContext
    ) {}

    /**
     * Resolves an install_profile.json `data` value or a processor argument to
     * a path (for file values) or a literal string.
     */
    public resolveValue(value: string): string {
        if(value.startsWith('/')) {
            // An absolute path refers to a file inside the installer jar. The
            // generator extracted these files and the launcher downloaded them;
            // the mapping is provided by the distribution payload.
            const localFile = this.context.installerFiles.get(value.substring(1))
            if(localFile == null) {
                throw new Error(`Installer file '${value}' is neither declared by the distribution's installerFiles nor available locally.`)
            }
            return localFile
        }
        const literal = value.match(InstallerTokenResolver.LITERAL_REGEX)
        if(literal != null) {
            return literal[1]
        }
        const maven = value.match(InstallerTokenResolver.MAVEN_REGEX)
        if(maven != null) {
            return this.mavenCoordinateToPath(maven[1])
        }
        throw new Error(`Unrecognized installer value syntax: '${value}'`)
    }

    /**
     * Resolves every token and grammar element of a processor argument
     * (or outputs key/value) in place, left to right.
     */
    public resolveArg(arg: string): string {
        return arg
            // Tokens, longest first to avoid partial matches.
            .replace(/\{(\w+)\}/g, (_match, token: string) => this.resolveToken(token))
            // Maven coordinates inside arguments (e.g. the SpecialSource and
            // binarypatcher command lines).
            .replace(/\[([^[\]]+)\]/g, (_match, coord: string) => this.mavenCoordinateToPath(coord))
    }

    /**
     * Resolves an outputs declaration pair (`{ key: value }`) into the file
     * whose hash will be verified, and the expected SHA-1.
     */
    public resolveOutputKey(key: string, expectedHash: string): { file: string, expectedSha1: string } {
        return {
            file: this.resolveArg(key),
            expectedSha1: this.resolveArg(expectedHash)
        }
    }

    private resolveToken(token: string): string {
        if(token === 'MINECRAFT_JAR') {
            return this.context.minecraftJar
        }
        if(token === 'MINECRAFT_VERSION') {
            return this.context.mcVersion
        }
        if(token === 'ROOT') {
            return this.context.commonDir
        }
        if(token === 'LIBRARY_DIR') {
            return this.context.librariesDir
        }
        if(token === 'SIDE') {
            return this.context.side
        }
        if(token === 'INSTALLER') {
            // No installer profile observed in the wild uses {INSTALLER} in a
            // client processor. Fail loudly rather than guessing.
            throw new Error('{INSTALLER} is not supported: the installer jar is not downloaded; if a future loader profile requires it, extend InstallerTokenResolver.')
        }
        if(token === 'SECRET' || token === 'SPY') {
            // Reserved tokens declared by the Forge installer spec 1; unused client side.
            throw new Error(`Token {${token}} is not supported client side.`)
        }
        const dataValue = this.context.data[token]
        if(dataValue != null) {
            if(this.context.side === 'client') {
                if(dataValue.client == null) {
                    throw new Error(`Data entry {${token}} has no value for the client side.`)
                }
                return this.resolveValue(dataValue.client)
            }
            if(dataValue.server == null) {
                throw new Error(`Data entry {${token}} has no value for the server side.`)
            }
            return this.resolveValue(dataValue.server)
        }
        throw new Error(`Unknown installer token: {${token}}`)
    }

    private mavenCoordinateToPath(coord: string): string {
        const components = MavenUtil.getMavenComponents(coord)
        return join(
            this.context.librariesDir,
            MavenUtil.mavenComponentsAsPath(
                components.group,
                components.artifact,
                components.version,
                components.classifier,
                components.extension
            )
        )
    }

}
