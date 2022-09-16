const winston = require('winston');
const apm = require("elastic-apm-node");
const { ElasticsearchTransport } = require('winston-elasticsearch');

const config = require("./config");

const apmInstance = apm.start({
    serverUrl: config.elastic.apm.server
});

module.exports = winston.createLogger({
    level: "debug",
    defaultMeta: { service: 'sv-driver' },
    transports: [
        new winston.transports.Console({
            format: winston.format.prettyPrint({colorize: true})
        }),
        new ElasticsearchTransport({
            level: "debug",
            apm: apmInstance,
            clientOpts: {
                node: config.elastic.elasticsearch.node,
                auth: {
                    username: config.elastic.elasticsearch.username,
                    password: config.elastic.elasticsearch.password
                }
            }
        })
    ]
});
