# German Accident Atlas Data Integration Platform

This project provides a harmonized Express Server with API endpoints and a frontend dashboard to analyze and report on traffic accident data from the provided OPAL fallback datasets.

## Repository Structure
- `backend/`: Node.js API server, ETL ingestion scripts, and database logic.
- `frontend/`: React-based dashboard interface.
- `data/`: Contains the required CSV source files.
- `openai.yaml/` : Refer to this file for technical documentation

## Prerequisites
- Node.js (v18.0.0 or higher)
- MySQL Server (v8.0 or higher)
- npm (Node Package Manager)

## Setup & Installation

### 1. Configure Environment
Navigate to the `backend/` directory and create a `.env` file with the following configuration:

```env
MYSQL_HOST=localhost
MYSQL_PORT=3306
MYSQL_USER=your_username
MYSQL_PASSWORD=your_password
MYSQL_DATABASE=accidents
```

### 2. Initialize Backend
Open a terminal window and intialize the backend by installing dependencies
cd backend
npm install
node ingest.js

### 3. Start the platform
node server.mjs

### 4. Initialize frontend
Open a different terminal window and initialize the frontend by installing dependencies
cd frontend
npm install
npm run dev

### 5. Final Step
Navigate to http://localhost:5173/
