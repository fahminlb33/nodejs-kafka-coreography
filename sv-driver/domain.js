const { Db } = require("mongodb");
const { Producer } = require('kafkajs');

const logger = require("./logger");

module.exports = class DomainDriver {
    constructor(db, producer) {
        // ini buat type hint aja, ga ngaruh kalau ga dipake juga
        // kalau di TS sih ga perlu soalnya udah dari sananya

        /** @type {Db} */
        this.db = db;
        /** @type {Producer} */
        this.producer = producer;

        this.seed = this.seed.bind(this);
        this.list = this.list.bind(this);
        this.assignDriverForOrder = this.assignDriverForOrder.bind(this);
        this.unassignDriverForOrderCancellation = this.unassignDriverForOrderCancellation.bind(this);
    }

    async seed() {
        const collection = this.db.collection("drivers");
        await collection.deleteMany({});

        await collection.insertMany([
            {driverId: "bd2af306-f7cc-4aee-bcaf-7c7a4e9a0a4e", name: "Meong 1", isAssigned: false},
            {driverId: "6a113d66-deca-4ce8-aa9e-9eb7865322c0", name: "Meong 2", isAssigned: false},
        ]);
    }

    async list() {
        const collection = this.db.collection("drivers");
        const result = await collection.find({}).toArray();

        return result;
    }

    async assignDriverForOrder({ deliveryDetailId, fulfillment }) {
        // update status jadi assigned
        // disini proses validasi apakah trucknya ada apa engga, ga perlu tau juga orderan mana
        // concern service ini hanya truck, bukan orderan
        const collection = this.db.collection("drivers");
        const driver = await collection.findOne({ driverId: fulfillment.driverId });
        if (!driver || driver.isAssigned) {
            // kirim ke kafka
            await this.producer.send({
                topic: 'driver-conflicted',
                messages: [{
                    value: JSON.stringify({ deliveryDetailId, reason: "Driver tidak ditemukan atau sudah di assign" }),
                    key: deliveryDetailId,
                }]
            });

            logger.info(`Driver with ID: ${fulfillment.driverId} cannot be assigned because driver is not found or already assigned for order with ID: ${deliveryDetailId}`);
            return;
        }

        // set ke assigned
        await collection.updateOne({ driverId: fulfillment.driverId }, {
            $set: {
                isAssigned: true,
            }
        });

        logger.info(`Driver with ID: ${fulfillment.driverId} assigned to order with ID: ${deliveryDetailId}`);

        // kirim ke kafka
        await this.producer.send({
            topic: 'driver-assigned',
            messages: [{
                value: JSON.stringify({ deliveryDetailId }),
                key: deliveryDetailId,
            }]
        });
    }

    async unassignDriverForOrderCancellation({ deliveryDetailId, fulfillment }) {
        // orderan ini dicancel, kita balikin status assign nya
        const collection = this.db.collection("drivers");

        // set ke unassigned
        await collection.updateOne({ driverId: fulfillment.driverId }, {
            $set: {
                isAssigned: false,
            }
        });

        logger.info(`Driver with ID: ${fulfillment.driverId} released because order with ID: ${deliveryDetailId} is cancelled`);
    }
}