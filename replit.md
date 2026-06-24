# AliExpress Telegram Bot

## Overview
A Telegram bot that generates AliExpress affiliate links with discounts. Users send a product link, and the bot returns multiple discount links (coins, points, super deals, limited offers, bundle deals).

## Features
- **Affiliate Link Generation**: Converts AliExpress links to affiliate links with various discount types
- **Channel Subscription Check**: Users must subscribe to a channel before using the bot
- **Admin Panel** (New): Admin-only control panel with:
  - Broadcast messages to all subscribers
  - View subscriber statistics (daily, weekly, monthly)
  - View subscriber list
- **Saved Products (Wishlist)** (New): Each user has a personal favorites list:
  - "💾 حفظ المنتج" button under every product result saves it to the user's list
  - "💾 منتجاتي المحفوظة" keyboard button opens a paginated list of saved products
  - Each saved item can be viewed (photo + stats + discount links) or deleted
  - Saved as an immutable snapshot (links/stats stay as they were when saved); 50-item limit per user
- **Price-Drop Alerts** (New): The bot stores each saved product's price at save time and re-checks prices every 6 hours:
  - When a saved product's current price falls below the price it had when saved, the user gets a notification (old price, new price, % drop, buy link)
  - Alerts fire once per new lower level (no spam); if the price recovers to/above the saved price, a later drop will alert again
  - Saving a product automatically opts the user into alerts for it; deleting it stops them
- **PostgreSQL Database**: Tracks all users for statistics and broadcast functionality

## Environment Variables (Secrets)
Required on Render:
- `token` - Telegram bot token from BotFather
- `cook` - AliExpress cookies for affiliate link generation
- `Channel` - Channel URL for subscription check (e.g., https://t.me/yourchannel)
- `ADMIN_ID` - Your Telegram user ID (numeric) to access admin panel
- `DATABASE_URL` - PostgreSQL connection string
- `ALI_APP_KEY` - AliExpress affiliate app key (for product stats + price-drop alerts)
- `ALI_APP_SECRET` - AliExpress affiliate app secret

## Deployment
This bot is deployed on Render. After pushing to GitHub:
1. Render auto-deploys from the main branch
2. Set environment variables in Render dashboard

## Files
- `index.js` - Main bot logic with admin panel
- `afflink.js` - AliExpress affiliate link generation
- `package.json` - Dependencies
- `render.yaml` - Render deployment config
