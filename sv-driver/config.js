module.exports = {
    // web app
    port: 3000,
    logname: "logs/service-driver.log",

    // kafka
    kafka: {
        host: 'kafka_broker:9092',
    },

    // mongodb
    mongodb: {
        uri: 'mongodb://meong:meongmeong@mongodb:27017',
    },

    // elastic
    elastic: {
        apm: {
            server: "http://apm:8200",
        }
    }
}