import log4js from 'log4js'
import { LoggerService } from 'orbiter-chaincore/src/utils'
// import { LoggerService } from 'orbiter-chaincore/src/utils'
import { logConfig } from '../config'

log4js.configure(logConfig.configure)

const accessLogger = log4js.getLogger('access')
const errorLogger = log4js.getLogger('error')
export { accessLogger, errorLogger }
export function getLoggerService(key: string) {
    const logger = LoggerService.getLogger(`${key}-`, {
        dir: `logs/${key}/`
    });
    // Compatible with previous methods
    return {
        error(message: string, ...args: any) {
            logger.error(`${message} - ${args.join(' ')}`);
            accessLogger.error(message, ...args);
        },
        info(message: string, ...args: any) {
            logger.info(`${message} - ${args.join(' ')}`);
            accessLogger.info(message, ...args);
        }
    };
}