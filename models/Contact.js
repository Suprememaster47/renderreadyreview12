const mongoose = require('mongoose');

const contactSchema = new mongoose.Schema({
  fullName: { type: String, required: true, trim: true },
  email: { type: String, required: false, trim: true, lowercase: true },
  phone: { type: String, required: true },
  message: { type: String, required: true },
  createdAt: { type: Date, default: Date.now }
}, { 
  collection: 'contact' // Forces use of the 'contact' table
});

module.exports = mongoose.model('Contact', contactSchema);