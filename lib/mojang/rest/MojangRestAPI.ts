import { LoggerUtil } from '../../util/LoggerUtil'
import got, { RequestError, HTTPError } from 'got'
import { MojangResponse, MojangErrorCode, decipherErrorCode, isInternalError, MojangErrorBody } from './MojangResponse'
import { RestResponseStatus, handleGotError } from '../../common/rest/RestResponse'
import * as os from 'os'
import { machineIdSync } from 'node-machine-id'

export interface Agent {
    name: 'VI Software Launcher Core'
    version: number
}

export interface AuthPayload {
    agent: Agent
    username: string
    password: string
    clientToken?: string
    requestUser?: boolean
}

export interface Session {
    accessToken: string
    clientToken: string
    selectedProfile: {
        id: string
        name: string
    }
    user?: {
        id: string
        properties: {
            name: string
            value: string
        }[]
    }
}

export enum MojangStatusColor {
    RED = 'red',
    YELLOW = 'yellow',
    GREEN = 'green',
    GREY = 'grey'
}

export interface MojangStatus {

    service: string
    status: MojangStatusColor
    name: string
    essential: boolean

}

export interface UpptimeSummary {
    slug: string
    status: 'up' | 'down'
}

export class MojangRestAPI {

    private static readonly logger = LoggerUtil.getLogger('Mojang')

    private static readonly TIMEOUT = 2500

    public static readonly AUTH_ENDPOINT = 'https://authserver.visoftware.dev/'
    public static readonly API_ENDPOINT = 'https://api.visoftware.dev/'
    public static readonly STATUS_ENDPOINT = 'https://raw.githubusercontent.com/VI-Software/status/master/history/summary.json'

    private static authClient = got.extend({
        prefixUrl: MojangRestAPI.AUTH_ENDPOINT,
        responseType: 'json',
        retry: 0
    })
    private static apiClient = got.extend({
        prefixUrl: MojangRestAPI.API_ENDPOINT,
        responseType: 'json',
        retry: 0
    })    
    private static statusClient = got.extend({
        url: MojangRestAPI.STATUS_ENDPOINT,
        responseType: 'json',
        retry: 0
    })

    public static readonly MINECRAFT_AGENT: Agent = {
        name: 'VI Software Launcher Core',
        version: 1
    }

    protected static statuses: MojangStatus[] = MojangRestAPI.getDefaultStatuses()

    public static getDefaultStatuses(): MojangStatus[] {
        return [
            {
                service: 'vi-software-api',
                status: MojangStatusColor.GREY,
                name: 'VI Software API',
                essential: true
            },
            {
                service: 'vi-software-yggdrasil-auth-server',
                status: MojangStatusColor.GREY,
                name: 'VI Software Yggdrasil Auth Server',
                essential: true
            },
            {
                service: 'vi-software-cdn',
                status: MojangStatusColor.GREY,
                name: 'VI Software CDN',
                essential: true
            },
            {
                service: 'vi-software-portal',
                status: MojangStatusColor.GREY,
                name: 'VI Software Portal',
                essential: true
            },
            {
                service: 'user-content-server-otto',
                status: MojangStatusColor.GREY,
                name: 'User Content Server (Otto)',
                essential: false
            },                     
            {
                service: 'vi-software-skin-rendering-service',
                status: MojangStatusColor.GREY,
                name: 'VI Software Skin Rendering Service',
                essential: false
            },
            {
                service: 'vi-software-docs',
                status: MojangStatusColor.GREY,
                name: 'VI Software Docs',
                essential: false
            }
        ]
    }

    /**
     * Converts a Mojang status color to a hex value. Valid statuses
     * are 'green', 'yellow', 'red', and 'grey'. Grey is a custom status
     * to our project which represents an unknown status.
     */
    public static statusToHex(status: string): string {
        switch(status.toLowerCase()){
            case MojangStatusColor.GREEN:
                return '#a5c325'
            case MojangStatusColor.YELLOW:
                return '#eac918'
            case MojangStatusColor.RED:
                return '#c32625'
            case MojangStatusColor.GREY:
            default:
                return '#848484'
        }
    }

    /**
     * MojangRestAPI implementation of handleGotError. This function will additionally
     * analyze the response from Mojang and populate the mojang-specific error information.
     * 
     * @param operation The operation name, for logging purposes.
     * @param error The error that occurred.
     * @param dataProvider A function to provide a response body.
     * @returns A MojangResponse configured with error information.
     */
    private static handleGotError<T>(operation: string, error: RequestError, dataProvider: () => T): MojangResponse<T> {

        const response: MojangResponse<T> = handleGotError(operation, error, MojangRestAPI.logger, dataProvider)

        if(error instanceof HTTPError) {
            response.mojangErrorCode = decipherErrorCode(error.response.body as MojangErrorBody)
        } else if(error.name === 'RequestError' && error.code === 'ENOTFOUND') {
            response.mojangErrorCode = MojangErrorCode.ERROR_UNREACHABLE
        } else {
            response.mojangErrorCode = MojangErrorCode.UNKNOWN
        }
        response.isInternalError = isInternalError(response.mojangErrorCode)
    
        return response
    }

    /**
     * Utility function to report an unexpected success code. An unexpected
     * code may indicate an API change.
     * 
     * @param operation The operation name.
     * @param expected The expected response code.
     * @param actual The actual response code.
     */
    private static expectSpecificSuccess(operation: string, expected: number, actual: number): void {
        if(actual !== expected) {
            MojangRestAPI.logger.warn(`${operation} expected ${expected} response, received ${actual}.`)
        }
    }

    /**
     * Retrieves the status of Mojang's services.
     * The response is condensed into a single object. Each service is
     * a key, where the value is an object containing a status and name
     * property.
     * 
     * Currently uses an in house daily ping. A daily ping is not super useful,
     * so this may be refactored at a later date. The feature was originally
     * built on Mojang's status API which has since been removed.
     * 
     * @see https://wiki.vg/Mojang_API#API_Status_.28Removed.29
     */
    public static async status(): Promise<MojangResponse<MojangStatus[]>>{
        try {

            const res = await MojangRestAPI.statusClient.get<UpptimeSummary[]>({})

            MojangRestAPI.expectSpecificSuccess('Mojang Status', 200, res.statusCode)

            for(const status of res.body) {
                for(const mojStatus of MojangRestAPI.statuses) {
                    if(mojStatus.service === status.slug) {
                        mojStatus.status = status.status === 'up' ? MojangStatusColor.GREEN : MojangStatusColor.RED
                        break
                    }
                }
            }
            
            return {
                data: MojangRestAPI.statuses,
                responseStatus: RestResponseStatus.SUCCESS
            }

        } catch(error) {

            return MojangRestAPI.handleGotError('Mojang Status', error as RequestError, () => {
                for(const status of MojangRestAPI.statuses){
                    status.status = MojangStatusColor.GREY
                }
                return MojangRestAPI.statuses
            })
        }
        
    }

    
    /**
         * Authenticate a user with their Mojang credentials.
         * 
         * @param {string} username The user's username, this is often an email.
         * @param {string} password The user's password.
         * @param {string} clientToken The launcher's Client Token.
         * @param {boolean} requestUser Optional. Adds user object to the response.
         * @param {Object} agent Optional. Provided by default. Adds user info to the response.
         * 
         * @see http://wiki.vg/Authentication#Authenticate
    */
    public static async authenticate(
        username: string,
        password: string,
        clientToken: string | null,
        requestUser = true,
        agent: Agent = MojangRestAPI.MINECRAFT_AGENT
    ): Promise<MojangResponse<Session | null>> {
        try {
            // Device information as a JSON string
            const deviceInfo = JSON.stringify({
                name: os.hostname(),
                platform: os.platform(),
                type: os.type(),
                release: os.release(),
                cpu: os.cpus()[0].model,
                ram: os.totalmem(),
                uuid: machineIdSync(),
                arch: os.arch()
            })
    
            const json: AuthPayload = {
                agent,
                username,
                password,
                requestUser
            }

            if (clientToken != null) {
                json.clientToken = clientToken
            }
    
            const res = await MojangRestAPI.authClient.post<Session>('authenticate', {
                json,
                headers: {
                    'Device-Info': deviceInfo
                },
                responseType: 'json'
            })
            MojangRestAPI.expectSpecificSuccess('Mojang Authenticate', 200, res.statusCode)
            
            return {
                data: res.body,
                responseStatus: RestResponseStatus.SUCCESS
            }
    
        } catch (err) {
            return MojangRestAPI.handleGotError('Mojang Authenticate', err as RequestError, () => null)
        }
    }

    /**
     * Validate an access token. This should always be done before launching.
     * The client token should match the one used to create the access token.
     * 
     * @param {string} accessToken The access token to validate.
     * @param {string} clientToken The launcher's client token.
     * 
     * @see http://wiki.vg/Authentication#Validate
     */
    public static async validate(accessToken: string, clientToken: string): Promise<MojangResponse<boolean>> {

        try {

            const json = {
                accessToken,
                clientToken
            }

            const res = await MojangRestAPI.authClient.post('validate', { json })
            MojangRestAPI.expectSpecificSuccess('Mojang Validate', 204, res.statusCode)

            return {
                data: res.statusCode === 204,
                responseStatus: RestResponseStatus.SUCCESS
            }

        } catch(err) {
            if(err instanceof HTTPError && err.response.statusCode === 403) {
                return {
                    data: false,
                    responseStatus: RestResponseStatus.SUCCESS
                }
            }
            return MojangRestAPI.handleGotError('Mojang Validate', err as RequestError, () => false)
        }

    }

    /**
     * Invalidates an access token. The clientToken must match the
     * token used to create the provided accessToken.
     * 
     * @param {string} accessToken The access token to invalidate.
     * @param {string} clientToken The launcher's client token.
     * 
     * @see http://wiki.vg/Authentication#Invalidate
     */
    public static async invalidate(accessToken: string, clientToken: string): Promise<MojangResponse<undefined>> {

        try {

            const json = {
                accessToken,
                clientToken
            }

            const res = await MojangRestAPI.authClient.post('invalidate', { json })
            MojangRestAPI.expectSpecificSuccess('Mojang Invalidate', 204, res.statusCode)

            return {
                data: undefined,
                responseStatus: RestResponseStatus.SUCCESS
            }

        } catch(err) {
            return MojangRestAPI.handleGotError('Mojang Invalidate', err as RequestError, () => undefined)
        }

    }

    /**
     * Refresh a user's authentication. This should be used to keep a user logged
     * in without asking them for their credentials again. A new access token will
     * be generated using a recent invalid access token. See Wiki for more info.
     * 
     * @param {string} accessToken The old access token.
     * @param {string} clientToken The launcher's client token.
     * @param {boolean} requestUser Optional. Adds user object to the reponse.
     * 
     * @see http://wiki.vg/Authentication#Refresh
     */
    public static async refresh(accessToken: string, clientToken: string, requestUser = true): Promise<MojangResponse<Session | null>> {

        try {

            const json = {
                accessToken,
                clientToken,
                requestUser
            }

            const res = await MojangRestAPI.authClient.post<Session>('refresh', { json, responseType: 'json' })
            MojangRestAPI.expectSpecificSuccess('Mojang Refresh', 200, res.statusCode)

            return {
                data: res.body,
                responseStatus: RestResponseStatus.SUCCESS
            }

        } catch(err) {
            return MojangRestAPI.handleGotError('Mojang Refresh', err as RequestError, () => null)
        }

    }

}
