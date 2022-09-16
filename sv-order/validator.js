const joi = require("joi");

module.exports.createOrder = joi.object({
    driverId: joi.string().required(),
    truckId: joi.string().required(),
});
