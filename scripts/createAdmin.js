const mongoose = require('mongoose'); 
const dns = require('dns');
dns.setServers(['8.8.8.8', '1.1.1.1']);
const bcrypt = require('bcryptjs'); 
const User = require('./models/User'); 
require('dotenv').config(); 

async function run() { 
  await mongoose.connect(process.env.MONGO_URI); 
  const pwd = await bcrypt.hash('Admin@123', 10); 
  await User.create({name: 'Admin Test', email: 'admin@hospital.com', password: pwd, role: 'hospital_admin', status: 'active'}); 
  console.log('Admin created'); 
  process.exit(0); 
} 

run();
