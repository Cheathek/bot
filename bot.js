const { Telegraf } = require('telegraf');
const axios = require('axios');
const crypto = require('crypto');
const fs = require('fs-extra');
const path = require('path');

// Configuration (REPLACE THESE!)
const BOT_TOKEN = '7762199917:AAGimHdXulwYiVspij8Jwr_hNO7dctRiITk'; // From @BotFather
const YOUR_TELEGRAM_USER_ID = '5058242890'; // From @userinfobot
const CHANNEL_USERNAME = '@wallpaper_yamiro'; // Your channel username with @

const bot = new Telegraf(BOT_TOKEN);
const HASHES_FILE = path.join(__dirname, 'hashes.json');
const TEMP_DIR = path.join(__dirname, 'temp');

// Data storage
let fileHashes = new Set();
let messageHashMap = new Map();

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
  await fs.remove(filePath).catch(() => {});
  return hash;
}

// Handle channel posts
bot.on('channel_post', async (ctx) => {
  try {
    const message = ctx.channelPost;
    const file = message.photo?.[message.photo.length - 1] || 
                 message.document || 
                 message.video;

    if (!file) return;

    const fileId = file.file_id;
    const fileLink = await ctx.telegram.getFileLink(fileId);
    const hash = await generateFileHash(fileLink.href, `${fileId}.tmp`);

    const messageId = message.message_id;
    const chatId = message.chat.id;

    if (fileHashes.has(hash)) {
      // Delete duplicate
      await ctx.telegram.deleteMessage(chatId, messageId);
      
      // Notify you
      await ctx.telegram.sendMessage(
        YOUR_TELEGRAM_USER_ID,
        `🚫 Deleted duplicate in ${CHANNEL_USERNAME}`
      );
    } else {
      // Store new file
      fileHashes.add(hash);
      messageHashMap.set(hash, { messageId, chatId });
      await saveData();
    }
  } catch (err) {
    console.error('Error:', err);
  }
});

// Start bot
(async () => {
  await loadData();
  await fs.ensureDir(TEMP_DIR);
  
  bot.launch();
  console.log('🤖 Bot started monitoring', CHANNEL_USERNAME);

  process.once('SIGINT', () => bot.stop('SIGINT'));
  process.once('SIGTERM', () => bot.stop('SIGTERM'));
})();