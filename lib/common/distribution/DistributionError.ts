/**
 * Base error class for distribution-related errors.
 * Preserves the original error context through the cause property.
 */
export class DistributionError extends Error {
    
    /**
     * The original error that caused this distribution error, if any.
     */
    public readonly cause?: Error

    /**
     * HTTP status code if this error resulted from an HTTP request.
     */
    public readonly statusCode?: number

    constructor(message: string, cause?: Error, statusCode?: number) {
        super(message)
        this.name = 'DistributionError'
        this.cause = cause
        this.statusCode = statusCode

        if((Error as any).captureStackTrace) {
            (Error as any).captureStackTrace(this, DistributionError)
        }
    }
}

/**
 * Error thrown when distribution authentication fails with HTTP STATUS CODE 401.
 * Indicates that the authentication token is expired or invalid.
 */
export class UnauthorizedDistributionError extends DistributionError {
    constructor(message: string = 'Authentication token expired or invalid', cause?: Error) {
        super(message, cause, 401)
        this.name = 'UnauthorizedDistributionError'

        if((Error as any).captureStackTrace) {
            (Error as any).captureStackTrace(this, UnauthorizedDistributionError)
        }
    }
}

/**
 * Error thrown when distribution request fails due to network issues.
 * Indicates no response was received from the server (timeout, DNS failure, etc).
 */
export class NetworkDistributionError extends DistributionError {
    constructor(message: string, cause?: Error) {
        super(message, cause)
        this.name = 'NetworkDistributionError'

        if((Error as any).captureStackTrace) {
            (Error as any).captureStackTrace(this, NetworkDistributionError)
        }
    }
}

/**
 * Error thrown when distribution server returns an error status code.
 * Preserves the HTTP status code for launcher decision-making.
 */
export class ServerDistributionError extends DistributionError {
    constructor(message: string, statusCode: number, cause?: Error) {
        super(message, cause, statusCode)
        this.name = 'ServerDistributionError'

        if((Error as any).captureStackTrace) {
            (Error as any).captureStackTrace(this, ServerDistributionError)
        }
    }
}
