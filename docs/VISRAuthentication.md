# VI Software Root Account Authentication

VI Software Root (VISR) accounts provide a way to authenticate users and manage their linked Minecraft accounts.

## Usage

```typescript
import { VISRAuthService } from '../visoftware/VISRAuthService';

// Authenticate a user
const response = await VISRAuthService.authenticate({
    username: 'usernameoftherootaccount',
    password: 'password1243'
    // Device info is automatically added
});

if (response.responseStatus === RestResponseStatus.SUCCESS && response.data) {
    // Authentication successful
    const account = response.data;
    
    // Access account properties
    console.log(`Logged in as: ${account.username}`);
    console.log(`Root Token: ${account.rootToken.token}`);
    console.log(`Minecraft accounts: ${account.minecraftAccounts.length}`);
} else {
    // Handle authentication error
    const errorCode = response.visrErrorCode;
    const displayableError = visrErrorDisplayable(errorCode);
    console.error(`${displayableError.title}: ${displayableError.desc}`);
}
```

## Error Handling

The authentication process can result in several error types:

- `ERROR_INVALID_CREDENTIALS`: Wrong username or password
- `ERROR_RATELIMIT`: Too many login attempts
- `ERROR_INVALID_TOKEN`: The access token has expired or is invalid
- `ERROR_NO_MINECRAFT_ACCOUNT`: No Minecraft accounts are linked to this VISR account
- `UNKNOWN`: An unexpected error occurred

## Response Structure

A successful authentication response includes:

```typescript
{
    data: {
        type: AccountType.VISR,
        username: string,
        userId: number,
        email: string,
        setupStage: string,
        isAdmin: boolean,
        supportPin: string,
        rootToken: {
            token: string,
            expires: string,
            refreshed: boolean
        },
        device: {
            uuid: string,
            verified: boolean,
            lastSession: string
        },
        minecraftAccounts: VISRMinecraftAccount[]
    },
    responseStatus: RestResponseStatus.SUCCESS
}
```

## Linked Minecraft Accounts

Each MinecraftProfile in `linkedMinecraftAccounts` contains:
- `id`: The Minecraft account UUID
- `name`: The Minecraft username
