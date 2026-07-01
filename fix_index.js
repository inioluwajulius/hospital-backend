const mongoose = require('mongoose');
require('dotenv').config();

async function fixIndex() {
    try {
        await mongoose.connect(process.env.MONGO_URI);
        console.log('Connected to MongoDB');
        
        try {
            await mongoose.connection.collection('users').dropIndex('email_1');
            console.log('Successfully dropped old email_1 index!');
        } catch (err) {
            console.log('Index email_1 not found or already dropped:', err.message);
        }
        
        // Also drop patient card number if it exists and causes issues, wait no, patientCardNumber needs to be unique per hospital maybe? 
        // No, patientCardNumber is globally unique according to schema.

        // Also ensure new indexes are built
        const User = require('./models/User');
        await User.syncIndexes();
        console.log('Successfully synced all new indexes!');

        process.exit(0);
    } catch (err) {
        console.error('Error:', err);
        process.exit(1);
    }
}

fixIndex();
