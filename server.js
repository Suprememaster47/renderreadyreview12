import path from 'path';
import fs from 'fs';
import express from 'express';
import session from 'express-session';
import MongoStore from 'connect-mongo';
import AdminJS from 'adminjs';
import AdminJSExpress from '@adminjs/express';
import { ComponentLoader } from 'adminjs';
import * as AdminJSMongoose from '@adminjs/mongoose';
import mongoose from 'mongoose';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

// Initialize AdminJS Mongoose Adapter
AdminJS.registerAdapter(AdminJSMongoose);

const app = express();
const componentLoader = new ComponentLoader();

// --- 1. ADMINJS COMPONENT REGISTRATION ---
// This tells AdminJS where your custom Dashboard file is located.
const Components = {
    Dashboard: componentLoader.add('Dashboard', path.join(process.cwd(), 'components/Dashboard.jsx')),
};

async function start() {
    // Connect to MongoDB (ensure your MONGODB_URI is in Render env vars)
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB');

    const ADMIN_PATH = '/electric-puffin-vault-12';

    // --- 2. ADMINJS OPTIONS ---
    const adminOptions = {
        resources: [], // List your Mongoose models here (e.g., Review, Contact)
        rootPath: ADMIN_PATH,
        componentLoader,
        dashboard: {
            component: Components.Dashboard,
        },
        branding: {
            companyName: 'Hydro Sweep Services',
            withMadeWithLove: false,
        },
    };

    const admin = new AdminJS(adminOptions);

    // --- 3. THE RENDER BUNDLE FIX ---
    // AdminJS v7 uses esbuild to bundle your Dashboard.jsx into .adminjs/
    const bundlePath = path.join(process.cwd(), '.adminjs');
    if (!fs.existsSync(bundlePath)) {
        fs.mkdirSync(bundlePath, { recursive: true });
    }

    // Trigger the actual bundling process
    await admin.initialize();
    console.log('✅ AdminJS Bundle compiled successfully');

    // --- 4. STATIC ASSET ROUTING (The MIME Type Fix) ---
    // This tells Express to serve the compiled .js files with the correct headers.
    // MUST be placed before the admin router.
    app.use(`${ADMIN_PATH}/frontend/assets`, express.static(bundlePath, {
        setHeaders: (res, filePath) => {
            if (filePath.endsWith('.js')) {
                res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
            }
        }
    }));

    // --- 5. AUTHENTICATED ROUTER SETUP ---
    const adminRouter = AdminJSExpress.buildAuthenticatedRouter(admin, {
        authenticate: async (email, password) => {
            if (email === process.env.ADMIN_EMAIL && password === process.env.ADMIN_PASSWORD) {
                return { email };
            }
            return null;
        },
        cookieName: 'adminjs-session',
        cookiePassword: (process.env.SESSION_SECRET || 'hydro-sweep-default-secret-32-chars').substring(0, 32),
    }, null, {
        resave: false,
        saveUninitialized: true,
        secret: process.env.SESSION_SECRET || 'hydro-sweep-default-secret',
        store: MongoStore.create({ mongoUrl: process.env.MONGODB_URI }),
        cookie: {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'lax',
        }
    });

    // Mount the AdminJS router
    app.use(ADMIN_PATH, adminRouter);

    // --- 6. GENERAL EXPRESS MIDDLEWARE & START ---
    app.use(express.json());
    
    // Add your other app routes here (e.g., app.get('/', ...))

    const PORT = process.env.PORT || 3000;
    app.listen(PORT, () => {
        console.log(`🚀 Hydro Sweep Dashboard live at: https://hydrosweepservices.com${ADMIN_PATH}`);
    });
}

// Global error handling for the start sequence
start().catch(err => {
    console.error('❌ Server failed to start:', err);
});
