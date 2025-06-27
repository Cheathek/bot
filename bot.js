require('dotenv').config();
const { Telegraf } = require('telegraf');
const axios = require('axios');
const crypto = require('crypto');
const fs = require('fs-extra');
const path = require('path');
const express = require('express');

// Configuration (from environment variables)
const BOT_TOKEN = process.env.BOT_TOKEN;
const YOUR_TELEGRAM_USER_ID = process.env.YOUR_TELEGRAM_USER_ID;
const CHANNEL_USERNAME = process.env.CHANNEL_USERNAME;
const PORT = process.env.PORT || 3000;
const WEBHOOK_PATH = `/telegraf/${BOT_TOKEN}`;
const WEBHOOK_URL = process.env.WEBHOOK_URL;
const IS_DEV = process.env.NODE_ENV !== 'production';

if (!BOT_TOKEN || !YOUR_TELEGRAM_USER_ID || !CHANNEL_USERNAME) {
  throw new Error('Missing BOT_TOKEN, YOUR_TELEGRAM_USER_ID, or CHANNEL_USERNAME in environment variables!');
}

const bot = new Telegraf(BOT_TOKEN);
const HASHES_FILE = path.join(__dirname, 'hashes.json');
const TEMP_DIR = path.join(__dirname, 'temp');

// Data storage
let fileHashes = new Set();
let messageHashMap = new Map();
let PQueue;
let queue;

// Load saved data
async function loadData() {
  try {
    if (fs.existsSync(HASHES_FILE)) {
      const { hashes, messageMap } = await fs.readJson(HASHES_FILE);
      fileHashes = new Set(hashes);
      messageHashMap = new Map(Object.entries(messageMap));
    }
  } catch (e) {
    console.error('Failed to load data:', e);
    await fs.writeJson(HASHES_FILE, { hashes: [], messageMap: {} });
  }
}

// Save data to file
async function saveData() {
  await fs.writeJson(HASHES_FILE, {
    hashes: Array.from(fileHashes),
    messageMap: Object.fromEntries(messageHashMap)
  });
}

// Generate file hash
async function generateFileHash(fileLink, tempName) {
  const filePath = path.join(TEMP_DIR, tempName);
  await fs.ensureDir(TEMP_DIR);

  const response = await axios({ url: fileLink, method: 'GET', responseType: 'stream' });
  const writer = fs.createWriteStream(filePath);
  response.data.pipe(writer);

  await new Promise((resolve, reject) => {
    writer.on('finish', resolve);
    writer.on('error', reject);
  });

  const fileBuffer = await fs.readFile(filePath);
  const hash = crypto.createHash('sha256').update(fileBuffer).digest('hex');
  await fs.remove(filePath).catch(() => { });
  return hash;
}

// Channel post handler
bot.on('channel_post', (ctx) => {
  queue.add(async () => {
    try {
      const message = ctx.channelPost;
      if (!message) return;

      const file = message.photo?.[message.photo.length - 1] ||
                   message.document ||
                   message.video;
      if (!file) return;

      const fileId = file.file_id;
      const fileLink = await ctx.telegram.getFileLink(fileId);
      const hash = await generateFileHash(fileLink.href, `${fileId}.tmp`);

      if (fileHashes.has(hash)) {
        try {
          await ctx.telegram.deleteMessage(message.chat.id, message.message_id);
          await ctx.telegram.sendMessage(
            YOUR_TELEGRAM_USER_ID,
            `🚫 Deleted duplicate in ${CHANNEL_USERNAME}`
          );
        } catch (deleteError) {
          if (deleteError.response?.error_code === 400) {
            console.log('Message already deleted or not found');
            fileHashes.delete(hash);
            messageHashMap.delete(hash);
            await saveData();
          } else {
            throw deleteError;
          }
        }
      } else {
        fileHashes.add(hash);
        messageHashMap.set(hash, {
          messageId: message.message_id,
          chatId: message.chat.id
        });
        await saveData();
      }
    } catch (err) {
      console.error('Error processing media:', err);
    }
  });
});

// Start bot
(async () => {
  PQueue = (await import('p-queue')).default;
  queue = new PQueue({ concurrency: 1, interval: 1000 });

  await loadData();
  await fs.ensureDir(TEMP_DIR);

  const app = express();
  app.use(express.json());

  if (!IS_DEV && WEBHOOK_URL) {
    // Production: use webhook
    app.use(bot.webhookCallback(WEBHOOK_PATH));
    await bot.telegram.setWebhook(`${WEBHOOK_URL}${WEBHOOK_PATH}`);
    app.get('/', (req, res) => res.send('Bot is running!'));
    app.listen(PORT, () => {
      console.log(`🚀 Webhook server running on port ${PORT}`);
    });
  } else {
    await bot.telegram.deleteWebhook();
    bot.launch();
    app.get('/', (req, res) => res.send('Bot is running in polling mode!'));
    app.listen(PORT, () => {
      console.log(`🤖 Polling server running on port ${PORT}`);
    });
  }

  process.once('SIGINT', () => bot.stop('SIGINT'));
  process.once('SIGTERM', () => bot.stop('SIGTERM'));
})();