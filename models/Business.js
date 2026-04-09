import mongoose from 'mongoose';

// Review Model
const reviewSchema = new mongoose.Schema({
    name: String,
    stars: { type: Number, min: 1, max: 5 },
    review_text: String,
    profile_pic: { type: String, default: "https://imgs.search.brave.com/pbruKhRTdtOMZ06961RdlA7ykd9NKAsJilAOtY79yHk/rs:fit:860:0:0:0/g:ce/aHR0cHM6Ly9wbmdm/cmUuY29tL3dwLWNv/bnRlbnQvdXBsb2Fk/cy8xMDAwMTE3OTc1/LTEtMzAweDI3NS5w/bmc" },
    createdAt: { type: Date, default: Date.now }
});

// Contact Model
const contactSchema = new mongoose.Schema({
    fullName: { type: String, required: true },
    email: String,
    phone: { type: String, required: true },
    message: { type: String, required: true },
    messageNumber: Number,
    createdAt: { type: Date, default: Date.now }
});

// Response Model (Chatbot History for AdminJS)
const responseSchema = new mongoose.Schema({
    sessionId: String,
    sender: String,
    message: String,
    meta: { type: mongoose.Schema.Types.Mixed },
    timestamp: { type: Date, default: Date.now }
});

// Security Alert Model
const alertSchema = new mongoose.Schema({
    ip: String,
    userAgent: String,
    pathAttempted: String,
    timestamp: { type: Date, default: Date.now }
});

// Analytics Model
const analyticsSchema = new mongoose.Schema({
    path: String,
    source: { type: String, default: 'direct' },
    timestamp: { type: Date, default: Date.now }
});

// Last Login Model
const lastLoggedInSchema = new mongoose.Schema({
    email: String,
    loginAt: { type: Date, default: Date.now }
});

export const Review       = mongoose.models.Review       || mongoose.model("Review", reviewSchema, "reviews");
export const Contact      = mongoose.models.Contact      || mongoose.model("Contact", contactSchema, "contact");
export const Response     = mongoose.models.Response     || mongoose.model('Response', responseSchema, "responses");
export const Alert        = mongoose.models.Alert        || mongoose.model('Alert', alertSchema);
export const Analytics    = mongoose.models.Analytics    || mongoose.model('Analytics', analyticsSchema);
export const LastLoggedIn = mongoose.models.LastLoggedIn || mongoose.model('LastLoggedIn', lastLoggedInSchema, 'lastloggedin');