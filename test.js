const mongoose = require('mongoose');
const dns = require('dns');
dns.setServers(['8.8.8.8', '1.1.1.1']);
const Hospital = require('./models/Hospital');

require("dotenv").config({ path: require("path").join(__dirname, ".env") });
const MONGO_URI = process.env.MONGO_URI;

async function test() {
  try {
    await mongoose.connect(MONGO_URI);
    console.log('Connected to DB');
    const hospitals = await Hospital.find({ status: 'active' }).select('name slug _id branding.primaryColor');
    console.log('Hospitals found:', hospitals);
    process.exit(0);
  } catch (error) {
    console.error(error);
    process.exit(1);
  }
}
test();
