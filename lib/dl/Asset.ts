export interface Asset {
    id: string
    url: string
    path: string
    hash: string
    algo: string
    size: number
    headers?: Record<string, string>  // Add optional headers property
}

export enum HashAlgo {
    SHA1 = 'sha1',
    SHA256 = 'sha256',
    MD5 = 'md5'
}