const config = require('./config');
const logger = require("./logger");

const express = require('express');
const mongodb = require('mongodb');
const kafkajs = require('kafkajs');

const kafkaLogger = require("./logger_kafka");
const validator = require("./validator");
const AppDomain = require('./domain');

// kafka
const kafka = new kafkajs.Kafka({
    clientId: 'sv-order',
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
    const consumer = kafka.consumer({ groupId: 'sv-order-group' });

    // create app domain
    const domain = new AppDomain(mongoClient.db("sv-order"), producer);

    // create express app
    const app = express();

    app.use(express.json());
    app.use(express.urlencoded({ extended: true }));

    app.post("/api/orders/v1/create", async (req, res) => {
        const validated = validator.createOrder.validate(req.body);
        if (validated.error) {
            return res.status(400).json(validated.error);
        }
        return res.json(await domain.createOrder(validated.value));
    });
    app.get("/api/orders/v1/list", async (req, res) => {
        return res.json(await domain.list());
    });

    // register event handlers
    await consumer.subscribe({ topics: ['truck-assigned', 'driver-assigned', 'truck-conflicted', 'driver-conflicted'] });
    consumer.run({
        eachMessage: async ({ topic, partition, message }) => {
            // disini bisa juga pasang validator, apakah message yang diterima dari kafka
            // udah sesuai contract api atau belum, karena in essence, kafka juga adalah interface
            // untuk komunikasi antar service, sama aja kaya REST API
            // yang paling proper adalah pake Kafka Schema Registry
            if (topic === 'truck-assigned') {
                await domain.truckAssigned(JSON.parse(message.value));
            } else if (topic === 'driver-assigned') {
                await domain.driverAssigned(JSON.parse(message.value));
            } else if (topic === 'truck-conflicted') {
                await domain.truckConflicted(JSON.parse(message.value));
            } else if (topic === 'driver-conflicted') {
                await domain.driverConflicted(JSON.parse(message.value));
            } else {
                logger.warn(`Unknown topic: ${topic}`);
            }
        }
    });

    // --- bootstrap app

    // connect to mongo
    await mongoClient.connect();

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
