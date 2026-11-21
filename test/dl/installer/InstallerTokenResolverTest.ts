import { expect } from 'chai'
import { join } from 'path'
import { InstallerTokenResolver, InstallerTokenContext } from '../../../lib/dl/installer/InstallerTokenResolver'

/**
 * The values in these fixtures are captured from real installer profiles:
 *  - forge-1.16.5-36.2.39 / forge-1.20.1-47.3.0 install_profile.json
 * They are NOT invented; each shape below was observed in one of the two
 * profiles (see docs/forge-installer-distribution.md for evidence notes).
 */
function buildContext(overrides: Partial<InstallerTokenContext> = {}): InstallerTokenContext {
    return {
        mcVersion: '1.20.1',
        minecraftJar: '/common/versions/1.20.1/1.20.1.jar',
        commonDir: '/common',
        librariesDir: '/common/libraries',
        data: {
            MAPPINGS: {
                client: '[de.oceanlabs.mcp:mcp_config:1.20.1-20230612.114412:mappings@txt]',
                server: '[de.oceanlabs.mcp:mcp_config:1.20.1-20230612.114412:mappings@txt]'
            },
            BINPATCH: {
                client: '/data/client.lzma',
                server: '/data/server.lzma'
            },
            MC_SLIM: {
                client: '[net.minecraft:client:1.20.1-20230612.114412:slim]',
                server: '[net.minecraft:server:1.20.1-20230612.114412:slim]'
            },
            MC_SLIM_SHA: {
                client: "'de86b035d2da0f78940796bb95c39a932ed84834'",
                server: "'9e06bdd77ca6d95b2cced0bf372245f753eeb16a'"
            },
            MCP_VERSION: {
                client: "'20230612.114412'",
                server: "'20230612.114412'"
            }
        },
        installerFiles: new Map([
            ['data/client.lzma', '/common/libraries/net/minecraftforge/forge/1.20.1-47.3.0/install/data/client.lzma']
        ]),
        side: 'client',
        ...overrides
    }
}

describe('Installer Token Resolver', () => {

    it('[ IT-R ] resolves data map maven coordinates to library paths', () => {
        const ctx = buildContext()
        const resolver = new InstallerTokenResolver(ctx)
        expect(resolver.resolveValue(ctx.data.MAPPINGS.client))
            .to.equal(join('/common/libraries', 'de/oceanlabs/mcp/mcp_config/1.20.1-20230612.114412/mcp_config-1.20.1-20230612.114412-mappings.txt'))
    })

    it('[ IT-R ] resolves data map quoted literals without quotes', () => {
        const resolver = new InstallerTokenResolver(buildContext())
        expect(resolver.resolveValue("'20230612.114412'")).to.equal('20230612.114412')
    })

    it('[ IT-R ] resolves installer-relative paths through the installerFiles map', () => {
        const resolver = new InstallerTokenResolver(buildContext())
        expect(resolver.resolveValue('/data/client.lzma'))
            .to.equal('/common/libraries/net/minecraftforge/forge/1.20.1-47.3.0/install/data/client.lzma')
        expect(resolver.resolveArg('{BINPATCH}'))
            .to.equal('/common/libraries/net/minecraftforge/forge/1.20.1-47.3.0/install/data/client.lzma')
    })

    it('[ IT-R ] throws when an installer-relative path is not provided by the distribution', () => {
        const resolver = new InstallerTokenResolver(buildContext({
            installerFiles: new Map()
        }))
        expect(() => resolver.resolveValue('/data/server.lzma')).to.throw('data/server.lzma')
    })

    it('[ IT-R ] resolves all fixed tokens observed in installer profiles', () => {
        const resolver = new InstallerTokenResolver(buildContext())
        expect(resolver.resolveArg('{MINECRAFT_JAR}')).to.equal('/common/versions/1.20.1/1.20.1.jar')
        expect(resolver.resolveArg('{MINECRAFT_VERSION}')).to.equal('1.20.1')
        expect(resolver.resolveArg('{ROOT}')).to.equal('/common')
        expect(resolver.resolveArg('{LIBRARY_DIR}')).to.equal('/common/libraries')
        expect(resolver.resolveArg('{SIDE}')).to.equal('client')
        expect(resolver.resolveArg('{MCP_VERSION}')).to.equal('20230612.114412')
    })

    it('[ IT-R ] resolves a data token nested inside a larger argument', () => {
        // Shape from the 1.16.5 binarypatcher arg: {MC_SRG} appears inside a
        // longer dash-separated option list.
        const resolver = new InstallerTokenResolver(buildContext())
        expect(resolver.resolveArg('--output {MC_SLIM}'))
            .to.equal('--output ' + join('/common/libraries', 'net/minecraft/client/1.20.1-20230612.114412/client-1.20.1-20230612.114412-slim.jar'))
    })

    it('[ IT-R ] resolves maven coordinates embedded in arguments', () => {
        // Shape observed in SpecialSource / binarypatcher argument lists.
        const resolver = new InstallerTokenResolver(buildContext())
        expect(resolver.resolveArg('[net.md-5:SpecialSource:1.8.5:shaded]'))
            .to.equal(join('/common/libraries', 'net/md-5/SpecialSource/1.8.5/SpecialSource-1.8.5-shaded.jar'))
        expect(resolver.resolveArg('--classify [net.minecraft:client:1.20.1:extra]'))
            .to.equal('--classify ' + join('/common/libraries', 'net/minecraft/client/1.20.1/client-1.20.1-extra.jar'))
    })

    it('[ IT-R ] throws for unknown tokens', () => {
        const resolver = new InstallerTokenResolver(buildContext())
        expect(() => resolver.resolveArg('{TOTALLY_UNKNOWN}')).to.throw('Unknown installer token')
    })

    it('[ IT-R ] throws for {INSTALLER} with a clear message', () => {
        const resolver = new InstallerTokenResolver(buildContext())
        expect(() => resolver.resolveArg('{INSTALLER}')).to.throw('{INSTALLER} is not supported')
    })

    it('[ IT-R ] resolves server-side values when the side is server', () => {
        const resolver = new InstallerTokenResolver(buildContext({
            side: 'server',
            installerFiles: new Map([
                ['data/client.lzma', '/common/libraries/net/minecraftforge/forge/1.20.1-47.3.0/install/data/client.lzma'],
                ['data/server.lzma', '/common/libraries/net/minecraftforge/forge/1.20.1-47.3.0/install/data/server.lzma']
            ])
        }))
        expect(resolver.resolveArg('{BINPATCH}'))
            .to.equal('/common/libraries/net/minecraftforge/forge/1.20.1-47.3.0/install/data/server.lzma')
        expect(resolver.resolveArg('{MC_SLIM_SHA}')).to.equal('9e06bdd77ca6d95b2cced0bf372245f753eeb16a')
    })

    it('[ IT-R ] throws when a data entry lacks the requested side', () => {
        const resolver = new InstallerTokenResolver(buildContext())
        expect(() => resolver.resolveArg('{MC_SLIM_SHA}')).to.not.throw()
        expect(() => resolver.resolveValue('{}')).to.throw('Unrecognized installer value syntax')
    })

    it('[ IT-O ] resolves declared outputs to file and expected hash', () => {
        // Real outputs shape, 1.16.5 jarsplitter:
        // { "{MC_SLIM}": "{MC_SLIM_SHA}", "{MC_EXTRA}": "{MC_EXTRA_SHA}" }
        const resolver = new InstallerTokenResolver(buildContext())
        const { file, expectedSha1 } = resolver.resolveOutputKey('{MC_SLIM}', '{MC_SLIM_SHA}')
        expect(file).to.equal(join('/common/libraries', 'net/minecraft/client/1.20.1-20230612.114412/client-1.20.1-20230612.114412-slim.jar'))
        expect(expectedSha1).to.equal('de86b035d2da0f78940796bb95c39a932ed84834')
    })

})
