const config = require('./config');
const logger = require("./logger");

const express = require('express');
const mongodb = require('mongodb');
const kafkajs = require('kafkajs');

const kafkaLogger = require("./logger_kafka");
const AppDomain = require('./domain');

// kafka
const kafka = new kafkajs.Kafka({
    clientId: 'sv-driver',
    brokers: [config.kafka.host],
    ssl: false,
    logCreator: kafkaLogger.WinstonLogCreator
});

// mongodb
const mongoClient = new mongodb.MongoClient(config.mongodb.uri, {
    useNewUrlParser: true,
    useUnifiedTopology: true
});

(async () => {
    // initialize producer/consumer
    const producer = kafka.producer();
    const consumer = kafka.consumer({ groupId: 'sv-driver-group' });

    // create app domain
    const domain = new AppDomain(mongoClient.db("sv-driver"), producer);

    // create express app
    const app = express();

    app.use(express.json());
    app.use(express.urlencoded({ extended: true }));

    app.get("/api/drivers/v1/list", async (req, res) => {
        return res.json(await domain.list());
    });

    // register event handlers
    await consumer.subscribe({ topics: ['order-created', 'order-cancelled'] });
    consumer.run({
        eachMessage: async ({ topic, partition, message }) => {
            // disini bisa juga pasang validator, apakah message yang diterima dari kafka
            // udah sesuai contract api atau belum, karena in essence, kafka juga adalah interface
            // untuk komunikasi antar service, sama aja kaya REST API
            // yang paling proper adalah pake Kafka Schema Registry
            if (topic === 'order-created') {
                await domain.assignDriverForOrder(JSON.parse(message.value));
            } else if (topic === 'order-cancelled') {
                await domain.unassignDriverForOrderCancellation(JSON.parse(message.value));
            } else {
                logger.warn(`Unknown topic: ${topic}`);
            }
        }
    });

    // --- bootstrap app

    // connect to mongo
    await mongoClient.connect();

    // seed data
    await domain.seed();

    // connect to kafka
    consumer.connect();
    producer.connect();

    // start app
    app.listen(config.port, () => {
        logger.info(`Listening on port ${config.port}`);
    });
})().catch(err => {
    logger.error(err);
    process.exit(1);
});
