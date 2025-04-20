import { createLogger, format, transports, Logger } from 'winston'
import { SPLAT } from 'triple-beam'
import { DateTime } from 'luxon'
import { inspect } from 'util'

export class LoggerUtil {

    public static getLogger(label: string): Logger {
        return createLogger({
            format: format.combine(
                format.label(),
                format.colorize(),
                format.label({ label }),
                format.printf(info => {
                    if(info[SPLAT]) {
                        const splatArgs = info[SPLAT] as unknown[];
                        if(splatArgs.length === 1 && splatArgs[0] instanceof Error) {
                            const err: Error = splatArgs[0];
                            const message = info.message as string;
                            if(message.length > err.message.length && message.endsWith(err.message)) {
                                // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
                                info.message = message.substring(0, message.length-err.message.length)
                            }
                        } else if(splatArgs.length > 0) {
                            // eslint-disable-next-line @typescript-eslint/no-explicit-any
                            info.message = (info.message as string) + ' ' + splatArgs.map((it: any) => {
                                if(typeof it === 'object' && it != null) {
                                    return inspect(it, false, null, true)
                                }
                                // eslint-disable-next-line @typescript-eslint/no-unsafe-return
                                return it
                            }).join(' ')
                        }
                    }
                    return `[${DateTime.local().toFormat('yyyy-MM-dd TT').trim()}] [${info.level}] [${info.label}]: ${info.message}${info.stack ? `\n${info.stack}` : ''}`
                })
            ),
            level: process.env.NODE_ENV === 'test' ? 'emerg' : 'debug',
            transports: [
                new transports.Console()
            ]
        })
    }

}