import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import mysql from 'mysql2/promise';
import helmet from 'helmet'; 
import rateLimit from 'express-rate-limit'; 
import { configDotenv } from 'dotenv';


configDotenv();

const app = express();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT || 5173);
const frontendDist = path.join(__dirname, 'dist');


app.use(helmet({ contentSecurityPolicy: false }));
const limiter = rateLimit({
    windowMs: 1 * 60 * 1000,
    max: 100,
    message: { error: "Too many requests, please try again later." }
});
app.use('/api/', limiter);
app.use(express.json());

const pool = mysql.createPool({
    host: process.env.MYSQL_HOST,
    user: process.env.MYSQL_USER,
    password: process.env.MYSQL_PASSWORD,
    database: process.env.MYSQL_DATABASE,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    multipleStatements: false
});

function formatResponse(rows) {
    return {
        columns: rows.length > 0 ? Object.keys(rows[0]) : [],
        rows: Array.isArray(rows) ? rows : []
    };
}


app.get('/api/reports/accidents-by-year', async (req, res) => {
    try {
        const [rows] = await pool.query(
            `SELECT year, COUNT(*) AS accidents FROM accidents GROUP BY year ORDER BY year`
        );
        res.json(formatResponse(rows));
    } catch (err) {
        res.status(500).json({ error: "Database transaction handling anomaly." });
    }
});


app.get('/api/reports/top-regions', async (req, res) => {
    try {
        const [rows] = await pool.query(
            `SELECT r.name, COUNT(*) AS accidents 
             FROM accidents a 
             JOIN regions r ON r.region_id = a.region_id 
             GROUP BY r.region_id, r.name 
             ORDER BY accidents DESC LIMIT 10`
        );
        res.json(formatResponse(rows));
    } catch (err) {
        res.status(500).json({ error: "Database transaction handling anomaly." });
    }
});


app.get('/api/reports/hourly-pattern', async (req, res) => {
    try {
        const [rows] = await pool.query(
            `SELECT hour, COUNT(*) AS accidents FROM accidents WHERE hour IS NOT NULL GROUP BY hour ORDER BY hour`
        );
        res.json(formatResponse(rows));
    } catch (err) {
        res.status(500).json({ error: "Database transaction handling anomaly." });
    }
});


app.get('/api/reports/road-users', async (req, res) => {
    try {
        const [rows] = await pool.query(
            `SELECT SUM(is_bike_involved) AS Bike, 
                    SUM(is_pedestrian_involved) AS Pedestrian, 
                    SUM(is_car_involved) AS Car, 
                    SUM(is_truck_involved) AS Truck, 
                    SUM(is_motorcycle_involved) AS Motorcycle 
             FROM accidents`
        );
        res.json(formatResponse(rows));
    } catch (err) {
        res.status(500).json({ error: "Database transaction handling anomaly." });
    }
});


app.get('/api/answers/earliest-year', async (req, res) => {
    try {
        const [rows] = await pool.query(
            `SELECT MIN(year) AS earliest_year FROM accidents`
        );
        res.json(formatResponse(rows));
    } catch (err) {
        res.status(500).json({ error: "Database transaction handling anomaly." });
    }
});

app.get('/api/answers/saxony-2023', async (req, res) => {
    try {
        const [rows] = await pool.query(
            `SELECT COUNT(*) AS injury_accidents_saxony_2023 
             FROM accidents a 
             JOIN regions r ON a.region_id = r.region_id 
             WHERE r.ags LIKE '14%' AND a.year = 2023`
        );
        res.json(formatResponse(rows));
    } catch (err) {
        res.status(500).json({ error: "Database transaction handling anomaly." });
    }
});

app.get('/api/reports/by-ags-prefix', async (req, res) => {
    const prefix = req.query.prefix || '';
    
    if (!/^\d*$/.test(prefix)) {
        return res.status(400).json({ error: "Parameter Constraint Error: AGS parameters must consist of numeric values only." });
    }

    try {
        const [rows] = await pool.query(
            `SELECT MIN(a.year) AS region_start_year, r.name, COUNT(a.accident_id) as total_accidents
             FROM accidents a 
             JOIN regions r ON a.region_id = r.region_id 
             WHERE r.ags LIKE ? 
             GROUP BY r.region_id, r.name 
             LIMIT 100`,
            [`${prefix}%`] 
        );
        res.json(formatResponse(rows));
    } catch (error) {
        res.status(500).json({ error: "Database transaction handling anomaly." });
    }
});


app.get('/api/answers/berlin-pedestrians-2023', async (req, res) => {
    try {
        const [rows] = await pool.query(
            `SELECT COUNT(*) AS pedestrian_accidents_berlin_2023 
             FROM accidents a 
             JOIN regions r ON a.region_id = r.region_id 
             WHERE r.ags LIKE '11%' AND a.year = 2023 AND a.is_pedestrian_involved = 1`
        );
        res.json(formatResponse(rows));
    } catch (err) {
        res.status(500).json({ error: "Database transaction handling anomaly." });
    }
});


app.get('/api/answers/monthly-advanced-aggregation', async (req, res) => {
    try {
        const [rows] = await pool.query(
            `SELECT a.month AS month_digit, 
                    COUNT(a.accident_id) AS local_accidents_count, 
                    SUM(a.is_bike_involved) AS local_bike_accidents 
             FROM accidents a 
             WHERE a.year = 2023 
             GROUP BY a.month 
             ORDER BY a.month`
        );
        res.json(formatResponse(rows));
    } catch (err) {
        res.status(500).json({ error: "Database transaction handling anomaly." });
    }
});

app.get('/api/reports/accidents-in-region', async (req, res) => {
    const { ags } = req.query;
    try {
        const [rows] = await pool.query(
            `SELECT a.* FROM accidents a 
             JOIN regions r ON a.region_id = r.region_id 
             WHERE r.ags = ?`, [ags]
        );
        res.json(formatResponse(rows));
    } catch (err) { res.status(500).json({ error: "Database error" }); }
});

app.get('/api/reports/accidents-by-month', async (req, res) => {
    try {
        const [rows] = await pool.query(
            `SELECT month, COUNT(*) as count FROM accidents GROUP BY month ORDER BY month`
        );
        res.json(formatResponse(rows));
    } catch (err) { res.status(500).json({ error: "Database error" }); }
});

app.get('/api/reports/top-accident-rates', async (req, res) => {
    try {
        const [rows] = await pool.query(
            `SELECT r.name, iv.value 
             FROM indicator_values iv 
             JOIN regions r ON iv.region_id = r.region_id 
             ORDER BY iv.value DESC LIMIT 10`
        );
        res.json(formatResponse(rows));
    } catch (err) { res.status(500).json({ error: "Database error" }); }
});

app.get('/api/reports/zero-accident-regions', async (req, res) => {
    try {
        const [rows] = await pool.query(
            `SELECT r.name
             FROM regions r 
             LEFT JOIN accidents a ON r.region_id = a.region_id 
             WHERE a.accident_id IS NULL`
        );
        res.json(formatResponse(rows));
    } catch (err) { res.status(500).json({ error: "Database error" }); }
});


app.use(express.static(frontendDist));
app.use((req, response) => {
    if (req.accepts('html', 'json') === 'json' || req.url.includes('.')) {
        return response.status(404).json({ error: 'Resource path not found.' });
    }
    response.sendFile(path.join(frontendDist, 'index.html'));
});

export { app, pool };

export function startServer(port = PORT) {
    return app.listen(port, () => {
        console.log(`🚀 Secure Harmonized API up on http://localhost:${port}`);
    });
}

if (process.env.NODE_ENV !== 'test') {
    startServer();
}
