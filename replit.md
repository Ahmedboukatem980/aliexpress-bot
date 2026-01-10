# AliExpress Telegram Bot

## Overview
A Telegram bot that generates AliExpress affiliate links with discounts. Users send a product link, and the bot returns multiple discount links (coins, points, super deals, limited offers, bundle deals).

## Features
- **Affiliate Link Generation**: Converts AliExpress links to affiliate links with various discount types
- **Channel Subscription Check**: Users must subscribe to a channel before using the bot
- **Package Tracking** (New): Users can track their AliExpress shipments using the "📦 تتبع شحنتي" button
  - Enter tracking number to get shipment status
  - Shows current location, status, and recent updates
  - Uses TrackingMore API (requires API key)
- **Admin Panel**: Admin-only control panel with:
  - Broadcast messages to all subscribers
  - View subscriber statistics (daily, weekly, monthly)
  - View subscriber list
- **PostgreSQL Database**: Tracks all users for statistics and broadcast functionality

## Environment Variables (Secrets)
Required on Render:
- `token` - Telegram bot token from BotFather
- `cook` - AliExpress cookies for affiliate link generation
- `Channel` - Channel URL for subscription check (e.g., https://t.me/yourchannel)
- `ADMIN_ID` - Your Telegram user ID (numeric) to access admin panel
- `DATABASE_URL` - PostgreSQL connection string
- `TRACKING_API_KEY` - TrackingMore API key for package tracking (optional, get from https://www.trackingmore.com)

## Deployment
This bot is deployed on Render. After pushing to GitHub:
1. Render auto-deploys from the main branch
2. Set environment variables in Render dashboard

## Files
- `index.js` - Main bot logic with admin panel
- `afflink.js` - AliExpress affiliate link generation
- `package.json` - Dependencies
- `render.yaml` - Render deployment config
