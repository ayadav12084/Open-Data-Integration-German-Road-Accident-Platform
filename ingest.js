import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import csv from 'csv-parser';
import mysql from 'mysql2/promise';
import { configDotenv } from 'dotenv';
import { performance } from 'perf_hooks'; 

configDotenv();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATABASE = process.env.MYSQL_DATABASE;

const mysqlConfig = {
    host: process.env.MYSQL_HOST,
    user: process.env.MYSQL_USER,
    password: process.env.MYSQL_PASSWORD,
    multipleStatements: false
};

const files = {
    cityIndicators: 'accident_per_10000_per_city.csv',
    accidents2021: 'accident_per_location_2021_in_Schleswig-Holstein.csv',
    accidents2023: 'accident_per_location_2023.csv',
    accidentsperson: 'accident_with_persons_per_month.csv'
};

function csvPath(fileName) {
    return path.join(__dirname, fileName);
}

function parseDecimal(value) {
    if (value === undefined || value === null || value === '') return null;
    const parsed = Number.parseFloat(String(value).trim().replace(',', '.'));
    return Number.isNaN(parsed) ? null : parsed;
}

function parseInteger(value) {
    if (value === undefined || value === null || value === '') return null;
    const parsed = Number.parseInt(String(value).trim(), 10);
    return Number.isNaN(parsed) ? null : parsed;
}

function flag(value) {
    const num = parseInteger(value);
    return (num === 1 || num === 2) ? 1 : 0;
}

function normalizeAgs(land, regBez, kreis) {
    if (!land) return null;
    const sLand = String(land).trim().padStart(2, '0');
    if (sLand === '11') return '11000';
    if (!kreis) return null;
    let sKreis = String(kreis).trim();
    if (sKreis.length === 5 && sKreis.startsWith(sLand)) return sKreis;
    const sReg = String(regBez || '0').trim();
    if (sKreis.length === 3) return `${sLand}${sKreis}`;
    const sKrOuter = sKreis.padStart(2, '0');
    return `${sLand}${sReg}${sKrOuter}`;
}

async function createDatabaseIfNeeded() {
    const connection = await mysql.createConnection(mysqlConfig);
    await connection.query(`CREATE DATABASE IF NOT EXISTS \`${DATABASE}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    await connection.end();
}

async function createSchema(connection) {
    await connection.execute(`
        CREATE TABLE IF NOT EXISTS provenance_log (
            run_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
            source_name VARCHAR(255) NOT NULL,
            license_type VARCHAR(100) NULL,
            status VARCHAR(30) NOT NULL,
            records_imported BIGINT UNSIGNED NOT NULL DEFAULT 0,
            started_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            finished_at TIMESTAMP NULL DEFAULT NULL,
            PRIMARY KEY (run_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    await connection.execute(`
        CREATE TABLE IF NOT EXISTS regions (
            region_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
            ags VARCHAR(12) NOT NULL,
            name VARCHAR(255) NOT NULL,
            level VARCHAR(50) NOT NULL,
            PRIMARY KEY (region_id),
            UNIQUE KEY uq_regions_ags (ags)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    await connection.execute(`
        CREATE TABLE IF NOT EXISTS indicators (
            indicator_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
            code VARCHAR(100) NOT NULL,
            name VARCHAR(255) NOT NULL,
            unit VARCHAR(100) NULL,
            source_system VARCHAR(100) NULL,
            PRIMARY KEY (indicator_id),
            UNIQUE KEY uq_indicators_code (code)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    await connection.execute(`
        CREATE TABLE IF NOT EXISTS indicator_values (
            indicator_value_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
            region_id BIGINT UNSIGNED NOT NULL,
            indicator_id BIGINT UNSIGNED NOT NULL,
            year SMALLINT NOT NULL,
            value DECIMAL(12, 4) NULL,
            PRIMARY KEY (indicator_value_id),
            UNIQUE KEY uq_indicator_value (region_id, indicator_id, year),
            CONSTRAINT fk_indicator_values_region FOREIGN KEY (region_id) REFERENCES regions(region_id),
            CONSTRAINT fk_indicator_values_indicator FOREIGN KEY (indicator_id) REFERENCES indicators(indicator_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    await connection.execute(`
        CREATE TABLE IF NOT EXISTS accidents (
            accident_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
            source_id VARCHAR(40) NULL,
            region_id BIGINT UNSIGNED NOT NULL,
            year SMALLINT NOT NULL,
            month TINYINT NULL,
            hour TINYINT NULL,
            weekday TINYINT NULL,
            category TINYINT NULL,
            type VARCHAR(20) NULL,
            light VARCHAR(20) NULL,
            is_bike_involved TINYINT(1) NOT NULL DEFAULT 0,
            is_pedestrian_involved TINYINT(1) NOT NULL DEFAULT 0,
            is_car_involved TINYINT(1) NOT NULL DEFAULT 0,
            is_truck_involved TINYINT(1) NOT NULL DEFAULT 0,
            is_motorcycle_involved TINYINT(1) NOT NULL DEFAULT 0,
            lon DECIMAL(12, 9) NULL,
            lat DECIMAL(12, 9) NULL,
            PRIMARY KEY (accident_id),
            KEY idx_accidents_region_year (region_id, year),
            KEY idx_accidents_location (lon, lat),
            UNIQUE KEY uq_accidents_source_id (source_id),
            CONSTRAINT fk_accidents_region FOREIGN KEY (region_id) REFERENCES regions(region_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
}

async function* readCsv(fileName, options = {}) {
    const parser = fs
        .createReadStream(csvPath(fileName))
        .pipe(csv({
            separator: ';',
            skipLines: options.skipLines || 0,
            mapHeaders: ({ header }) => header.trim()
        }));

    for await (const row of parser) {
        yield row;
    }
}

async function upsertIndicator(connection) {
    await connection.execute(
        `INSERT INTO indicators (code, name, unit, source_system)
         VALUES (?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE name = VALUES(name), unit = VALUES(unit), source_system = VALUES(source_system)`,
        ['accidents_per_10k', 'Strassenverkehrsunfaelle je 10.000 EW', 'per 10,000 inhabitants', 'Regionalstatistik']
    );

    const [rows] = await connection.execute("SELECT indicator_id FROM indicators WHERE code = 'accidents_per_10k'");
    return rows[0].indicator_id;
}

async function ingestRegions(connection) {
    console.log(`[2/4] Loading regional indicators from ${files.cityIndicators}...`);

    const indicatorId = await upsertIndicator(connection);
    let count = 0;

    for await (const row of readCsv(files.cityIndicators, { skipLines: 2 })) {
        const rawAgs = row.schluessel;
        const rawName = row.regionaleinheit;

        if (!rawAgs || !rawName || rawAgs === 'schluessel') continue;

        const ags = String(rawAgs).trim().padStart(5, '0');
        const name = String(rawName).trim();

        await connection.execute(
            `INSERT INTO regions (ags, name, level)
             VALUES (?, ?, 'district')
             ON DUPLICATE KEY UPDATE name = VALUES(name), level = VALUES(level)`,
            [ags, name]
        );
        count++;
    }

    const regionLookup = await loadRegionLookup(connection);

    for await (const row of readCsv(files.cityIndicators, { skipLines: 2 })) {
        const rawAgs = row.schluessel;
        const value = parseDecimal(row.wert); // Now allows nulls
        if (!rawAgs || rawAgs === 'schluessel') continue;

        const ags = String(rawAgs).trim().padStart(5, '0');
        const regionId = regionLookup[ags];

        if (regionId) {
            await connection.execute(
                `INSERT INTO indicator_values (region_id, indicator_id, year, value)
                 VALUES (?, ?, 2023, ?)
                 ON DUPLICATE KEY UPDATE value = VALUES(value)`,
                [regionId, indicatorId, value]
            );
        }
    }

    console.log(` -> Loaded ${count} regions and regional indicator values (including nulls).`);
    return count;
}

async function loadRegionLookup(connection) {
    const [regions] = await connection.execute('SELECT ags, region_id FROM regions');
    return Object.fromEntries(regions.map((region) => [region.ags, region.region_id]));
}

async function flushAccidentBatch(connection, batch) {
    if (batch.length === 0) return 0;

    const columns = [
        'source_id', 'region_id', 'year', 'month', 'hour', 'weekday',
        'category', 'type', 'light', 'is_bike_involved', 'is_pedestrian_involved',
        'is_car_involved', 'is_truck_involved', 'is_motorcycle_involved', 'lon', 'lat'
    ];
    const rowPlaceholders = `(${columns.map(() => '?').join(', ')})`;
    const placeholders = batch.map(() => rowPlaceholders).join(', ');

    await connection.query(
        `INSERT INTO accidents (${columns.map((column) => `\`${column}\``).join(', ')})
         VALUES ${placeholders}
         ON DUPLICATE KEY UPDATE
            region_id = VALUES(region_id),
            year = VALUES(year),
            month = VALUES(month),
            hour = VALUES(hour),
            weekday = VALUES(weekday),
            category = VALUES(category),
            type = VALUES(type),
            light = VALUES(light),
            is_bike_involved = VALUES(is_bike_involved),
            is_pedestrian_involved = VALUES(is_pedestrian_involved),
            is_car_involved = VALUES(is_car_involved),
            is_truck_involved = VALUES(is_truck_involved),
            is_motorcycle_involved = VALUES(is_motorcycle_involved),
            lon = VALUES(lon),
            lat = VALUES(lat)`,
        batch.flat()
    );

    return batch.length;
}

async function ensureRegionExists(connection, ags, regionLookup) {

    if (regionLookup[ags]) return regionLookup[ags];

    const [result] = await connection.execute(
        `INSERT IGNORE INTO regions (ags, name, level) VALUES (?, ?, ?)`,
        [ags, `Unknown/Generated Region ${ags}`, 'unknown']
    );

    if (result.insertId) {
        regionLookup[ags] = result.insertId;
        return result.insertId;
    }
    

    const [rows] = await connection.execute('SELECT region_id FROM regions WHERE ags = ?', [ags]);
    if (rows.length > 0) {
        regionLookup[ags] = rows[0].region_id;
        return rows[0].region_id;
    }
    return null;
}

async function ingestAccidents(connection, fileName, targetYear, regionLookup) {
    console.log(`[3/4] Loading accident records for ${targetYear} from ${fileName}...`);

    const batch = [];
    const batchSize = 1000;
    let inserted = 0;
    let skipped = 0;

    for await (const row of readCsv(fileName)) {
        let ags = normalizeAgs(row.ULAND, row.UREGBEZ, row.UKREIS);
        

        let regionId = ags ? await ensureRegionExists(connection, ags, regionLookup) : null;

        if (!regionId) {
            skipped++;
            continue;
        }

        const lon = parseDecimal(row.XGCSWGS84 || row.xgcswgs84);
        const lat = parseDecimal(row.YGCSWGS84 || row.ygcswgs84);

        batch.push([
            row.UIDENTSTLAE || `${targetYear}-${row.OBJECTID || row.OID_}`,
            regionId,
            targetYear,
            parseInteger(row.UMONAT),
            parseInteger(row.USTUNDE),
            parseInteger(row.UWOCHENTAG),
            parseInteger(row.UKATEGORIE),
            row.UART || null,
            row.ULICHTVERH || null,
            flag(row.IstRad),
            flag(row.IstFuss),
            flag(row.IstPKW),
            flag(row.IstGkfz),
            flag(row.IstKrad),
            lon,
            lat
        ]);

        if (batch.length >= batchSize) {
            inserted += await flushAccidentBatch(connection, batch);
            batch.length = 0;
        }
    }

    inserted += await flushAccidentBatch(connection, batch);
    console.log(` -> Inserted ${inserted} accidents for ${targetYear}. Skipped ${skipped} rows without a matching region.`);
    return inserted;
}

async function removePreviouslyImportedAccidents(connection) {
    await connection.execute('DELETE FROM accidents WHERE year IN (?, ?)', [2021, 2023]);
}

async function startIngestion() {
    const startTime = performance.now();
    let connection;
    let runId;

    try {
        await createDatabaseIfNeeded();

        connection = await mysql.createConnection({ ...mysqlConfig, database: DATABASE });
        console.log(`[1/4] Connected to MySQL database "${DATABASE}".`);

        await createSchema(connection);

        const [provenance] = await connection.execute(
            `INSERT INTO provenance_log (source_name, license_type, status)
             VALUES (?, ?, ?)`,
            ['Node.js CSV Ingestion System', 'DL-DE->BY-2.0', 'RUNNING']
        );
        runId = provenance.insertId;

        await ingestRegions(connection);
        const regionLookup = await loadRegionLookup(connection);
        await removePreviouslyImportedAccidents(connection);

        let totalLoaded = 0;
        totalLoaded += await ingestAccidents(connection, files.accidents2021, 2021, regionLookup);
        totalLoaded += await ingestAccidents(connection, files.accidents2023, 2023, regionLookup);

        await connection.execute(
            `UPDATE provenance_log
             SET status = 'SUCCESS', records_imported = ?, finished_at = CURRENT_TIMESTAMP
             WHERE run_id = ?`,
            [totalLoaded, runId]
        );

        console.log(`[4/4] ETL complete. Total accident records inserted: ${totalLoaded}`);
        
        const endTime = performance.now();
        const durationInSeconds = ((endTime - startTime) / 1000).toFixed(2);
        console.log(`--------------------------------------------------`);
        console.log(`⏱️ Execution Time: ${durationInSeconds} seconds`);
        console.log(`--------------------------------------------------`);

    } catch (error) {
        console.error('Critical error during ingestion:', error);

        if (connection && runId) {
            await connection.execute(
                `UPDATE provenance_log
                 SET status = 'FAILED', finished_at = CURRENT_TIMESTAMP
                 WHERE run_id = ?`,
                [runId]
            );
        }

        process.exitCode = 1;
    } finally {
        if (connection) {
            await connection.end();
        }
    }
}

startIngestion();
