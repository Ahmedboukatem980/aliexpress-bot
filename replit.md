# AliExpress Telegram Bot

## Overview
A Telegram bot that converts AliExpress product links into affiliate links with discount offers. Built with Node.js, Express, and the Telegraf library. Uses PostgreSQL for data persistence.

## Project Architecture
- **index.js** - Main bot server with Express webhook, Telegram bot handlers, admin features (broadcast, stats, button settings), subscription checks, and cron jobs
- **afflink.js** - Module for converting AliExpress URLs into affiliate links with coin/point/super/limit/bundle deals
- **public/** - Static assets (waiting images)
- **package.json** - Node.js dependencies

## Key Features
- Converts AliExpress links to affiliate links with multiple discount types (coins, points, super deals, limited offers, bundles)
- Admin panel: broadcast messages, view subscribers, export CSV, statistics dashboard
- Customizable inline buttons per message
- Subscription check enforcement (toggleable)
- Daily cron job to re-engage inactive users
- Webhook-based bot with Express server on port 5000

## Environment Variables
- `token` - Telegram bot token
- `cook` - Cookies for AliExpress requests
- `Channel` - Telegram channel URL for subscription checks
- `ADMIN_ID` - Telegram user ID for admin access
- `DATABASE_URL` - PostgreSQL connection string (auto-provided by Replit)

## Recent Changes
- 2026-02-08: Imported project to Replit, installed npm dependencies, verified server starts successfully with database connection
