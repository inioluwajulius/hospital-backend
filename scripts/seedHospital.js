const mongoose = require('mongoose');
const dns = require('dns');
dns.setServers(['8.8.8.8', '1.1.1.1']);
const bcryptjs = require('bcryptjs');
const User = require('../models/User');
const SuperAdmin = require('../models/SuperAdmin');
const Hospital = require('../models/Hospital');

const MONGO_URI = "mongodb+srv://inijulius37_db_user:LhZOPafkWTkFSGeC@hospital-management-dat.ltx477f.mongodb.net/?retryWrites=true&w=majority";

async function seed() {
  try {
    await mongoose.connect(MONGO_URI);
    console.log('Connected to Production MongoDB');

    // 1. Create Super Admin
    const email = 'admin@medicare.com';
    const password = 'Password123!';
    let user = await User.findOne({ email });

    if (!user) {
      const hashedPassword = await bcryptjs.hash(password, 10);
      user = await User.create({
        name: 'System Admin',
        email,
        password: hashedPassword,
        role: 'super_admin',
        isSuperAdmin: true,
        status: 'active',
      });
      await SuperAdmin.create({ userId: user._id, email, status: 'active' });
      console.log('Created Super Admin');
    }

    // 2. Create Default Hospital
    let hospital = await Hospital.findOne({ slug: 'city-general' });
    if (!hospital) {
      hospital = await Hospital.create({
        name: 'City General Hospital', slug: 'city-general',
        contact: { email: 'contact@citygeneral.com', phone: '+1 555-0198' },
        address: { street: '123 Medical Plaza', city: 'New York', state: 'NY' },
        status: 'active', superAdmin: user._id,
        branding: { primaryColor: '#0ea5e9' }
      });
      console.log('Created Default Hospital');
    }

    console.log('Done!');
    process.exit(0);
  } catch (error) {
    console.error(error);
    process.exit(1);
  }
}

seed();
