# Agent Specification: Pixel-Perfect Clone & Containerization
## 1. Objective

The primary goal is to create a pixel-perfect clone of https://ni5arga.com/. This is a personal website and a learning project. Code must be kept simple, readable, and well-commented, adhering strictly to the KISS (Keep It Simple, Stupid) principle. Do not sacrifice visual accuracy for code simplicity; both are mandatory.
## 2. Tech Stack

    Frontend Server: Bun (serving HTML/CSS/JS)
    Backend Server: Bun (handling any API routes or dynamic logic)
    Database: SQLite (running in a separate container)
    Orchestration: Docker Compose

## 3. Replication Strategy (Chrome DevTools)

To achieve 100% pixel perfection, use Chrome DevTools exclusively to extract the exact implementation details:

    DOM Structure: Replicate the exact HTML hierarchy. Do not add unnecessary <div> wrappers.
    CSS Extraction: Use the "Elements" tab. Copy exact color hex codes, rem/px values, margins, paddings, and flexbox/grid alignments. 
    Assets: Download all images, fonts, and icons directly from the "Network" or "Application" tabs. Do not use placeholders.
    Responsiveness: Test against multiple breakpoints using DevTools' device toolbar. Replicate exact media queries.
    Animations/Interactions: Inspect event listeners and CSS transitions to replicate hover states, scrolling behaviors, and dynamic UI changes.

## 4. Architecture & Containerization

The final output must be cleanly containerized using Docker Compose with three distinct services:

    Frontend Container:
        Uses Bun.
        Serves static files from a public directory.
        Listens on port 3000.
    Backend Container:
        Uses Bun.
        Serves a simple API (if applicable based on the site).
        Connects to the Database container.
        Listens on port 3001 (internal).
    Database Container:
        Uses an official SQLite Docker image (or a lightweight Alpine image with SQLite installed).
        Mounts a volume for persistent storage.

Note on SQLite: Since SQLite is file-based, the DB container will share a Docker volume with the Backend container to keep the architecture simple but separated.

## 5. Code Standards (KISS)

    Comments: Add comments explaining why a complex CSS layout or backend route exists, not what it does. 
    Simplicity: Avoid heavy frameworks if native HTML/CSS/JS suffices. The goal is understanding, not over-engineering.
    File Structure: Keep directories flat and intuitive (e.g., /frontend, /backend, /db).

## 6. Workflow Phases

    Phase 1: Clone the frontend UI exactly. Serve locally using Bun.
    Phase 2: Build the Backend and DB setup (even if the clone is purely static, set up the backend to serve a simple "visitor counter" API to prove the full-stack connection).
    Phase 3: Write Dockerfiles for Frontend, Backend, and DB.
    Phase 4: Write docker-compose.yml to link them.
    Phase 5: Halt and wait for user verification. DO NOT proceed to the learning phase until the user confirms the clone is pixel-perfect and the containers run flawlessly.
