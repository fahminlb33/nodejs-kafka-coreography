const { Db } = require("mongodb");
const { Producer } = require('kafkajs');

const logger = require("./logger");

module.exports = class DomainTruck {
    constructor(db, producer) {
        // ini buat type hint aja, ga ngaruh kalau ga dipake juga
        // kalau di TS sih ga perlu soalnya udah dari sananya

        /** @type {Db} */
        this.db = db;
        /** @type {Producer} */
        this.producer = producer;

        this.seed = this.seed.bind(this);
        this.list = this.list.bind(this);
        this.assignTruckForOrder = this.assignTruckForOrder.bind(this);
        this.unassignTruckForOrderCancellation = this.unassignTruckForOrderCancellation.bind(this);
    }

    async seed() {
        const collection = this.db.collection("trucks");
        await collection.deleteMany({});

        await collection.insertMany([
            {truckId: "bc507a68-30c7-459d-b346-f0c5d6d56895", policeNum: "F 3453 D", isAssigned: false},
            {truckId: "c0b5b0a1-5b9f-4b9f-8b1f-1b0b1b0b1b0b", policeNum: "F 4335 A", isAssigned: false},
        ]);
    }

    async list() {
        const collection = this.db.collection("trucks");
        const result = await collection.find({}).toArray();

        return result;
    }

    async assignTruckForOrder({ deliveryDetailId, fulfillment }) {
        // update status jadi assigned
        // disini proses validasi apakah trucknya ada apa engga, ga perlu tau juga orderan mana
        // concern service ini hanya truck, bukan orderan
        const collection = this.db.collection("trucks");
        const truck = await collection.findOne({ truckId: fulfillment.truckId });
        if (!truck || truck.isAssigned) {
            // kirim ke kafka
            await this.producer.send({
                topic: 'truck-conflicted',
                messages: [{
                    value: JSON.stringify({ deliveryDetailId, reason: "Truck tidak ditemukan atau sudah di assign" }),
                    key: deliveryDetailId,
                }]
            });

            logger.info(`Truck with ID: ${fulfillment.truckId} cannot be assigned because truck is not found or already assigned for order with ID: ${deliveryDetailId}`);
            return;
        }

        // set ke assigned
        await collection.updateOne({ truckId: fulfillment.truckId }, {
            $set: {
                isAssigned: true,
            }
        });

        logger.info(`Truck with ID: ${fulfillment.truckId} assigned to order with ID: ${deliveryDetailId}`);

        // kirim ke kafka
        await this.producer.send({
            topic: 'truck-assigned',
            messages: [{
                value: JSON.stringify({ deliveryDetailId }),
                key: deliveryDetailId,
            }]
        });
    }

    async unassignTruckForOrderCancellation({ deliveryDetailId, fulfillment }) {
        // orderan ini dicancel, kita balikin status assign nya
        const collection = this.db.collection("trucks");

        // set ke unassigned
        await collection.updateOne({ truckId: fulfillment.truckId }, {
            $set: {
                isAssigned: false,
            }
        });

        logger.info(`Truck with ID: ${fulfillment.truckId} released because order with ID: ${deliveryDetailId} is cancelled`);
    }
}