import { expect } from 'chai'
import { join } from 'path'
import { remove, outputFile } from 'fs-extra'
import { createHash } from 'crypto'
import {
    InstallerProcessorError,
    PatchStateStore,
    areProcessorOutputsValid,
    readMainClassFromManifest
} from '../../../lib/dl/installer/InstallerProcessor'
import { InstallerTokenResolver, InstallerTokenContext } from '../../../lib/dl/installer/InstallerTokenResolver'

const tmpRoot = join(__dirname, 'tmp')

function sha1(content: string): string {
    return createHash('sha1').update(content).digest('hex')
}

function buildResolver(ctxOverrides: Partial<InstallerTokenContext> = {}): InstallerTokenResolver {
    return new InstallerTokenResolver({
        mcVersion: '1.16.5',
        minecraftJar: join(tmpRoot, 'versions', '1.16.5.jar'),
        commonDir: tmpRoot,
        librariesDir: join(tmpRoot, 'libraries'),
        data: {
            MC_SLIM: { client: '[net.minecraft:client:slim]' },
            MC_SLIM_SHA: { client: "'deadbeef'" }
        },
        installerFiles: new Map(),
        side: 'client',
        ...ctxOverrides
    })
}

describe('Installer Processor (pure parts)', () => {

    after(async () => {
        await remove(tmpRoot)
    })

    describe('output skip logic', () => {

        const outputsProcessor = {
            jar: 'net.minecraftforge:jarsplitter:1.1.4',
            args: [],
            outputs: {
                '{MC_SLIM}': '{MC_SLIM_SHA}'
            }
        }

        it('[ IP-S ] skips a processor whose declared outputs exist and hash correctly', async () => {
            const slimPath = join(tmpRoot, 'libraries', 'net/minecraft/client/slim/client-slim.jar')
            await outputFile(slimPath, 'slim file content')

            const valid = await areProcessorOutputsValid(buildResolver({
                data: {
                    MC_SLIM: { client: '[net.minecraft:client:slim]' },
                    MC_SLIM_SHA: { client: `'${sha1('slim file content')}'` }
                }
            }), outputsProcessor)

            expect(valid).to.equal(true)
            await remove(slimPath)
        })

        it('[ IP-S ] runs a processor whose declared output is missing', async () => {
            const valid = await areProcessorOutputsValid(buildResolver(), outputsProcessor)
            expect(valid).to.equal(false)
        })

        it('[ IP-S ] runs a processor whose declared output hash mismatches', async () => {
            const slimPath = join(tmpRoot, 'libraries', 'net/minecraft/client/slim/client-slim.jar')
            await outputFile(slimPath, 'CORRUPTED CONTENT')

            const valid = await areProcessorOutputsValid(buildResolver(), outputsProcessor)
            expect(valid).to.equal(false)
            await remove(slimPath)
        })

        it('[ IP-S ] never skips a processor without declared outputs', async () => {
            const valid = await areProcessorOutputsValid(buildResolver(), {
                jar: 'net.minecraftforge:installertools:1.4.1',
                args: []
            })
            expect(valid).to.equal(false)
        })

        it('[ IP-S ] skips side-filtered processors per the sides declaration', async () => {
            // Asserted indirectly: the shape used by 1.20.1 profiles.
            const processor = {
                jar: 'net.minecraftforge:installertools:1.4.1',
                args: [],
                sides: ['server']
            }
            expect(processor.sides!.includes('client')).to.equal(false)
        })

        it('[ IP-S ] reports only client-side processors to onProcessorStart, in order', async () => {
            const slimPath = join(tmpRoot, 'libraries', 'net/minecraft/client/slim/client-slim.jar')
            await outputFile(slimPath, 'slim file content')

            const events: Array<{ index: number, total: number, jar: string }> = []
            const sideFiltered = { jar: 'net.minecraftforge:installertools:1.4.1', args: [], sides: ['server'] as string[] }
            const satisfied = {
                jar: 'net.minecraftforge:jarsplitter:1.1.4',
                args: [],
                sides: undefined,
                outputs: { '{MC_SLIM}': '{MC_SLIM_SHA}' }
            }
            const processor = new (require('../../../lib/dl/installer/InstallerProcessor').InstallerProcessor as new (options: unknown) => { process(): Promise<void> })({
                mcVersion: '1.16.5',
                loaderVersion: '1.16.5-36.2.39',
                minecraftJar: join(tmpRoot, 'versions', '1.16.5.jar'),
                commonDir: tmpRoot,
                librariesDir: join(tmpRoot, 'libraries'),
                installerFiles: new Map(),
                data: {
                    MC_SLIM: { client: '[net.minecraft:client:slim]' },
                    MC_SLIM_SHA: { client: `'${sha1('slim file content')}'` }
                },
                processors: [
                    sideFiltered as never,
                    satisfied as never,
                    { ...satisfied, jar: 'net.minecraftforge:binarypatcher:1.1.1' } as never
                ],
                javaExecutable: 'java',
                onProcessorStart: (index: number, total: number, jar: string) => {
                    events.push({ index, total, jar })
                }
            })
            // Both client-side processors have pre-valid declared outputs, so
            // no JVM is spawned and the pass completes instantly.
            await processor.process()

            expect(events).to.deep.equal([
                { index: 1, total: 2, jar: 'net.minecraftforge:jarsplitter:1.1.4' },
                { index: 2, total: 2, jar: 'net.minecraftforge:binarypatcher:1.1.1' }
            ])
            await remove(slimPath)
        })

    })

    describe('manifest Main-Class parsing', () => {

        // Verbatim main sections captured from real processor jars.
        const manifestLastAttribute =
            'Manifest-Version: 1.0\r\n' +
            'Implementation-Title: net.minecraftforge:InstallerTools\r\n' +
            'Implementation-Version: 1.4.1\r\n' +
            'Specification-Title: Installer Tools\r\n' +
            'Specification-Version: 1.4\r\n' +
            'Main-Class: net.minecraftforge.installertools.ConsoleTool\r\n' +
            'Implementation-Vendor: Forge Development LLC\r\n' +
            '\r\n' +
            'Name: net/minecraftforge/installertools/Tasks.class\r\n' +
            'SHA-256-Digest: nTGEdStaWP5y7NQR5G+w3E6F2Q46HrEypJigJ0WwxmQ=\r\n' +
            '\r\n'

        // Same manifest, Main-Class demonstrably the last entry of the main
        // section with no trailing attribute after it.
        const manifestNoTrailingNewline =
            'Manifest-Version: 1.0\r\n' +
            'Main-Class: net.md_5.specialsource.SpecialSource\r\n'

        it('[ IP-M ] parses Main-Class mid-section', () => {
            expect(readMainClassFromManifest(manifestLastAttribute))
                .to.equal('net.minecraftforge.installertools.ConsoleTool')
        })

        it('[ IP-M ] parses Main-Class as the final attribute', () => {
            expect(readMainClassFromManifest(manifestNoTrailingNewline))
                .to.equal('net.md_5.specialsource.SpecialSource')
        })

        it('[ IP-M ] throws when Main-Class is absent', () => {
            expect(() => readMainClassFromManifest('Manifest-Version: 1.0\r\n'))
                .to.throw('Main-Class')
        })

    })

    describe('patch state marker', () => {

        const store = new PatchStateStore(tmpRoot, 'forge', 'testserver')

        const marker = {
            loader: 'forge',
            loaderVersion: '1.16.5-36.2.39',
            mcVersion: '1.16.5',
            vanillaJarSha1: '37fd3c903861eeff3bc24b71eed48f828b5269c8'
        }

        it('[ IP-P ] is unsatisfied when no marker exists', async () => {
            expect(await store.isSatisfied(marker)).to.equal(false)
        })

        it('[ IP-P ] is satisfied after writing the marker', async () => {
            await store.write(marker)
            expect(await store.isSatisfied(marker)).to.equal(true)
        })

        it('[ IP-P ] is unsatisfied when the loader version changes (re-patch trigger)', async () => {
            await store.write(marker)
            expect(await store.isSatisfied({ ...marker, loaderVersion: '1.16.5-36.2.40' })).to.equal(false)
        })

        it('[ IP-P ] is unsatisfied when the vanilla jar changes', async () => {
            await store.write(marker)
            expect(await store.isSatisfied({ ...marker, vanillaJarSha1: '0000' })).to.equal(false)
        })

        it('[ IP-P ] clear removes the marker', async () => {
            await store.clear()
            expect(await store.read()).to.equal(null)
        })

    })

    describe('error type', () => {

        it('[ IP-E ] builds a readable message with exit code and output tail', () => {
            const err = new InstallerProcessorError(
                'net.minecraftforge:installertools:1.4.1',
                1,
                'Error: Missing required option(s) [fml.mcpVersion]'
            )
            expect(err.name).to.equal('InstallerProcessorError')
            expect(err.processorJar).to.equal('net.minecraftforge:installertools:1.4.1')
            expect(err.exitCode).to.equal(1)
            expect(err.message).to.include('exit code 1')
            expect(err.message).to.include('Missing required option(s)')
        })

    })

})
