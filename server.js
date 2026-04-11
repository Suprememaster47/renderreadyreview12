/**
 * ---------------------------------------------------------------------
 * MERGED SERVER.JS - PRODUCTION STABILIZED
 * ---------------------------------------------------------------------
 */
import 'dotenv/config';
import path from "path";
import fs from "fs";
import express from "express";
import compression from "compression";
import session from "express-session";
import errorHandler from "errorhandler";
import lusca from "lusca";
import MongoStore from "connect-mongo";
import mongoose from "mongoose";
import passport from "passport";
import rateLimit from "express-rate-limit";
import axios from "axios";
import { WebSocketServer } from "ws";
import { MongoClient } from "mongodb";
import { fileURLToPath } from "url";
import { createRequire } from "module";
import mongoSanitize from "express-mongo-sanitize";

// -- AdminJS imports
import { AdminJS, ComponentLoader } from 'adminjs';
import AdminJSExpress from '@adminjs/express';
import * as AdminJSMongoose from '@adminjs/mongoose';

AdminJS.registerAdapter(AdminJSMongoose.default || AdminJSMongoose);

const require = createRequire(import.meta.url);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const componentLoader = new ComponentLoader();
const Components = {
    // Ensure the path is absolute and uses the correct component name
    Dashboard: componentLoader.add('Dashboard', path.join(__dirname, './components/Dashboard.jsx')),
};

const ADMIN_PATH = `/${(process.env.ADMIN_PATH || 'electric-puffin-vault-12').trim().replace(/^\//, '')}`;
const IS_PRODUCTION = process.env.NODE_ENV === 'production';
const secureTransfer = IS_PRODUCTION || process.env.BASE_URL?.startsWith("https") || false;

/** --------------------------
 * MONGOOSE MODELS
 * -------------------------- */
const Review = mongoose.models.Review || mongoose.model("Review", new mongoose.Schema({
    name: String, stars: { type: Number, min: 1, max: 5 }, review_text: String,
    profile_pic: { type: String, default: "https://imgs.search.brave.com/pbruKhRTdtOMZ06961RdlA7ykd9NKAsJilAOtY79yHk/rs:fit:860:0:0:0/g:ce/aHR0cHM6Ly9wbmdm/cmUuY29tL3dwLWNv/bnRlbnQvdXBsb2Fk/cy8xMDAwMTE3OTc1/LTEtMzAweDI3NS5w/bmc" },
    createdAt: { type: Date, default: Date.now }
}), "reviews");

const Contact = mongoose.models.Contact || mongoose.model("Contact", new mongoose.Schema({
    fullName: { type: String, required: true }, email: { type: String, required: false },
    phone: { type: String, required: true }, message: { type: String, required: true },
    messageNumber: { type: Number }, createdAt: { type: Date, default: Date.now }
}), "contact");

const Response = mongoose.models.Response || mongoose.model('Response', new mongoose.Schema({
    sessionId: String, sender: String, message: String, meta: { type: mongoose.Schema.Types.Mixed }, timestamp: { type: Date, default: Date.now }
}));

const Alert = mongoose.models.Alert || mongoose.model('Alert', new mongoose.Schema({
    ip: String, userAgent: String, pathAttempted: String, timestamp: { type: Date, default: Date.now }
}));

const Analytics = mongoose.models.Analytics || mongoose.model('Analytics', new mongoose.Schema({
    path: { type: String }, source: { type: String, default: 'direct' }, timestamp: { type: Date, default: Date.now },
}));

const LastLoggedIn = mongoose.models.LastLoggedIn || mongoose.model('LastLoggedIn', new mongoose.Schema({
    email: String, loginAt: { type: Date, default: Date.now },
}), 'lastloggedin');

/** --------------------------
 * EXPRESS APP SETUP
 * -------------------------- */
const app = express();
app.set("host", "0.0.0.0");
app.set("port", process.env.PORT || 8080);
app.set("views", path.join(__dirname, "views"));
app.set("view engine", "pug");
app.set("trust proxy", 1);

app.use(compression());
app.disable("x-powered-by");

/** --------------------------
 * ADMINJS LOGIC
 * -------------------------- */
async function buildAndMountAdminJS() {
    const SESSION_SECRET = (process.env.SESSION_SECRET || 'hydro-sweep-admin-secret-32-chars').trim();
    const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || '').trim();
    const ADMIN_PASS = (process.env.ADMIN_PASSWORD || '').trim();

    const admin = new AdminJS({
        resources: [Review, Response, Contact, Alert, Analytics, LastLoggedIn],
        rootPath: ADMIN_PATH,
        loginPath: `${ADMIN_PATH}/login`,
        logoutPath: `${ADMIN_PATH}/logout`,
        componentLoader,
        branding: { companyName: 'Hydro Sweep Services', withMadeWithLove: false },
        dashboard: {
            component: Components.Dashboard,
            handler: async () => {
                // ... same analytics logic as before ...
                const [viewsToday, leadsCount, lastLogin] = await Promise.all([
                    Analytics.countDocuments({ timestamp: { $gte: new Date(new Date().setHours(0,0,0,0)) } }),
                    Contact.countDocuments(),
                    LastLoggedIn.findOne().sort({ loginAt: -1 }).lean(),
                ]);
                return { viewsToday, leadsCount, lastLogin: lastLogin?.loginAt || null };
            }
        },
    });

    // 1. Initialize First
    await admin.initialize();
    console.log('✅ AdminJS bundle compiled');

    // 2. FORCE Static serving for the .adminjs bundle BEFORE the router
    const bundlePath = path.join(process.cwd(), '.adminjs');
    app.use(`${ADMIN_PATH}/frontend/assets`, express.static(bundlePath, {
        setHeaders: (res, filePath) => {
            if (filePath.endsWith('.js')) res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
            if (filePath.endsWith('.css')) res.setHeader('Content-Type', 'text/css; charset=utf-8');
        }
    }));

    const adminRouter = AdminJSExpress.buildAuthenticatedRouter(admin, {
        authenticate: async (email, password) => {
            if (email === ADMIN_EMAIL && password === ADMIN_PASS) {
                await LastLoggedIn.findOneAndUpdate({}, { email, loginAt: new Date() }, { upsert: true });
                return { email };
            }
            return null;
        },
        cookieName: 'adminjs-session',
        cookiePassword: SESSION_SECRET.padEnd(32, '0').substring(0, 32),
    }, null, {
        resave: false,
        saveUninitialized: true,
        secret: SESSION_SECRET,
        name: 'adminjs-sid',
        cookie: {
            httpOnly: true,
            sameSite: secureTransfer ? 'none' : 'lax',
            secure: secureTransfer,
            maxAge: 86400000,
        },
        store: MongoStore.create({ mongoUrl: process.env.MONGODB_URI }),
    });

    app.use(ADMIN_PATH, adminRouter);
    console.log(`✅ AdminJS mounted at ${ADMIN_PATH}`);
}

/** --------------------------
 * START SERVER
 * -------------------------- */
async function startServer() {
    await mongoose.connect(process.env.MONGODB_URI);
    
    // MOUNT ADMIN FIRST so its internal static assets and routes are registered before the "Trap" middleware
    await buildAndMountAdminJS();

    // BODY PARSERS (Skip Admin)
    app.use((req, res, next) => {
        if (req.originalUrl.startsWith(ADMIN_PATH)) return next();
        express.json()(req, res, (err) => {
            if (err) return next(err);
            express.urlencoded({ extended: true })(req, res, next);
        });
    });

    // SESSIONS & SECURITY (Skip Admin)
    app.use((req, res, next) => {
        if (req.originalUrl.startsWith(ADMIN_PATH)) return next();
        // Session, Passport, Lusca, etc.
        session({
            resave: true,
            saveUninitialized: false,
            secret: process.env.SESSION_SECRET || 'dev-secret',
            cookie: { secure: secureTransfer },
            store: MongoStore.create({ mongoUrl: process.env.MONGODB_URI }),
        })(req, res, () => {
            lusca.csrf()(req, res, next);
        });
    });

    // TRAPS (Strictly skip ADMIN_PATH)
    app.use((req, res, next) => {
        const url = req.originalUrl.toLowerCase();
        if (url.startsWith(ADMIN_PATH.toLowerCase())) return next();

        const traps = ['/admin', '/dashboard', '/cpanel', '/manage'];
        if (traps.some(t => url.includes(t))) {
            return res.status(404).send("Not Found");
        }
        next();
    });

    // PUBLIC ROUTES
    app.use("/", express.static(path.join(__dirname, "public")));
    app.get("/", (req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));

    // FINAL 404 (Skip Admin)
    app.use((req, res, next) => {
        if (req.originalUrl.startsWith(ADMIN_PATH)) return next();
        res.status(404).send("Page Not Found");
    });

    app.listen(app.get("port"), () => {
        console.log(`🚀 Production Ready at port ${app.get("port")}`);
    });
}

startServer();
