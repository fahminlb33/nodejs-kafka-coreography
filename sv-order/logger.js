const winston = require('winston');
const apm = require("elastic-apm-node");
const ecsFormat = require('@elastic/ecs-winston-format')

const config = require("./config");

apm.start({
    serverUrl: config.elastic.apm.server
});

module.exports = winston.createLogger({
    level: "debug",
    defaultMeta: { service: 'sv-driver' },
    transports: [
        new winston.transports.Console({
            format: winston.format.prettyPrint({colorize: true})
        }),
        new winston.transports.File({
            filename: config.logname,
            format: ecsFormat()
        })
    ]
});
