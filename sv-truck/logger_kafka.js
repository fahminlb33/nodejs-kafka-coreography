const { logLevel } = require('kafkajs');

const logger = require("./logger");

const toWinstonLogLevel = level => {
    switch(level) {
        case logLevel.ERROR:
        case logLevel.NOTHING:
            return 'error'
        case logLevel.WARN:
            return 'warn'
        case logLevel.INFO:
            return 'info'
        case logLevel.DEBUG:
            return 'debug'
    }
}

module.exports.WinstonLogCreator = logLevel => {
    return ({ namespace, level, label, log }) => {
        const { message, ...extra } = log
        logger.log(toWinstonLogLevel(level), message, extra);
    }
}