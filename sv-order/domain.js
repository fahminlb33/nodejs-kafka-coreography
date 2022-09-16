const { Db } = require("mongodb");
const { Producer } = require('kafkajs');
const { v4: uuidv4 } = require("uuid");
const logger = require("./logger");

module.exports = class DomainOrder {
    constructor(db, producer) {
        // ini buat type hint aja, ga ngaruh kalau ga dipake juga
        // kalau di TS sih ga perlu soalnya udah dari sananya

        /** @type {Db} */
        this.db = db;
        /** @type {Producer} */
        this.producer = producer;
    }

    async list() {
        const collection = this.db.collection("delivertDetails");
        const result = await collection.find({}).toArray();

        return result;
    }

    async createOrder({ driverId, truckId }) {
        // buat order, tapi belum ready
        // baru ada tapi belum di assign ke driver, belum assign ke truck juga
        // baru "nandain" aja, ini namanya RESERVATION PATTERN
        const collection = this.db.collection("delivertDetails");
        const result = await collection.insertOne({
            deliveryDetailId: uuidv4(),
            deliveryDetailStatus: [{
                code: "1",
                name: "Menunggu konfirmasi",
                timestamp: new Date().toISOString()
            }],
            fulfillment: {
                isTruckAssigned: false,
                isDriverAssigned: false,
                driverId,
                truckId,
            }
        });

        // kirim ke kafka
        const document = await collection.findOne({ _id: result.insertedId });
        logger.info("Order created with ID: " + document.deliveryDetailId);

        await this.producer.send({
            topic: "order-created",
            messages: [{
                // yang dikirim ga perlu selalu full dokumen
                value: JSON.stringify(document),
                // pake key ini buat round-robin partition
                // biar message nya selalu diproses di partition yang sama
                // ini WAJIB buat horizontal scaling message kafka
                key: document.deliveryDetailId,
            }]
        });

        return document;
    }

    async truckAssigned({ deliveryDetailId }) {
        // update status jadi assigned
        // ga perlu validasi apakah truck nya ada apa engga, karena udah divalidasi di service nya truck
        const collection = this.db.collection("delivertDetails");
        await collection.updateOne({deliveryDetailId}, {
            $set: {
                'fulfillment.isTruckAssigned': true,
            }
        });

        logger.info("Truck assigned for order with ID: " + deliveryDetailId);
        await this.checkOrderConfirmation({ deliveryDetailId });
    }

    async driverAssigned({ deliveryDetailId }) {
        // update status jadi assigned
        // ga perlu validasi apakah drivernya nya ada apa engga, karena udah divalidasi di service nya driver
        const collection = this.db.collection("delivertDetails");
        await collection.updateOne({deliveryDetailId}, {
            $set: {
                'fulfillment.isDriverAssigned': true,
            }
        });
        
        logger.info("Driver assigned for order with ID: " + deliveryDetailId);
        await this.checkOrderConfirmation({ deliveryDetailId });
    }

    async checkOrderConfirmation({ deliveryDetailId }) {
        // ini buat cek apakah semua kondisi sudah terpenuhi untuk mulai proses order
        const collection = this.db.collection("delivertDetails");
        const document = await collection.findOne({ deliveryDetailId });

        // belum di assign salah satunya? return
        if (!document.fulfillment.isTruckAssigned && !document.fulfillment.isDriverAssigned) {
            return;
        }

        // tambah status
        await collection.updateOne({deliveryDetailId}, {
            $push: {
                deliveryDetailStatus: {
                    code: "2",
                    name: "Sedang dikirim",
                    timestamp: new Date().toISOString()
                }
            }
        });

        logger.info("Order started for ID: " + deliveryDetailId);

        // publish ke kafka
        const docUpdated = await collection.findOne({ deliveryDetailId });
        await this.producer.send({
            topic: "order-ready",
            messages: [{
                value: JSON.stringify(docUpdated),
                key: document.deliveryDetailId,
            }]
        });
    }

    async driverConflicted({ deliveryDetailId, reason }) {
        // update status jadi conflicted
        const collection = this.db.collection("delivertDetails");
        await collection.updateOne({deliveryDetailId}, {
            $set: {
                'fulfillment.isDriverAssigned': false,
            },
            $push: {
                deliveryDetailStatus: {
                    code: "99",
                    name: reason,
                    timestamp: new Date().toISOString()
                }
            }
        });

        logger.info(`Order with ID: ${deliveryDetailId} is conflicted (driver) because: ${reason}`);
        await this.producer.send({
            topic: "order-cancelled",
            messages: [{
                value: JSON.stringify({ deliveryDetailId }),
                key: document.deliveryDetailId,
            }]
        });
    }

    async truckConflicted({ deliveryDetailId, reason }) {
        // update status jadi conflicted
        const collection = this.db.collection("delivertDetails");
        await collection.updateOne({deliveryDetailId}, {
            $set: {
                'fulfillment.isTruckAssigned': false,
            },
            $push: {
                deliveryDetailStatus: {
                    code: "99",
                    name: reason,
                    timestamp: new Date().toISOString()
                }
            }
        });

        logger.info(`Order with ID: ${deliveryDetailId} is conflicted (truck) because: ${reason}`);

        const document = await collection.findOne({ deliveryDetailId });
        await this.producer.send({
            topic: "order-cancelled",
            messages: [{
                value: JSON.stringify(document),
                key: document.deliveryDetailId,
            }]
        });
    }
}