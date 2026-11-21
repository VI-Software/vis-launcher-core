/**
 * Installer payload types and helpers for loader installers that ship
 * processors (ForgeGradle 3-era Forge; NeoForge uses the same installer
 * format).
 *
 * The payload type declarations live in the @visoftware/distribution-types
 * package (lib/spec/installer.ts, since 1.6.0); they are re-exported here
 * together with the runtime helpers below.
 */
import { ForgeInstallerPayload, Module } from '@visoftware/distribution-types'

export {
    InstallerValue,
    InstallerSideValueMap,
    InstallerProcessorDef,
    InstallerFileRef,
    ForgeInstallerPayload
} from '@visoftware/distribution-types'

export module InstallerTypes {

    export function isInstallerModule(module: Module): boolean {
        return module.installer != null
    }

    export function getInstaller(module: Module): ForgeInstallerPayload {
        if (module.installer == null) {
            throw new Error(`Module ${module.name} (${module.id}) does not carry an installer payload!`)
        }
        return module.installer
    }

}
