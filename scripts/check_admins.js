const mongoose = require('mongoose');
const dns = require('dns');
dns.setServers(['8.8.8.8', '1.1.1.1']);
const User = require('../models/User');
const bcrypt = require('bcryptjs');
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

async function resetAdminPassword() {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    const email = 'admin@hospital.com';
    const newPassword = 'Admin@123';
    const hashedPassword = await bcrypt.hash(newPassword, 10);
    
    const result = await User.updateOne({ email }, { password: hashedPassword });
    if (result.matchedCount > 0) {
      console.log(`Password reset for ${email} to: ${newPassword}`);
    } else {
      console.log('Admin not found');
    }
    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}

resetAdminPassword();
